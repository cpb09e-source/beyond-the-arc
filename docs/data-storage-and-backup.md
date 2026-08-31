# Where the data lives, and what happens if a disk dies

Written 2026-08-30, from a full measurement of the tree.

## The four places

| | size | files | tracked in git? | backed up? |
|---|---|---|---|---|
| `data/cbbd` — raw API archive | 945 MB | 2,106 | no (gitignored) | **R2 private bucket** |
| `data/derived` | 12 MB | ~5 | no (gitignored) | no — rebuilt from cbbd |
| `public/data` — derived, shipped | 1,632 MB | 162,986 | yes, except `game-index` | git + (most of it) R2 |
| `public/images` | 301 MB | 20,244 | yes | git |

Plus: `.git` is 1.34 GB of pack, and a full `out/` is 13.0 GB across 320,022
files.

## What is on R2, and in which bucket

**Two buckets, and the difference matters.**

`bta-data` (`R2_BUCKET`) is **public** — it is what `NEXT_PUBLIC_DATA_BASE`
serves to browsers. Nine directories are mirrored into it, listed in `R2_DIRS`
in `src/lib/data-url.ts`, and the same list has to be kept in step in three
other places (see below). `npm run sync:r2` uploads it.

The archive bucket (`R2_ARCHIVE_BUCKET`) is **private** — no public access, no
r2.dev subdomain, no custom domain, and its own scoped API token. It holds one
thing: `data/cbbd`, under a `cbbd/` prefix. `npm run backup:archive` uploads it.

Raw CBBD responses must never go in the public bucket. R2's public access is
per-bucket, not per-prefix, so there is no safe corner of `bta-data` for them —
putting them there would republish the upstream API at a guessable URL.

### Adding a directory to the public mirror

Four lists, and they are supposed to be identical:

1. `R2_DIRS` in `src/lib/data-url.ts` — decides what `dataUrl()` rewrites
2. `ALL_DIRS` in `scripts/sync-data-to-r2.mjs` — decides what gets uploaded
3. `STRIP_DIRS` in `scripts/build-with-r2-stash.mjs` — the one that runs on
   Netlify
4. `DIRS` in `scripts/strip-r2-mirrored-from-out.mjs` — the postbuild hook

Then the fetch site must call `dataUrl("/data/…")` rather than a bare path, or
production will ask Netlify for a file the build just stripped.

**Sync before you deploy.** The order is: build the data → `npm run sync:r2` →
deploy. A deploy that strips a directory R2 does not have yet is a 404 for
every reader.

### Why `game-index` is in the public mirror

Every other entry is there because of file **count** — Netlify's deploy upload
times out somewhere past 100k files, and `game-players` alone is 72,572.
`game-index` is twelve files. It is on R2 for a different reason: 80 MB that
`scripts/build-game-index.mjs` rewrites *in full* on every run, against a
`public/data` that is otherwise tracked in git. Shipping it through the deploy
would mean 80 MB of new git history per rebuild, forever. So it is gitignored
and mirrored instead.

## The archive backup

`data/cbbd` is the only irreplaceable thing here. Every derived file under
`public/data` is committed, so losing the archive would not take the site down
— it would end the ability to *change* it, since all twenty-odd `build-*.mjs`
scripts read from it.

Re-pulling is not a recovery plan. 1,883 of those 2,106 files are one day of
play-by-play each, fetched against a quota through a 3,000-row response cap
(see `docs/cbbd-api-quota.md`), and upstream corrects history — older seasons
would not come back byte-identical.

```
npm run backup:archive              # upload what changed
npm run verify:archive              # prove the backup matches local
npm run restore:archive             # pull it back onto a clean machine
node scripts/backup-archive-to-r2.mjs --season 2025 --dry-run
```

**Resumable.** R2 returns the md5 of a single-part upload as the object ETag,
so every run HEADs first and uploads only what differs. An interrupted backup
costs nothing to retry; a run after a fresh ingest uploads only the new days.

**The manifest is half the value.** Each run writes `data/cbbd-manifest.json` —
path, size, md5, mtime per file — and that file **is** committed. It is the
difference between "there is a backup somewhere" and "here is exactly what is
in it, and here is the checksum that proves a restore came back whole".

**A restore always reads the manifest, never the disk.** A file that is gone
locally cannot show up in a directory walk, so walking would skip exactly the
files a restore exists to fetch. Backup and verify walk the disk — their
question is "what do I have". Restore's question is "what am I supposed to
have", and only the manifest knows that.

**Run it after every `cbbd-ingest`.** A backup that lags the archive by a
season is a backup of the wrong thing.

### Setting it up (once, in the Cloudflare dashboard)

1. R2 → Create bucket, e.g. `bta-archive`. **Do not** enable public access, an
   r2.dev subdomain, or a custom domain.
2. R2 → API → Create API token, Object Read & Write, **scoped to that bucket
   only**. Separate from the site's sync credentials, so a leak of one cannot
   reach the other.
3. Add to `.env.local`:
   ```
   R2_ARCHIVE_BUCKET=bta-archive
   R2_ARCHIVE_ACCESS_KEY_ID=…
   R2_ARCHIVE_SECRET_ACCESS_KEY=…
   ```
   `R2_ENDPOINT` is already set — both buckets share the account URL.

The script refuses to run if `R2_ARCHIVE_BUCKET` equals `R2_BUCKET`, and it
never falls back to the public bucket's credentials. A typo that silently
published the raw archive is the one failure it is built to be incapable of.

### Cost

R2's free tier is 10 GB-month of storage with **zero egress**; the archive is
945 MB and the public mirror ~1.2 GB. Past free tier it is $0.015/GB-month —
about 3¢ a month for both. The 2,106 uploads sit inside the 1M/month Class A
allowance. Verify current tiers in the dashboard, but the order of magnitude
is not in question.

## Still not backed up

- **`.env.local`.** Losing it means re-issuing Supabase, Stripe and R2
  credentials. It belongs in a password manager — not in an object store, even
  a private one.
- **`data/derived`** (12 MB) — deliberately skipped. Rebuilt from `data/cbbd`
  in minutes, and backing up derived data is how a backup slowly becomes a
  second copy of everything.
- **An offline copy.** R2 is the offsite third leg. A local external drive
  would be the second, and it is the one still missing — R2 protects against
  disk failure, fire and theft, but a `--restore` needs the network and an
  hour.
