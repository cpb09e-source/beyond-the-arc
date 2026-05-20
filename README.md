This is a [Next.js](https://nextjs.org) project bootstrapped with [`create-next-app`](https://nextjs.org/docs/app/api-reference/cli/create-next-app).

## Data architecture (Netlify + Cloudflare R2)

The site is statically exported and deployed to Netlify, but bulk per-entity JSON (~150k files under `public/data/{team-games,player-games,player,player-ranks,tournament-box,team}/`) is mirrored to a public Cloudflare R2 bucket instead of riding along in the Netlify upload. Netlify only ships the ~25k app-shell files, dropping deploys from ~18 min to 3–5 min.

How it stitches together:

- [`dataUrl()`](src/lib/data-url.ts) — rewrites any `/data/<r2-mirrored-dir>/...` path to `${NEXT_PUBLIC_DATA_BASE}/...` in production. In dev `NEXT_PUBLIC_DATA_BASE` is unset, so paths resolve to the local `/public` mirror. All fetch sites use this helper.
- [`scripts/sync-data-to-r2.mjs`](scripts/sync-data-to-r2.mjs) (`npm run sync:r2`) — uploads the mirrored dirs to R2. Idempotent: HEADs each object and skips when local md5 matches the remote ETag, so a re-run after a partial failure only uploads what changed.
- [`scripts/strip-r2-mirrored-from-out.mjs`](scripts/strip-r2-mirrored-from-out.mjs) — runs as `postbuild` and deletes the R2-mirrored dirs from `out/` so Netlify doesn't re-upload them.

Required env in `.env.local` (for `sync:r2`): `R2_ENDPOINT`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET`. The browser-side `NEXT_PUBLIC_DATA_BASE` is set in Netlify env (don't re-set). R2 bucket CORS is already configured (wildcard GET/HEAD) — don't re-apply.

### Refreshing data

The CBB data is frozen during the offseason (May → October). To push a new season's data after the next `npm run export:data`:

```bash
npm run sync:r2
```

ETag-skip means only files whose content changed get re-uploaded.

## Getting Started

First, run the development server:

```bash
npm run dev
# or
yarn dev
# or
pnpm dev
# or
bun dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

You can start editing the page by modifying `app/page.tsx`. The page auto-updates as you edit the file.

This project uses [`next/font`](https://nextjs.org/docs/app/building-your-application/optimizing/fonts) to automatically optimize and load [Geist](https://vercel.com/font), a new font family for Vercel.

## Learn More

To learn more about Next.js, take a look at the following resources:

- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js features and API.
- [Learn Next.js](https://nextjs.org/learn) - an interactive Next.js tutorial.

You can check out [the Next.js GitHub repository](https://github.com/vercel/next.js) - your feedback and contributions are welcome!

## Deploy on Vercel

The easiest way to deploy your Next.js app is to use the [Vercel Platform](https://vercel.com/new?utm_medium=default-template&filter=next.js&utm_source=create-next-app&utm_campaign=create-next-app-readme) from the creators of Next.js.

Check out our [Next.js deployment documentation](https://nextjs.org/docs/app/building-your-application/deploying) for more details.
