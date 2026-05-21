---
name: project-dev-environment
description: "`npm run dev` defaults to Turbopack (Next 16). On memory-constrained machines (≤8GB), Turbopack's PostCSS worker times out on globals.css — workaround is `next dev --webpack`. On 16GB+ PCs try Turbopack first."
metadata:
  node_type: memory
  type: project
---

Next 16 defaults `next dev` to Turbopack. On the **8GB XPS 13 travel laptop**, Turbopack panics on first compile of `/` with:

```
FATAL: An unexpected Turbopack error occurred
Failed to write app endpoint /page
- [project]/src/app/globals.css [app-client] (css)
- timeout while receiving message from process
```

Root cause: the PostCSS worker subprocess (Tailwind v4 `@tailwindcss/postcss`) doesn't respond within Turbopack's deadline under memory pressure. Known Turbopack-on-Windows issue, exacerbated by Chromium/Playwright also running.

**Workaround on the XPS (and any ≤8GB machine):**

```bash
npm run dev -- --webpack
```

Next 16's documented opt-out flag. Trade-off: first-route compile is much slower (~8 min for `/` on the XPS, vs Turbopack's intended seconds) — but it doesn't crash, and subsequent compiles + hot reload are fast.

**On the faster home PC (16GB+):** try plain `npm run dev` (Turbopack) first. If it works there, leave it. Only fall back to `--webpack` if Turbopack panics with the same PostCSS timeout signature.

**How to apply:** When asked to "start the dev server" on the XPS, use `--webpack`. On other machines, try Turbopack first. Don't permanently change `package.json`'s `"dev": "next dev"` to bake in `--webpack` — that would lock the faster PCs into the slow path.

Production builds (`scripts/build-with-r2-stash.mjs`) are unaffected — they use `next build`, not `next dev`.

Related: [[project-manual-deploy-pipeline]] (worker tuning on low-RAM machines for builds)
