/**
 * A deliberately tiny Markdown renderer for release notes and the changelog.
 *
 * Text is HTML-escaped before anything else, so the only markup in the output is the markup
 * this file writes: headings, bullet lists, paragraphs, **bold**, `code` and links to https
 * addresses. Everything else stays as plain, escaped text.
 */

const ESCAPES: Record<string, string> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;",
};

export function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, (c) => ESCAPES[c] ?? c);
}

// Runs on already-escaped text: brackets, parentheses and asterisks are never escaped,
// and an escaped URL (&amp; for &) is the correct form inside an attribute.
const LINK = /\[([^\]\n]+)\]\((https:\/\/[^\s()<>"']+)\)/g;
const BOLD = /\*\*([^*\n]+)\*\*/g;

function emphasis(escaped: string): string {
  return escaped
    .replace(LINK, '<a href="$2" rel="noopener noreferrer">$1</a>')
    .replace(BOLD, "<strong>$1</strong>");
}

/** One line of inline Markdown. Code spans are cut out first so nothing inside them changes. */
export function renderInline(raw: string): string {
  return raw
    .split(/(`[^`\n]+`)/)
    .map((part) =>
      part.length > 2 && part.startsWith("`") && part.endsWith("`")
        ? `<code>${escapeHtml(part.slice(1, -1))}</code>`
        : emphasis(escapeHtml(part)),
    )
    .join("");
}

export interface RenderOptions {
  /** Added to every heading level, so "##" with offset 1 becomes <h3>. Capped at h6. */
  headingOffset?: number;
}

export function renderMarkdown(source: string, { headingOffset = 0 }: RenderOptions = {}): string {
  const out: string[] = [];
  let paragraph: string[] = [];
  let list: string[] = [];

  const flush = () => {
    if (paragraph.length) out.push(`<p>${renderInline(paragraph.join(" "))}</p>`);
    if (list.length) out.push(`<ul>${list.map((item) => `<li>${item}</li>`).join("")}</ul>`);
    paragraph = [];
    list = [];
  };

  for (const line of source.replace(/\r\n?/g, "\n").split("\n")) {
    const heading = /^(#{1,6})\s+(.+?)\s*#*\s*$/.exec(line);
    const bullet = /^\s*[-*+]\s+(.*)$/.exec(line);
    if (heading?.[1] && heading[2] !== undefined) {
      flush();
      const level = Math.min(6, heading[1].length + headingOffset);
      out.push(`<h${level}>${renderInline(heading[2])}</h${level}>`);
    } else if (bullet?.[1] !== undefined) {
      if (paragraph.length) flush();
      list.push(renderInline(bullet[1]));
    } else if (line.trim() === "") {
      flush();
    } else if (list.length && /^\s+\S/.test(line)) {
      // An indented line continues the bullet above it.
      list[list.length - 1] += ` ${renderInline(line.trim())}`;
    } else {
      if (list.length) flush();
      paragraph.push(line.trim());
    }
  }
  flush();
  return out.join("\n");
}
