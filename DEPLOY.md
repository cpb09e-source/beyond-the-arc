# Deploying Beyond the Arc

Production is a **manual, local** deploy. Netlify's hosted build runner times out
(~18 min cap) on this site's ~23k static pages, so we build locally (no cap) and
upload the result. Auto-deploys on `git push` are **disabled** (`netlify.toml`
`ignore = "exit 0"`), so pushing to GitHub never updates prod by itself.

> The slow part is the **build** (regenerating ~23k pages, ~5–10 min). The
> **upload is already incremental** — Netlify digests every file and only uploads
> what changed. You are never re-pushing 23k pages.

---

## 1. Full deploy (code / metadata / data changed)

Any code change forces a full rebuild — `output: export` has no partial build.

```bash
node scripts/build-with-r2-stash.mjs        # local build + strip R2 dirs + .txt, ~5–10 min
netlify deploy --prod --dir=out --no-build  # upload the diff, ~30s–2 min
```

**Always pass `--no-build`.** Newer Netlify CLI re-runs the build on `deploy` by
default; since we just built `out/` ourselves, `--no-build` skips a redundant
second build (otherwise the deploy silently rebuilds all 23k pages again).

Preview first (optional) — same command without `--prod` gives a draft URL:

```bash
netlify deploy --dir=out --no-build
```

---

## 2. Fast path — asset-only change (OG image, favicon, a file in `public/`)

If you only changed a **static asset** (no code/metadata), skip the build entirely:

```bash
cp public/images/your-og.png out/images/your-og.png   # update the already-built copy
netlify deploy --prod --dir=out --no-build             # ~30s, uploads just that file
```

**Keep the asset filename stable** (overwrite the same path). Then the page HTML's
`<meta og:image>` tags never change, so no rebuild is ever needed for swaps — just
replace the file in `out/` and `--no-build` deploy.

This works for: OG/social images, favicons, fonts, anything under `public/` that
isn't referenced by changed HTML. It does **not** work if you edited the metadata
itself (e.g. changed the OG path in `layout.tsx`) — that changes the page HTML and
needs a full rebuild.

---

## Rules of thumb

| Change | Rebuild? | Command |
| --- | --- | --- |
| OG image / favicon / static asset (same filename) | No | `cp` into `out/` → `deploy --no-build` |
| Component / page / metadata / data JSON | Yes | build wrapper → `deploy --no-build` |
| Anything → GitHub | n/a | `git push` does **not** deploy (intentional) |

- `git push` and `netlify deploy` are independent — commit whenever; deploy whenever.
- The build wrapper's `.txt` strip (Next 16 RSC prefetch payloads) takes the upload
  from ~215k files to ~32k — don't remove it.

Related: `memory/project_manual_deploy_pipeline.md`, `netlify.toml`.
