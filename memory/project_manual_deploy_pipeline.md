
---
name: project-manual-deploy-pipeline
description: "Production deploys are manual from a local machine — build with `node scripts/build-with-r2-stash.mjs`, then deploy with `netlify deploy --prod --dir=out --no-build`. The --no-build flag is critical or Netlify CLI re-runs the build (wastes 15-20 min). Auto-deploys on git push are disabled via netlify.toml `ignore = \"exit 0\"`."
metadata: 
  node_type: memory
  type: project
  originSessionId: 6f55853a-6868-4c15-9309-40c8f3e51074
---

The site has ~23k static pages (17k player profiles + 5k team-season dossiers + 800 coach pages + the rest). Netlify's hosted build runner has an 18-minute hard cap that this project consistently exceeds even with R2 data on Cloudflare and all the build-time optimizations layered on. All builds and deploys run locally.

**Production deploy procedure (manual, from any local machine with .env.local + netlify CLI auth):**

```bash
node scripts/build-with-r2-stash.mjs                                                  # ~15-20 min
netlify deploy --prod --dir=out --site=d0f62630-5d43-42d4-98ae-86684e7a0df0 --no-build # ~2-5 min routine

--no-build is critical. Without it, Netlify CLI auto-runs build.command from netlify.toml BEFORE uploading, wasting another full build cycle. Learned the hard way on May 21 2026 — accidentally tacked ~17 min onto a deploy.

Auto-deploys are disabled. netlify.toml sets [build] ignore = "exit 0" so every git push triggers a no-op "skipped" build in Netlify. Production stays on whatever the last manual netlify deploy --prod produced. To re-enable Netlify CI auto-deploys (and inherit the timeout problem), remove the ignore line.

Deploy time expectations:

First deploy after a .txt-strip change (worst case): ~30-40 min upload because ~117k .txt payloads are seeding the CDN cold. One-time cost.
Routine code change on the fast PC: ~10-15 min total (10 min build + 1-3 min upload, CDN dedups by hash).
Routine code change on the 8GB XPS 13 travel laptop: ~20-25 min (slower build due to memory pressure; reduce workers if you can — see below).
Build-worker tuning on low-RAM machines: Next 16 defaults to os.cpus() workers. On the 8GB XPS 13 with 8 logical cores, 7 workers OOM-swaps and the build slows dramatically (the 16-min page-gen step blew to 25 min). 3-4 workers is the sweet spot for 8GB systems. Set via NEXT_BUILD_WORKERS=4 env var or in next.config.

Codespaces are NOT a viable build environment — the 32GB /workspaces disk cap is hit during the final RSC .txt write phase. /tmp has more space but is ephemeral (wiped on Codespace stop/restart). Don't try to build on Codespaces.

Things that DON'T fix the Netlify hosted build (tried them all):

npm postbuild hook to strip R2 dirs — doesn't fire on Netlify
Chaining && node scripts/strip… in netlify.toml command — Netlify's runtime path skips it
Stashing R2 dirs out of public/ before build — breaks generateStaticParams for team/player/coach pages, every page 404s
Bulk-loading player ranks once per build — module cache doesn't share across Next's static-gen worker processes
Known cosmetic 404s (don't chase): Even with .txt files preserved, Next 16 still emits 20+ console errors for __next.coaches.__PAGE__.txt and dynamic-route prefetch payloads like __next.coaches.$d$slug.txt. These are App Router prefetch optimizations that Next doesn't emit for dynamic segments. Clicks still work via full-nav fallback. Impact is +100ms per click, no user-visible issue, only in DevTools console. Leave it.

How to apply:

When the user asks to "push to prod" or "deploy", offer to run the two-command manual flow — and explicitly include --no-build on the deploy.
A git push will appear to succeed but won't update prod (auto-build is skipped). That's intentional.
Site ID for --site= is d0f62630-5d43-42d4-98ae-86684e7a0df0.
Don't suggest building from Codespaces.
Related: [[project-r2-data-architecture]] [[project-netlify-build-wrapper]]



---
