import type { APIRoute } from "astro";

import { CHANNEL } from "../lib/site";

export const GET: APIRoute = ({ site }) => {
  // The testing site stays out of search results.
  if (CHANNEL === "dev") {
    return new Response("User-agent: *\nDisallow: /\n", {
      headers: { "Content-Type": "text/plain" },
    });
  }
  const sitemap = new URL("/sitemap.xml", site ?? "http://localhost:4321").href;
  return new Response(`User-agent: *\nAllow: /\n\nSitemap: ${sitemap}\n`, {
    headers: { "Content-Type": "text/plain" },
  });
};
