
---
name: project-netlify-build-wrapper
description: "Production build uses scripts/build-with-r2-stash.mjs (not plain `npm run build`) and strips ~153k R2-mirrored data dirs from out/ AFTER next build. Don't simplify back to `npm run build` — the postbuild strip path doesn't run reliably on Netlify."
metadata: 
  node_type: memory
  type: project
  originSessionId: 6f55853a-6868-4c15-9309-40c8f3e51074
---

The R2 architecture relies on ~153k JSON files NOT being uploaded by Netlify (they live on R2 and are fetched by the browser via `dataUrl()`). The original `npm postbuild` hook approach (`scripts/strip-r2-mirrored-from-out.mjs`) works locally but did NOT run reliably on Netlify's hosted build runner — the Next.js runtime path bypassed both the lifecycle hook and `&&`-chained build commands.

**Mechanism that actually works:** [`scripts/build-with-r2-stash.mjs`](scripts/build-with-r2-stash.mjs) is the production build entrypoint. It:
1. Runs `npm run build` (which itself runs `next build` then the legacy `postbuild` strip script — local-only fallback)
2. After build success, the wrapper EXPLICITLY strips the six R2-mirrored dirs (`team-games`, `player-games`, `player`, `player-ranks`, `tournament-box`, `team`) from `out/` from inside the same Node process. Netlify can't skip it that way.

Why NOT stash-before-build (the historical attempt): stashing R2 dirs out of `public/data/` before `next build` broke `generateStaticParams` for team/player/coach pages — they need to read those JSONs to enumerate slugs. Result: every page 404'd. So R2 dirs MUST stay in `public/data/` during build, get copied to `out/data/` by Next's static export, and get stripped from `out/` afterward.

`netlify.toml` calls the wrapper:
```toml
[build]
  command = "node scripts/build-with-r2-stash.mjs"

txt files are NOT stripped — Next 16 emits per-route RSC payloads (__next._tree.txt, __next._head.txt, per-route index.txt, etc.) that the App Router fetches aggressively on hydration. Stripping them broke /coaches/ with an infinite refresh loop on May 20 2026 — see commit 61bbe7ad53 (the revert) and [[project-manual-deploy-pipeline]].

How to apply:

Don't change netlify.toml's command back to npm run build.
Don't delete scripts/build-with-r2-stash.mjs.
Don't re-introduce a .txt strip — they're required for Next 16's App Router.
If adding a new R2-mirrored data subdir, update the STRIP_DIRS array in the wrapper AND R2_DIRS in src/lib/data-url.ts AND scripts/sync-data-to-r2.mjs.
Local development (npm run dev) is unaffected — public/data/ is intact.
Related: [[project-r2-data-architecture]] [[project-manual-deploy-pipeline]]
