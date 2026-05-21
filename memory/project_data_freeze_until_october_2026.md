
---
name: project-data-freeze-until-october-2026
description: BTA data is frozen (no new games/box scores) until October 2026; next R2 re-sync is queued for then.
metadata: 
  node_type: memory
  type: project
  originSessionId: 6f55853a-6868-4c15-9309-40c8f3e51074
---

The CBB data backing BTA is frozen until October 2026 (offseason). No new player-games, box scores, or composite updates land until then.

**Why:** College basketball offseason — there's no upstream data to ingest, so the R2 corpus is static.

**How to apply:** Don't propose data-ingestion work, scraper changes, or pipeline tweaks during May–September 2026 unless the user explicitly raises it. When October 2026 rolls around, the queued action is `npm run sync:r2` to push the new season's data to R2.

Related: [[project-r2-data-architecture]]
