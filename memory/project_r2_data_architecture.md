---
name: project-r2-data-architecture
description: "BTA bulk JSON data lives on Cloudflare R2 (bucket bta-data, public URL pub-86f242cc47a6490a8a66813d2650b86d.r2.dev); Netlify only ships the ~25k app shell. Non-obvious operational state outside the code."
metadata: 
  node_type: memory
  type: project
  originSessionId: 6f55853a-6868-4c15-9309-40c8f3e51074
---

BTA migrated to hybrid Netlify + Cloudflare R2 in commit 299e9e59a (May 2026). The mechanics (dataUrl helper, sync script, postbuild cleanup) are in-code and self-documenting — these are the bits that aren't:

- **R2 bucket name:** `bta-data`
- **Public URL:** `https://pub-86f242cc47a6490a8a66813d2650b86d.r2.dev`
- **R2 CORS** is already configured (wildcard GET/HEAD) — do NOT re-apply.
- **`NEXT_PUBLIC_DATA_BASE`** is already set in Netlify env — do NOT re-set.
- **~153k bulk JSON** files on R2; ~25k app-shell files on Netlify. Deploys dropped from ~18 min to 3–5 min.
- **Sync command:** `npm run sync:r2` (idempotent, ETag-skip).

**Why:** Netlify's deploy time was scaling poorly with the JSON corpus; R2 is cheap object storage and idempotent sync lets us re-run safely.

**How to apply:** If a task touches data fetching, prefer the `dataUrl()` helper in [src/lib/data-url.ts](src/lib/data-url.ts) rather than hardcoding `/data/...` paths. If a task asks to "re-sync" or "refresh" data, run `npm run sync:r2`. Do not propose re-configuring R2 CORS or Netlify env vars — both are already in place.

Related: [[project-data-freeze-until-october-2026]]
