/**
 * guard-rules.mjs — the repo's standing rules, checked before Claude Code runs a tool.
 *
 * WHY HOOKS AND NOT MEMORY. Every rule here was written into docs/WIP-handoff.md
 * after it was broken once. A written rule depends on a session remembering it;
 * this runs before every Bash, PowerShell, Read, Write and Edit call, in every
 * session and every subagent, and a deny holds even in bypass-permissions mode.
 *
 * TWO KINDS OF RULE.
 * - NEVER, with no override: `supabase db push`, printing secrets, writing a live
 *   key into a file, piping the dev server, committing the stray files.
 * - ASK FIRST: deploys, site builds, writes to R2, live database changes,
 *   publishing the installer, upstream pulls during the data freeze, force
 *   pushes, merging the legal pages. Blocked until Colin says go for that one
 *   action; the command then carries BTA_GO=<scope>, which shows in the
 *   transcript. A speed bump against accidents, not a lock: it cannot know that
 *   Colin said go, only that someone chose to type it.
 *
 * MENTIONS ARE NOT RUNS. A grep for "netlify deploy", or a commit message that
 * names it, is not a deploy: heredoc bodies and quoted text with spaces in it
 * are dropped before matching, and a command matches only where a command starts.
 *
 * Tests: node .claude/hooks/guard.test.mjs (also part of `npm run verify`).
 */
import { execFileSync } from "node:child_process";
import { basename } from "node:path";

/** First day of the thaw (scripts/lib/data-freeze.mjs). */
export const THAW = Date.parse("2026-10-01T00:00:00Z");

/** Untracked files that sit in the tree for good and must never be committed. */
export const STRAY = ["deno.lock", "has_about.html", "he_blog.html", "public/images/Untitled-4.ai", "public/images/newbtalogo-01.svg"];

const PORPAG = /(^|\/)public\/data\/porpag-[^/]*\.json$/;

/** A live Stripe, webhook or Anthropic key, as its shape. */
const LIVE_KEY = /\b(?:sk|rk)_live_[A-Za-z0-9]{10,}|\bwhsec_[A-Za-z0-9]{20,}|\bsk-ant-[A-Za-z0-9_-]{20,}/;

/**
 * Scripts that pull upstream data. The ingest scripts among them do not call
 * assertUnfrozen themselves (docs/WIP-handoff.md, "THE INGEST SCRIPTS DO NOT
 * GUARD THE FREEZE THEMSELVES"), so the freeze is enforced here too.
 */
const NETWORK_SCRIPTS = [
  "cbbd-ingest",
  "cbbd-repair-plays",
  String.raw`pull-[\w-]+`,
  "sync-bart",
  String.raw`scrape-[\w-]+`,
  "fetch-player-images",
  "fetch-rsci-history",
  "fetch-ttz-logos",
  "snapshot-coaches",
  "snapshot-historical-coaches",
  "refresh-portal",
  "daily-refresh",
  "nightly-refresh",
  "build-season-preview",
].join("|");
const NETWORK_NPM = String.raw`sync:bart|scrape:[\w-]+|fetch:photos|snapshot:coach(?:es|-history)|refresh:(?:nightly|portal)`;

/**
 * The command as a shell would run it, without the text it only carries: heredoc
 * bodies, PowerShell here-strings, and quoted strings with a space in them
 * (commit messages, grep patterns, SQL). A quoted word with no space in it, such
 * as a path, keeps its content.
 */
export function shellText(cmd) {
  return cmd
    .replace(/@'[\s\S]*?\r?\n'@/g, " ")
    .replace(/@"[\s\S]*?\r?\n"@/g, " ")
    .replace(/<<-?[ \t]*(['"]?)([A-Za-z_]\w*)\1[^\n]*\n(?:[\s\S]*?\n)?[ \t]*\2[ \t]*(?=\r?\n|$)/g, "\n")
    .replace(/"((?:[^"\\\n]|\\.)*)"/g, (_, s) => (/\s/.test(s) ? '""' : s))
    .replace(/'([^'\n]*)'/g, (_, s) => (/\s/.test(s) ? "''" : s));
}

/** Where a command can start: the beginning, after a separator, after env assignments or a runner. */
const START = String.raw`(?:^|[\n;&|({!]|\b(?:then|do|else|time|exec|xargs)\s)\s*(?:[A-Za-z_]\w*=\S*\s+)*(?:(?:npx|pnpm\s+exec|cmd(?:\.exe)?\s+/c|call)\s+(?:--?\S+\s+)*)?`;

const runs = (text, re) => new RegExp(START + re, "i").test(text);

