import type { MetadataRoute } from "next";
import { BASE_URL as SITE, sitemapCount } from "@/lib/sitemap-entries";

// Required for Next 16 metadata routes under `output: "export"`.
export const dynamic = "force-static";

const BASE_URL = SITE;

export default async function robots(): Promise<MetadataRoute.Robots> {
  return {
    // Everything stays crawlable except the account pages, which render
    // nothing without a browser session — following D&3's pattern, where the
    // only Disallow lines are the login page and the API. Keeping the data
    // pages indexable matters more here than usual: the closest competitor has
    // a two-year SEO head start (see docs/monetization-strategy.md 5.2b).
    rules: { userAgent: "*", allow: "/", disallow: ["/account/"] },
    /**
     * EVERY SITEMAP FILE, BY NAME. The sitemap is split because Google caps a
     * file at 50,000 URLs (see src/app/sitemap.ts), and Next emits no index
     * naming the parts — so robots.txt is where they are declared, which
     * Google documents as an equivalent discovery mechanism.
     */
    sitemap: Array.from({ length: await sitemapCount() }, (_, i) => `${BASE_URL}/sitemap/${i}.xml`),
    host: BASE_URL,
  };
}
