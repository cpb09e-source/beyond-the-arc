import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Full static export — Netlify serves everything from the edge CDN.
  // Every dynamic route must have generateStaticParams; no SSR at runtime.
  output: "export",

  // Trailing slash keeps Netlify's URL → file mapping deterministic
  // (e.g. `/teams/duke/` resolves to `/teams/duke/index.html`).
  trailingSlash: true,

  // The Image component can't run its runtime optimizer in static-export mode.
  // We pre-optimize via Sharp in scripts/fetch-player-images.mjs and serve the
  // resulting WebP files directly from `public/images/`.
  images: { unoptimized: true },
};

export default nextConfig;
