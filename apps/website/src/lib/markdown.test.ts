import { describe, expect, it } from "vitest";
import { escapeHtml, renderInline, renderMarkdown } from "./markdown";

describe("escapeHtml", () => {
  it("escapes every character that can start markup or end an attribute", () => {
    expect(escapeHtml(`<a href="x" onclick='y'>&</a>`)).toBe(
      "&lt;a href=&quot;x&quot; onclick=&#39;y&#39;&gt;&amp;&lt;/a&gt;",
    );
  });
});

describe("renderInline", () => {
  it("renders bold, code and https links", () => {
    expect(
      renderInline("**New** `chrome://extensions` [notes](https://example.com/a?b=1&c=2)"),
    ).toBe(
      '<strong>New</strong> <code>chrome://extensions</code> <a href="https://example.com/a?b=1&amp;c=2" rel="noopener noreferrer">notes</a>',
    );
  });

  it("leaves non-https links as text", () => {
    expect(renderInline("[x](javascript:alert(1)) [y](http://example.com)")).toBe(
      "[x](javascript:alert(1)) [y](http://example.com)",
    );
  });

  it("cannot break out of the href attribute", () => {
    const html = renderInline('[x](https://a.com/"onmouseover="alert(1))');
    expect(html).not.toContain('"onmouseover');
    expect(html).not.toContain("<a");
  });

  it("escapes raw HTML, also inside code and bold", () => {
    expect(renderInline("<img src=x onerror=alert(1)> `<b>` **<i>**")).toBe(
      "&lt;img src=x onerror=alert(1)&gt; <code>&lt;b&gt;</code> <strong>&lt;i&gt;</strong>",
    );
  });

  it("does not apply bold inside code", () => {
    expect(renderInline("`**a**`")).toBe("<code>**a**</code>");
  });
});

describe("renderMarkdown", () => {
  it("renders headings, lists and paragraphs with a heading offset", () => {
    const md = "## Title\n\nSome text\nwraps here.\n\n### Added\n- One\n- Two\n  continues\n\nEnd.";
    expect(renderMarkdown(md, { headingOffset: 1 })).toBe(
      [
        "<h3>Title</h3>",
        "<p>Some text wraps here.</p>",
        "<h4>Added</h4>",
        "<ul><li>One</li><li>Two continues</li></ul>",
        "<p>End.</p>",
      ].join("\n"),
    );
  });

  it("caps heading levels at h6 and handles CRLF", () => {
    expect(renderMarkdown("##### Deep\r\ntext", { headingOffset: 3 })).toBe(
      "<h6>Deep</h6>\n<p>text</p>",
    );
  });

  it("returns an empty string for empty input", () => {
    expect(renderMarkdown("")).toBe("");
  });
});