/** node, tsx or bun running one of the named scripts, by any path to it. */
const script = (text, names) => new RegExp(START + String.raw`(?:node|tsx|bun)\s+(?:--?\S+\s+)*\S*?(?:${names})\.(?:m?[jt]s|cjs)\b`, "i").test(text);

const npmRun = (text, names) => runs(text, String.raw`npm\s+run(?:-script)?\s+(?:${names})(?=\s|$|[;&|)])`);

const never = (rule, reason) => ({ decision: "deny", rule, reason: `BLOCKED (${rule}): ${reason} This rule has no override.` });

function ask(rule, scope, reason, raw) {
  if (new RegExp(String.raw`BTA_GO\s*=\s*['"]?[\w,]*\b${scope}\b`).test(raw)) return null;
  return {
    decision: "deny",
    rule,
    reason:
      `BLOCKED (${rule}): ${reason} Run it only after Colin says go for this exact action in this conversation. ` +
      `Then put BTA_GO=${scope} in the command (Bash: \`BTA_GO=${scope} <command>\`; PowerShell: \`$env:BTA_GO='${scope}'; <command>\`) and say that you are using his go.`,
  };
}

/**
 * @param {{ tool_name?: string, tool_input?: Record<string, unknown>, cwd?: string }} input the hook's stdin
 * @param {{ now?: number, staged?: string[], modified?: string[] }} ctx overrides for tests
 * @returns {{ decision: "deny", rule: string, reason: string } | null}
 */
export function decide(input, ctx = {}) {
  const tool = input.tool_name;
  const ti = input.tool_input ?? {};
  if (tool === "Read") return readRule(ti.file_path);
  if (tool === "Write" || tool === "Edit" || tool === "MultiEdit" || tool === "NotebookEdit") return writeRule(ti);
  if (tool === "Bash" || tool === "PowerShell") return commandRule(String(ti.command ?? ""), { ...ctx, now: ctx.now ?? Date.now(), cwd: input.cwd });
  return null;
}

const isEnvFile = (base) => /^\.env(\.[\w.-]+)?$/i.test(base) && !/\.(example|sample|template)$/i.test(base);

function readRule(path) {
  const base = basename(String(path ?? "").replace(/\\/g, "/"));
  if (isEnvFile(base))
    return never("secrets", `${base} holds live keys, and secrets never enter the transcript. Check a key's shape without printing it: whether it is set, and its prefix.`);
  return null;
}

