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

  /**
   * WHO MAY LOAD THE DEV SERVER'S OWN ASSETS. Development only — a static
   * export has no dev resources, so this cannot reach production.
   *
   * Next blocks cross-origin requests to /_next/* dev endpoints by default,
   * and the failure is quiet in the worst way: open the dev server from
   * another device on the LAN and you get the server-rendered HTML with NO
   * JavaScript. The page looks almost right — headers, chrome, a "loading…"
   * that never resolves — because nothing hydrated, so no effect ever ran and
   * no data was ever fetched. There is no error on the page; the only sign is
   * a line in the dev server's own log:
   *
   *   ⚠ Blocked cross-origin request to Next.js dev resource /_next/webpack-hmr
   *
   * Found 2026-09-10 testing table scroll gestures on a phone, which is the
   * whole reason this matters: some things — iOS rubber-banding, touch
   * handoff, sticky headers under a real finger — cannot be checked in a
   * desktop browser at a narrow width.
   *
   * The 192.168.1.x range is this machine's LAN. It is DHCP, so the last
   * octet moves; the wildcard is what keeps this from needing an edit every
   * time the router hands out a new lease. Check with `ipconfig` if a device
   * still cannot load it.
   */
  allowedDevOrigins: ["192.168.1.*"],
};

export default nextConfig;
