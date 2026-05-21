
- [User role](user_role.md) — Colin: solo operator of BTA, also maintains caratkarat; confirm cwd if ambiguous
- [R2 data architecture](project_r2_data_architecture.md) — bulk JSON on R2 bucket bta-data; CORS + Netlify env already configured, don't re-do
- [Data freeze until Oct 2026](project_data_freeze_until_october_2026.md) — CBB offseason; re-run `npm run sync:r2` in October
- [Netlify build wrapper](project_netlify_build_wrapper.md) — production build uses scripts/build-with-r2-stash.mjs (strips R2 dirs AFTER `next build`); .txt RSC payloads MUST stay
- [Manual deploy pipeline](project_manual_deploy_pipeline.md) — build locally, deploy with `netlify deploy --prod --dir=out --site=d0f62630... --no-build` (--no-build is critical); don't build on Codespaces
- [Dev environment](project_dev_environment.md) — Next 16 dev defaults to Turbopack; on 8GB XPS use `npm run dev -- --webpack` (PostCSS worker timeout); try Turbopack first on the home PC
- [Design system docs](project_design_system_docs.md) — PRODUCT.md + DESIGN.md at repo root; load before any polish/critique/craft work; cite specific principles when proposing changes
- [Design tooling](reference_design_tooling.md) — Playwright MCP + Taste + Impeccable installed user-level on XPS; commands recorded for mirroring on home PC