function writeRule(ti) {
  const path = String(ti.file_path ?? ti.notebook_path ?? "").replace(/\\/g, "/");
  const texts = [ti.content, ti.new_string, ti.new_source, ...(Array.isArray(ti.edits) ? ti.edits.map((e) => e?.new_string) : [])].filter(
    (t) => typeof t === "string",
  );
  if (texts.some((t) => LIVE_KEY.test(t)))
    return never("secrets", "That text contains what looks like a live secret key. Keys live in .env.local and Netlify's environment, never in a file written here.");
  if (isEnvFile(basename(path))) return never("secrets", "Keys in .env files are Colin's to set; writing one puts its values in the transcript.");
  if (/(^|\/)desktop\/src\//.test(path) && texts.some((t) => /ANTHROPIC_API_KEY/.test(t)))
    return never("desktop-api-key", "The Anthropic key never ships inside the desktop app. Plain-English questions go through the site's /api/parse-query (desktop/src/main/calc.ts).");
  return null;
}

function commandRule(raw, ctx) {
  const t = shellText(raw);

  // ── NEVER ────────────────────────────────────────────────────────────────
  if (runs(t, String.raw`supabase\s+(?:--\S+\s+)*db\s+push\b`))
    return never("db-push", "`supabase db push` can replay hand-applied older migrations on the live project. Apply one reviewed file with `supabase db query --linked -f <file>`, after Colin approves it.");
  if (runs(t, String.raw`supabase\s+(?:--\S+\s+)*db\s+reset\b`) && /--linked|--db-url/.test(t)) return never("db-reset", "Resetting the linked database wipes production.");
  if (LIVE_KEY.test(raw)) return never("secrets", "The command contains what looks like a live secret key.");
  if (printsSecrets(t, raw))
    return never("secrets", "That would print secrets into the transcript. Check a key's shape only: whether it is set, and its prefix (sk_live_, whsec_, price_), never its value.");
  if (runs(t, String.raw`(?:npm\s+run\s+dev(?::\w+)?|netlify\s+dev|next\s+dev)\b[^\n;&|]*\|(?!\|)`))
    return never("dev-pipe", "Piping the dev server into head or grep kills it with SIGPIPE and orphans netlify's children. Run it in the background and read its output instead.");
  const stray = strayArg(t);
  if (stray) return never("stray-files", `${stray} is a stray untracked file that must never be committed.`);
  if (runs(t, String.raw`git\s+add\b[^\n;&|]*\s(?:-A|--all|-u|--update|\.|\*|:/)(?=\s|$|[;&|)])`))
    return never("git-add-all", "Stage explicit paths. A blanket add picks up the stray untracked files (deno.lock, has_about.html, ...) and the porpag-*.json churn.");
  if (runs(t, String.raw`git\s+commit\b`)) {
    const r = commitRule(t, raw, ctx);
    if (r) return r;
  }

  // ── ASK FIRST ────────────────────────────────────────────────────────────
  if (runs(t, String.raw`netlify\s+deploy\b`))
    return ask("deploy", "deploy", "Deploys go to production and can take over an hour. The pipeline, once approved: build, `node scripts/sync-pages-to-r2.mjs`, then `netlify deploy --prod --dir=out --no-build`, backgrounded.", raw);
  if (runs(t, String.raw`netlify\s+(?:env:(?:set|unset|import|clone)|sites?:(?:delete|update|create)|link\b|unlink\b)`))
    return ask("netlify-config", "netlify", "That changes the production site's settings.", raw);
  if (siteBuild(t, ctx))
    return ask("site-build", "build", "A site build runs for tens of minutes, rewrites the porpag-*.json files, and needs the dev servers stopped first.", raw);
  if (script(t, "publish-release") && /(?:^|\s)--apply\b/.test(t))
    return ask("publish-installer", "publish", "Publishing the installer rewrites the update feed that every installed copy reads.", raw);
  if (r2Write(t)) return ask("r2-write", "r2", "That writes to the production R2 buckets.", raw);
  if (dbWrite(t, raw)) return ask("live-db", "db", "That changes the live Supabase project, where migrations go one reviewed file at a time.", raw);
  if (
    runs(t, String.raw`git\s+push\b[^\n;&|]*\s(?:--force(?:-with-lease)?(?:=\S*)?|-f|--mirror|--delete|-d)(?=\s|$|[;&|)])`) ||
    runs(t, String.raw`git\s+push\b[^\n;&|]*\s\+[\w/.-]+`)
  )
    return ask("force-push", "force", "Force-pushing or deleting a remote branch rewrites shared history.", raw);
  if (runs(t, String.raw`git\s+(?:merge|cherry-pick|rebase|pull)\b[^\n;&|]*\blegal-pages\b`) || runs(t, String.raw`git\s+(?:checkout|restore)\b[^\n;&|]*legal-pages`))
    return ask("legal-pages", "legal", "The legal pages stay on their branch until the legal entity name is filled in.", raw);
  if (ctx.now < THAW) {
    const r = freezeRule(t, raw, ctx.now);
    if (r) return r;
  }
  return null;
}

const ENV_ARG = String.raw`(?:^|[\s=/\\])\.env(?:\.(?!example\b|sample\b|template\b)[\w.-]+)?(?=$|[\s;&|)<>])`;

function printsSecrets(t, raw) {
  if (runs(t, String.raw`(?:cat|type|more|less|head|tail|bat|nl|tac|od|xxd|strings|gc|Get-Content|sed|awk|cut|sort|uniq|jq)\b[^\n;&|]*` + ENV_ARG)) return true;
  // A search prints the lines it matches unless it is told only to count, list or test.
  const grep = new RegExp(START + String.raw`(?:grep|egrep|rg|findstr|Select-String|sls)\b([^\n;&|]*?)` + ENV_ARG, "i").exec(t);
  if (grep && !/\s-[a-zA-Z]*[qlcL][a-zA-Z]*(?=\s|$)|--(?:quiet|count|files-with-matches|files-without-match)\b|\s-Quiet\b/i.test(grep[1])) return true;
  if (runs(t, String.raw`printenv\b`)) return true;
  if (runs(t, String.raw`(?:env|set|Get-ChildItem\s+env:|gci\s+env:|dir\s+env:|ls\s+env:)(?=\s*$|\s*[;&|)])`)) return true;
  if (runs(t, String.raw`netlify\s+env:(?:get|list|export)\b`)) return true;
  return /console\.(?:log|dir|table)\(\s*process\.env\s*\)|JSON\.stringify\(\s*process\.env\s*[,)]|\[Environment\]::GetEnvironmentVariables/i.test(raw);
}

/** A stray file named in a git add or commit. */
function strayArg(t) {
  const re = new RegExp(START + String.raw`git\s+(?:add|commit)\b([^\n;&|]*)`, "gi");
  for (const m of t.matchAll(re)) {
    const args = m[1].replace(/\\/g, "/");
    const hit = STRAY.find((s) => new RegExp(String.raw`(?:^|[\s/])${s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?=\s|$)`).test(args));
    if (hit) return hit;
  }
  return null;
}

function gitLines(cwd, args) {
  try {
    const opts = { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], timeout: 5000 };
    const top = execFileSync("git", ["rev-parse", "--show-toplevel"], { ...opts, cwd }).trim();
    return execFileSync("git", args, { ...opts, cwd: top }).split(/\r?\n/).filter(Boolean);
  } catch {
    return [];
  }
}

