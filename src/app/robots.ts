import type { MetadataRoute } from "next";

// Required for Next 16 metadata routes under `output: "export"`.
export const dynamic = "force-static";

const BASE_URL = (process.env.NEXT_PUBLIC_SITE_URL ?? "https://beyond-the-arc.netlify.app").replace(/\/$/, "");

export default function robots(): MetadataRoute.Robots {
  return {
    rules: { userAgent: "*", allow: "/" },
    sitemap: `${BASE_URL}/sitemap.xml`,
    host: BASE_URL,
  };
}
