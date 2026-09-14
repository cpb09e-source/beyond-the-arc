/**
 * Checks for ./guard-rules.mjs: what must pass, what must be blocked and by which
 * rule, and that a mention is never taken for a run.
 *
 *   node .claude/hooks/guard.test.mjs
 *
 * Keys below are assembled at run time, so this file never holds the shape it tests.
 */
import { decide, shellText, THAW } from "./guard-rules.mjs";

const FROZEN = Date.parse("2026-09-14T12:00:00Z");
const THAWED = THAW + 86_400_000;
const liveKey = ["sk", "live", "a1B2c3D4e5F6g7H8i9J0k1L2"].join("_");

const bash = (command, cwd = "C:/Users/Colin/websites/beyond-the-arc") => ({ tool_name: "Bash", tool_input: { command }, cwd });
const ps = (command) => ({ tool_name: "PowerShell", tool_input: { command }, cwd: "C:/Users/Colin/websites/beyond-the-arc" });

/** [label, input, expected rule or null, ctx] */
const CASES = [
  // ── Mentions are not runs ──
  ["grep for a deploy command", bash(`grep -rn "netlify deploy --prod" docs`), null],
  ["commit message naming a deploy", bash(`git commit -m "Deploy notes: netlify deploy needs --no-build"`), null, { staged: ["docs/x.md"] }],
  ["heredoc commit message", bash(`git commit -F - <<'EOF'\nnetlify deploy --prod\nsupabase db push\nEOF`), null, { staged: ["docs/x.md"] }],
  ["echo naming .env.local", bash(`echo "keys live in .env.local"`), null],
  ["here-string naming a push", ps(`$msg = @'\nsupabase db push\n'@; Write-Output done`), null],

  // ── Ordinary work passes ──
  ["desktop build", bash(`cd desktop && npm run build`), null],
  ["desktop dist", bash(`cd /c/Users/Colin/websites/beyond-the-arc/desktop && npm run dist`), null],
  ["desktop typecheck", bash(`npm run typecheck`, "C:/Users/Colin/websites/beyond-the-arc/desktop"), null],
  ["publish-release dry run", bash(`node desktop/scripts/publish-release.mjs`), null],
  ["prune dry run", bash(`node scripts/prune-r2-prefix.mjs games/old`), null],
  ["snapshot status", bash(`node scripts/r2-snapshot.mjs --status`), null],
  ["archive verify", bash(`node scripts/backup-archive-to-r2.mjs --verify`), null],
  ["count a key without printing it", bash(`grep -c STRIPE_SECRET_KEY .env.local`), null],
  ["read-only linked query", bash(`supabase db query --linked "select count(*) from profiles"`), null],
  ["dev server backgrounded", bash(`BTA_CDP_PORT=9223 npm run dev`), null],
  ["explicit add", bash(`git add desktop/src/renderer/src/app.tsx docs/desktop-app-plan.md`), null],
  ["plain push", bash(`git push origin main`), null],
  ["reading package.json", bash(`cat package.json`), null],
  ["Read .env.example", { tool_name: "Read", tool_input: { file_path: "C:/Users/Colin/websites/beyond-the-arc/.env.example" } }, null],
  ["Write desktop code without a key", { tool_name: "Write", tool_input: { file_path: "C:/x/desktop/src/main/calc.ts", content: "fetch('/api/parse-query')" } }, null],
  ["sync-bart after the thaw", bash(`npx tsx scripts/sync-bart.mts`), null, { now: THAWED }],
  ["local data build", bash(`npm run build:game-index`), null],

  // ── Never ──
  ["db push", bash(`supabase db push`), "db-push"],
  ["db push with a go", bash(`BTA_GO=db supabase db push`), "db-push"],
  ["cat .env.local", bash(`cat .env.local`), "secrets"],
  ["Get-Content .env.local", ps(`Get-Content .env.local`), "secrets"],
  ["grep printing .env lines", bash(`grep STRIPE .env.local`), "secrets"],
  ["env piped to grep", bash(`env | grep KEY`), "secrets"],
  ["printenv", bash(`printenv STRIPE_SECRET_KEY`), "secrets"],
  ["netlify env:list", bash(`netlify env:list`), "secrets"],
  ["dump process.env", bash(`node -e "console.log(process.env)"`), "secrets"],
  ["Read .env.local", { tool_name: "Read", tool_input: { file_path: "C:\\Users\\Colin\\websites\\beyond-the-arc\\.env.local" } }, "secrets"],
  ["Write a live key", { tool_name: "Write", tool_input: { file_path: "C:/x/notes.md", content: `key=${liveKey}` } }, "secrets"],
  ["Edit a live key in", { tool_name: "Edit", tool_input: { file_path: "C:/x/a.ts", old_string: "a", new_string: liveKey } }, "secrets"],
  ["Anthropic key in desktop code", { tool_name: "Edit", tool_input: { file_path: "C:\\x\\desktop\\src\\main\\ai.ts", old_string: "a", new_string: "process.env.ANTHROPIC_API_KEY" } }, "desktop-api-key"],
  ["dev server piped", bash(`npm run dev | head -20`), "dev-pipe"],
  ["git add -A", bash(`git add -A`), "git-add-all"],
  ["git add .", bash(`cd desktop && git add .`), "git-add-all"],
  ["git add a stray file", bash(`git add deno.lock`), "stray-files"],
  ["stray file staged", bash(`git commit -m "x"`), "stray-files", { staged: ["he_blog.html"] }],

  // ── Ask first ──
  ["deploy", bash(`netlify deploy --prod --dir=out --no-build`), "deploy"],
  ["deploy after cd", bash(`cd /c/Users/Colin/websites/beyond-the-arc && netlify deploy --prod`), "deploy"],
  ["deploy through npx", bash(`npx netlify deploy --prod`), "deploy"],
  ["deploy from PowerShell", ps(`& netlify deploy --prod --dir=out --no-build`), "deploy"],
  ["deploy with a go", bash(`BTA_GO=deploy netlify deploy --prod --dir=out --no-build`), null],
  ["netlify env:set", bash(`netlify env:set FOO bar`), "netlify-config"],
  ["site build", bash(`npm run build`), "site-build"],
  ["next build directly", bash(`node --max-old-space-size=8192 ./node_modules/next/dist/bin/next build`), "site-build"],
  ["site build with a go", bash(`BTA_GO=build npm run build`), null],
  ["publish the installer", bash(`node "C:\\Users\\Colin\\websites\\beyond-the-arc\\desktop\\scripts\\publish-release.mjs" --apply`), "publish-installer"],
  ["sync pages to R2", bash(`node scripts/sync-pages-to-r2.mjs`), "r2-write"],
  ["sync pages to R2, PowerShell go", ps(`$env:BTA_GO='r2'; node scripts/sync-pages-to-r2.mjs`), null],
  ["npm sync:r2", bash(`npm run sync:r2 -- --only team-splits`), "r2-write"],
  ["snapshot the live season", bash(`node scripts/r2-snapshot.mjs --snapshot`), "r2-write"],
  ["prune for real", bash(`node scripts/prune-r2-prefix.mjs games/old --delete`), "r2-write"],
  ["aws s3 sync", bash(`aws s3 sync out s3://bucket --endpoint-url https://x.r2.cloudflarestorage.com`), "r2-write"],
  ["migration file on the live project", bash(`supabase db query --linked -f supabase/migrations/013_x.sql`), "live-db"],
  ["inline write on the live project", bash(`supabase db query --linked "update profiles set tier = 'x'"`), "live-db"],
  ["force push", bash(`git push --force origin main`), "force-push"],
  ["force push with lease", bash(`git push --force-with-lease`), "force-push"],
  ["merge the legal pages", bash(`git merge legal-pages`), "legal-pages"],
  ["porpag churn staged", bash(`git commit -m "x"`), "porpag-churn", { staged: ["public/data/porpag-2026.json"] }],
  ["porpag churn through -am", bash(`git commit -am "x"`), "porpag-churn", { staged: [], modified: ["public/data/porpag-2025.json"] }],
  ["porpag with a go", bash(`BTA_GO=porpag git commit -m "Rebuilt porpag"`), null, { staged: ["public/data/porpag-2026.json"] }],
  ["sync-bart in the freeze", bash(`npx tsx scripts/sync-bart.mts`), "data-freeze"],
  ["ingest with the escape hatch", bash(`BTA_ALLOW_NETWORK=1 node scripts/cbbd-ingest.mjs`), "data-freeze"],
  ["ingest with hatch and go", bash(`BTA_GO=network BTA_ALLOW_NETWORK=1 node scripts/cbbd-ingest.mjs`), null],
  ["pull script in the freeze", bash(`node scripts/pull-rankings.mjs`), "data-freeze"],
  ["npm scraper in the freeze", bash(`npm run scrape:nba-players`), "data-freeze"],
  ["hatch from PowerShell", ps(`$env:BTA_ALLOW_NETWORK='1'; node scripts/pull-team-box-v2.mjs`), "data-freeze"],
];

let failed = 0;
for (const [label, input, want, ctx] of CASES) {
  const got = decide(input, { now: FROZEN, staged: [], modified: [], ...ctx });
  const rule = got?.rule ?? null;
  if (rule !== want) {
    failed++;
    console.log(`FAIL  ${label}: expected ${want ?? "pass"}, got ${rule ?? "pass"}`);
    console.log(`      stripped: ${JSON.stringify(shellText(String(input.tool_input.command ?? "")))}`);
  }
}
const denies = CASES.filter((c) => c[2]).length;
console.log(failed ? `\n${failed} of ${CASES.length} guard checks FAILED` : `ALL ${CASES.length} GUARD CHECKS PASSED (${denies} blocked, ${CASES.length - denies} passed through)`);
process.exit(failed ? 1 : 0);