function commitRule(t, raw, ctx) {
  const staged = ctx.staged ?? gitLines(ctx.cwd, ["diff", "--cached", "--name-only"]);
  const all = /\bgit\s+commit\b[^\n;&|]*\s(?:-[a-zA-Z]*a[a-zA-Z]*|--all)(?=\s|$|[;&|)])/.test(t);
  const modified = all ? (ctx.modified ?? gitLines(ctx.cwd, ["diff", "--name-only"])) : [];
  const files = [...staged, ...modified];
  const stray = files.find((f) => STRAY.includes(f));
  if (stray) return never("stray-files", `${stray} would be committed. It is a stray file that must never be: git restore --staged ${stray}`);
  const churn = files.filter((f) => PORPAG.test(f));
  if (churn.length)
    return ask("porpag-churn", "porpag", `${churn.length} porpag-*.json file(s) would be committed, and they are usually built_at-only churn. Check the diff, then \`git restore --staged\` and \`git checkout --\` them.`, raw);
  return null;
}

function siteBuild(t, ctx) {
  const inDesktop = /[\\/]desktop[\\/]?$/i.test(ctx.cwd ?? "") || /\bcd\s+\S*desktop\b|--prefix[= ]\S*desktop|\s-C\s+\S*desktop/i.test(t);
  if (runs(t, String.raw`npm\s+run\s+build(?=\s|$|[;&|)])`) && !inDesktop) return true;
  return /\bnext(?:\.js)?\s+build\b/i.test(t) || runs(t, String.raw`netlify\s+build\b`);
}

function r2Write(t) {
  if (script(t, "sync-pages-to-r2|sync-data-to-r2|publish-run-record")) return true;
  if (script(t, "sync-gated-corpora") && (!/\s--verify\b/.test(t) || /\s--yes\b/.test(t))) return true;
  if (script(t, "backup-archive-to-r2") && (/\s--restore\b/.test(t) || !/\s--(?:verify|dry-run)\b/.test(t))) return true;
  if (script(t, "r2-snapshot") && /\s--(?:snapshot|restore)\b/.test(t)) return true;
  if (script(t, "prune-r2-prefix") && /\s--delete\b/.test(t)) return true;
  if (npmRun(t, "sync:r2|backup:archive|restore:archive")) return true;
  if (npmRun(t, "r2:snapshot") && /\s--(?:snapshot|restore)\b/.test(t)) return true;
  return (
    runs(t, String.raw`wrangler\s+r2\s+object\s+(?:put|delete)\b`) ||
    runs(t, String.raw`aws\s+s3\s+(?:cp|mv|rm|sync)\b`) ||
    runs(t, String.raw`aws\s+s3api\s+(?:put|delete|copy)`) ||
    runs(t, String.raw`rclone\s+(?:copy|sync|move|delete|purge)\b`)
  );
}

function dbWrite(t, raw) {
  if (runs(t, String.raw`supabase\s+(?:--\S+\s+)*(?:functions\s+deploy|secrets\s+(?:set|unset)|storage\s+(?:rm|cp|mv))\b`)) return true;
  if (!/--linked\b|--db-url\b/.test(t)) return false;
  if (runs(t, String.raw`supabase\s+(?:--\S+\s+)*migration\s+(?:up|repair|squash)\b`)) return true;
  if (!runs(t, String.raw`supabase\s+(?:--\S+\s+)*db\s+(?:query|execute)\b`)) return false;
  return /\s(?:-f|--file)(?:\s|=)/.test(t) || /\b(?:insert|update|delete|upsert|alter|create|drop|grant|revoke|truncate|comment\s+on|refresh\s+materialized)\b/i.test(raw);
}

function freezeRule(t, raw, now) {
  const days = Math.ceil((THAW - now) / 86_400_000);
  const why = `The data freeze runs until 2026-10-01 (${days} days), and several ingest scripts do not guard it themselves; one run already upserted 365 teams and 4,965 players mid-freeze.`;
  if (/BTA_ALLOW_NETWORK\s*=\s*['"]?1/.test(raw)) return ask("data-freeze", "network", `${why} BTA_ALLOW_NETWORK=1 is the escape hatch.`, raw);
  if (script(t, NETWORK_SCRIPTS) || npmRun(t, NETWORK_NPM)) return ask("data-freeze", "network", why, raw);
  return null;
}
