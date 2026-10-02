import type { APIRoute } from "astro";

const PATHS = ["/", "/install/", "/releases/", "/faq/", "/privacy/", "/terms/"];

/** A hand-written sitemap: six pages don't need a plugin. The host comes from PUBLIC_SITE_URL. */
export const GET: APIRoute = ({ site }) => {
  const base = site ?? new URL("http://localhost:4321");
  const urls = PATHS.map((p) => `  <url><loc>${new URL(p, base).href}</loc></url>`).join("\n");
  const body = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls}
</urlset>
`;
  return new Response(body, { headers: { "Content-Type": "application/xml" } });
};
