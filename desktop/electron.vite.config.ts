import { resolve } from "node:path";
import { defineConfig } from "electron-vite";
import type { Plugin } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

/**
 * Three builds, one app: main (Node, owns windows and data), preload (the
 * narrow bridge), renderer (the React app).
 *
 * THE RENDERER RESOLVES "@/" TO THE SITE'S src/, with the same alias the site
 * uses. The stat logic (national ranks, the rating-trust gate, the trapezoid,
 * the scatter metrics) is imported from where it lives rather than copied, so
 * the app and the site cannot disagree about a number. Those modules import
 * each other through "@/", which is why the alias has to be identical, not
 * merely equivalent. "~/" is the app's own code.
 */
const APP = process.cwd();
const SITE_SRC = resolve(APP, "../src");
/** The site's static assets, for the few the app shares (the wordmark). Imported, never copied. */
const SITE_PUBLIC = resolve(APP, "../public");

/**
 * The renderer's Content-Security-Policy, injected per mode.
 *
 * A static <meta> cannot serve both: the React refresh preamble Vite injects in
 * development is an inline script, and a production policy that allowed inline
 * scripts would be no policy at all. Headers are not an option either, because
 * the packaged app loads from file://, where response headers never fire.
 *
 * bta: is the app's own protocol for bundled assets (team crests today).
 */
function contentSecurityPolicy(): Plugin {
  return {
    name: "bta-csp",
    transformIndexHtml(html, ctx) {
      const dev = Boolean(ctx.server);
      const policy = [
        "default-src 'self'",
        dev ? "script-src 'self' 'unsafe-inline'" : "script-src 'self'",
        "style-src 'self' 'unsafe-inline'",
        "img-src 'self' data: bta:",
        "font-src 'self' data:",
        dev ? "connect-src 'self' ws: http://localhost:*" : "connect-src 'self'",
      ].join("; ");
      return {
        html,
        tags: [
          {
            tag: "meta",
            attrs: { "http-equiv": "Content-Security-Policy", content: policy },
            injectTo: "head-prepend",
          },
        ],
      };
    },
  };
}

export default defineConfig({
  main: {},
  preload: {},
  renderer: {
    resolve: {
      alias: {
        "@": SITE_SRC,
        "@public": SITE_PUBLIC,
        "~": resolve(APP, "src/renderer/src"),
      },
    },
    plugins: [react(), tailwindcss(), contentSecurityPolicy()],
    server: {
      // The shared modules live above this package, and Vite refuses to serve
      // anything outside its root unless told.
      fs: { allow: [APP, SITE_SRC, SITE_PUBLIC] },
    },
  },
});
