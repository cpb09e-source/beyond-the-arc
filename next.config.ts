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

  // The dev route indicator defaults to bottom-left, which is exactly where the
  // team pages' bottom navigation bar puts its first item. It is a portal above
  // the page, so it swallowed every tap on Overview — the link was fine, the
  // badge was on top of it. Dev-only, but it makes the bar untestable on a
  // phone viewport. Moved rather than disabled so the route indicator survives.
  devIndicators: { position: "top-left" },
};

export default nextConfig;
