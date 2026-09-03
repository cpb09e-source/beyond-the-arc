import type { MetadataRoute } from "next";

// Required for Next 16 metadata routes under `output: "export"`.
export const dynamic = "force-static";

const BASE_URL = (process.env.NEXT_PUBLIC_SITE_URL ?? "https://beyond-the-arc.netlify.app").replace(/\/$/, "");

export default function robots(): MetadataRoute.Robots {
  return {
    // Everything stays crawlable except the account pages, which render
    // nothing without a browser session — following D&3's pattern, where the
    // only Disallow lines are the login page and the API. Keeping the data
    // pages indexable matters more here than usual: the closest competitor has
    // a two-year SEO head start (see docs/monetization-strategy.md 5.2b).
    //
    // /t/ holds unlisted coach pages — one tournament weekend each, reachable
    // by link and nowhere else. Disallowed here, noindexed in netlify.toml and
    // in each page's metadata, and absent from the sitemap.
    rules: { userAgent: "*", allow: "/", disallow: ["/account/", "/t/"] },
    sitemap: `${BASE_URL}/sitemap.xml`,
    host: BASE_URL,
  };
}
