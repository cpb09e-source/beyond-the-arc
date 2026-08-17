#!/usr/bin/env node
/**
 * patch-preview-additions.mjs — add the players a school lists that we don't
 * carry, for named teams, in place.
 *
 * WHY THIS EXISTS. reconcile-preview-rosters.mjs deliberately only PRUNES
 * ("Adding is the builder's job"), and the builder is frozen out until
 * 2026-10-01. So between a fresh audit-rosters.mjs scrape and the next build,
 * every player a school added that Bart never had simply vanishes from the
 * preview — the prune runs, the add never does. Measured on the 2026-08-13
 * snapshot: 61 teams were missing at least one listed player and 17 were
 * showing fewer than eight, with Virginia Tech at 5 of 14 and Cal Baptist,
 * Houston Christian and USC Upstate at 2 of 15. A two-man roster is not a
 * stale roster, it is a broken page.
 *
 * WHAT IT DOES, per named team: re-scrapes the school's roster page, and for
 * every listed player we do not already carry, appends a row. Unlike the
 * builder's fallback — which can only mint a stats-less newcomer off a URL slug
 * — this reads the posted card, so the row arrives with the school's own class
 * and height, and portal.json supplies bart_id / "from" when the player is a
 * known transfer. Impact numbers are left null on purpose; patch-preview-
 * impact.mjs is what fills those, keyed on the bart_id set here.
 *
 * IT NEVER PRUNES. Dropping players is reconcile-preview-rosters.mjs's job and
 * its guards (MIN_POSTED, MIN_OVERLAP) are what make dropping safe. This script
 * reports anyone we carry that the school no longer lists and leaves them be.
 *
 * THE ONE DESTRUCTIVE CASE is a player listed by two schools, which is the
 * corruption the reconcile script was written to kill — Trent Perry on both
 * Kansas and UCLA credited both teams with his minutes. A school keeps a
 * departed player posted for weeks, so "both pages list him" is the norm, not a
 * contradiction. portal.json breaks the tie because it records the commitment
 * (team_from, team_to, status "Transferred") rather than a page's freshness:
 * where it says the player transferred TO the team being patched, he is moved,
 * not copied. Without a portal record saying that, he is skipped and reported.
 *
 * ON THE DATA FREEZE. This scrapes athletics sites, not the stat archive.
 * Rosters for a season that has not started are not part of the frozen corpus,
 * every row it writes carries NULL_STATS, and audit-rosters.mjs — the sibling
 * that scrapes these same pages — is ungated for the same reason. Nothing here
 * can mix a live stat into a committed season.
 *
 *   node scripts/patch-preview-additions.mjs --teams "Virginia Tech,Texas Tech"
 *   node scripts/patch-preview-additions.mjs --teams "..." --dry
 */
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";

const DATA = path.resolve("public/data");
const PREVIEW = path.join(DATA, "season-preview.json");
const OFFICIAL = path.join(DATA, "official-rosters-2026.json");
const PORTAL = path.join(DATA, "portal.json");

const DRY = process.argv.includes("--dry");
const teamsArg = process.argv[process.argv.indexOf("--teams") + 1];
if (!teamsArg || teamsArg.startsWith("--")) {
  console.error("usage: node scripts/patch-preview-additions.mjs --teams \"Team A,Team B\" [--dry]");
  process.exit(1);
}
const TEAMS = teamsArg.split(",").map((s) => s.trim()).filter(Boolean);

/** Below this the school has not finished posting; matches reconcile's guard. */
const MIN_POSTED = 9;
/**
 * A parse that finds far fewer players than there are player links on the page
 * means the layout moved and the field regexes are reading the wrong nodes.
 * Fall back to slugs rather than write half a roster with null classes.
 */
const PARSE_FLOOR = 0.6;

const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36";
const curl = (url) =>
  execFileSync("curl", ["-sL", "--max-time", "30", "-H", `user-agent: ${UA}`, "-H", "accept: text/html", url],
    { encoding: "utf8", maxBuffer: 48 * 1024 * 1024 });

// ── text helpers ──────────────────────────────────────────────────────────────
const ENT = {
  "&amp;": "&", "&quot;": '"', "&apos;": "'", "&nbsp;": " ",
  "&prime;": "'", "&Prime;": '"', "&rsquo;": "'", "&lsquo;": "'",
  "&eacute;": "é", "&egrave;": "è", "&ntilde;": "ñ", "&ouml;": "ö", "&uuml;": "ü",
  "&aacute;": "á", "&iacute;": "í", "&oacute;": "ó", "&uacute;": "ú", "&ccedil;": "ç",
};
const dec = (s) => (s ?? "")
  .replace(/<!--[\s\S]*?-->/g, "").replace(/<[^>]*>/g, " ")
  .replace(/&#(\d+);/g, (_, d) => String.fromCharCode(+d))
  .replace(/&[a-zA-Z]+;/g, (m) => ENT[m] ?? " ")
  .replace(/\s+/g, " ").trim();

/**
 * Schools label the same class three ways — "Senior", "Sr.", and "Fourth Year"
 * all appear across these six pages — so match on ordinal, word and abbrev.
 * Order matters: redshirt/graduate qualifiers are checked before the plain
 * class word they contain ("Redshirt Freshman" is not a freshman row to us).
 */
function normCls(raw) {
  const s = (raw ?? "").toLowerCase();
  if (!s) return null;
  if (/fifth|5th|grad|\bgr\b/.test(s)) return "Gr";
  if (/fourth|4th|senior|\bsr\b/.test(s)) return "Sr";
  if (/third|3rd|junior|\bjr\b/.test(s)) return "Jr";
  if (/second|2nd|sophomore|\bso\b/.test(s)) return "So";
  if (/first|1st|freshman|\bfr\b/.test(s)) return "Fr";
  return null;
}
/** 6'1" / 6' 4'' / 6′1″ → "6-1", the shape the preview already stores. */
function normHt(raw) {
  const m = dec(raw).match(/(\d)\s*['′’]\s*(\d{1,2})/);
  return m ? `${m[1]}-${m[2]}` : null;
}
/**
 * How much a spelling carries that a URL slug cannot: punctuation, and capitals
 * that fall inside a word. A slug flattens both — "cam-ron-fletcher" comes back
 * as "Cam Ron Fletcher", losing the apostrophe, and "mccottry" as "Mccottry".
 * A rename is only ever allowed to raise this score, so a card spelling can
 * correct us but a slug spelling can never overwrite a better one.
 */
function spellingScore(s) {
  const punct = (s.match(/[^A-Za-z\s]/g) ?? []).length;
  const inner = s.split(/\s+/).reduce((n, w) => n + (w.slice(1).match(/[A-Z]/g) ?? []).length, 0);
  return punct + inner;
}
const cleanSlugName = (slug) =>
  slug.split("-").filter(Boolean).map((tk) =>
    /^(ii|iii|iv|v|vi|vii)$/i.test(tk) ? tk.toUpperCase()
    : (tk.length <= 3 && !/[aeiou]/i.test(tk)) ? tk.toUpperCase()
    : tk.charAt(0).toUpperCase() + tk.slice(1)).join(" ");

// Match keys, identical to reconcile-preview-rosters.mjs so both agree on who
// is already on a roster.
const norm = (s) => (s ?? "").toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "")
  .replace(/[^a-z\s]/g, " ").replace(/\s+/g, " ").trim();
const key = (s) => norm(s).replace(/\s+(jr|sr|ii|iii|iv|v|vi)$/, "");
const initLast = (s) => { const t = key(s).split(" "); return t.length >= 2 ? `${t[0][0]} ${t[t.length - 1]}` : null; };
/**
 * Space-free key. A name that reached us through a URL slug can lose its
 * hyphen — the school's "Dra Gibbs-Lawhorn" is our "Dra Gibbslawhorn" — and
 * those differ under key() because one has a word break the other doesn't.
 */
const tight = (s) => key(s).replace(/\s+/g, "");

// ── roster parsers ────────────────────────────────────────────────────────────
// Sidearm ships three roster layouts across these schools and they share no
// markup, so each gets its own reader and the richest result wins.

/** Modern Vue list: <li class="roster-list-item"> with BEM profile fields. */
function parseListItem(html) {
  const out = [];
  for (const b of html.split(/class="roster-list-item"/).slice(1)) {
    const nm = b.match(/roster-list-item__title"[^>]*>([\s\S]{0,200}?)<\/a>/i);
    const name = dec(nm?.[1]);
    if (!name) continue;
    const fld = (n) => b.match(new RegExp(`profile-field--${n}[^>]*>([\\s\\S]{0,200}?)</(?:strong|span)>`, "i"))?.[1];
    out.push({ name, named: true, cls: normCls(dec(fld("class-level"))), ht: normHt(fld("height")) });
  }
  return out;
}

/** Newer card component: labelled runs inside .s-person-card__content. */
function parseSPerson(html) {
  const out = [];
  for (const b of html.split(/s-person-card__content/).slice(1)) {
    const name = dec(b.match(/aria-label="([^"]+?) jersey number/i)?.[1]);
    if (!name) continue;
    const txt = dec(b.slice(0, 6000));
    const after = (label) => txt.match(new RegExp(`${label}\\s*([^|]{0,40}?)\\s*(?:Weight|Hometown|Height|Position|Academic Year|Last School|Full Bio|$)`, "i"))?.[1];
    out.push({ name, named: true, cls: normCls(after("Academic Year")), ht: normHt(after("Height")) });
  }
  return out;
}

/** Legacy template: .sidearm-roster-player blocks keyed by data-player-url. */
function parseLegacy(html) {
  const out = [];
  for (const b of html.split(/data-player-url="/).slice(1)) {
    const slug = (b.match(/^\/[^"]*?\/roster\/([a-z0-9-]+)/i)?.[1] ?? "").replace(/-$/, "");
    if (!slug || !slug.includes("-")) continue;
    const seg = b.slice(0, 4000);
    const nm = dec(seg.match(/sidearm-roster-player-name[\s\S]{0,900}?<p>([\s\S]{0,200}?)<\/p>/i)?.[1]);
    const real = !!(nm && /[a-z]/i.test(nm));
    out.push({
      name: real ? nm : cleanSlugName(slug),
      named: real,
      cls: normCls(dec(seg.match(/sidearm-roster-player-(?:academic-year|custom1)"[^>]*>([\s\S]{0,80}?)<\/span>/i)?.[1])),
      ht: normHt(seg.match(/sidearm-roster-player-height"[^>]*>([\s\S]{0,40}?)<\/span>/i)?.[1]),
    });
  }
  return out;
}

/** Player-profile links on the page — the count every parser is judged against. */
const NON_PLAYER = new Set(["coaches", "staff", "season", "print", "roster", "coach", "player"]);
function slugPlayers(html) {
  const found = new Map();
  const re = /\/roster\/(?:season\/[0-9-]+\/)?(?:player\/)?([a-z][a-z0-9-]{2,})(?:\/(\d+))?/gi;
  let m;
  while ((m = re.exec(html)) !== null) {
    const slug = m[1].toLowerCase();
    if (NON_PLAYER.has(slug) || !slug.includes("-")) continue;
    if (!found.has(slug)) found.set(slug, cleanSlugName(slug));
  }
  return [...found.entries()].map(([slug, name]) => ({ slug, name }));
}

function readRoster(html) {
  const slugs = slugPlayers(html);
  const best = [parseListItem, parseSPerson, parseLegacy]
    .map((fn) => { try { return fn(html); } catch { return []; } })
    .reduce((a, b) => (b.length > a.length ? b : a), []);
  // Dedupe — legacy pages render the same player once per view mode.
  const seen = new Set(), rich = [];
  for (const r of best) { const k = key(r.name); if (!k || seen.has(k)) continue; seen.add(k); rich.push(r); }
  if (rich.length >= Math.ceil(slugs.length * PARSE_FLOOR) && rich.length > 0) return { players: rich, slugs, mode: "card" };
  return { players: slugs.map((s) => ({ name: s.name, named: false, cls: null, ht: null })), slugs, mode: "slug" };
}

// ── main ──────────────────────────────────────────────────────────────────────
const NULL_STATS = {
  epm: null, epmP: null, pir: null, pirP: null, pts: null, ptsP: null,
  reb: null, rebP: null, ast: null, astP: null, fg3: null, fg3P: null, ft: null, ftP: null,
  ts: null, tsP: null, usg: null, usgP: null, ewins: null, on_off: null, ewinsP: null, on_offP: null,
};

const doc = JSON.parse(fs.readFileSync(PREVIEW, "utf8"));
const official = JSON.parse(fs.readFileSync(OFFICIAL, "utf8"));
const portalRaw = JSON.parse(fs.readFileSync(PORTAL, "utf8"));
const portalArr = Array.isArray(portalRaw) ? portalRaw : (portalRaw.entries ?? Object.values(portalRaw).find(Array.isArray) ?? []);
const portalByName = new Map(portalArr.map((e) => [key(e.name), e]));

/**
 * Where every carried player currently sits, so a listed player already on
 * another roster is recognised as a move rather than minted a second time.
 *
 * Keyed on the FULL name only. The first-initial/last key that disambiguates
 * spelling drift within one roster is far too loose across all 365: it maps
 * Jaylen Curry onto Valparaiso's Justin Curry II and Darrion Williams onto
 * Georgia's Donovan Williams, and a move keyed on that deletes a real player
 * from a team nobody was even looking at.
 */
const teamOf = new Map();
for (const [tn, t] of Object.entries(doc.teams ?? {})) {
  for (const p of t.roster ?? []) {
    const k = tight(p.name);
    if (k && !teamOf.has(k)) teamOf.set(k, { team: tn, row: p });
  }
}

let added = 0, moved = 0, skipped = 0, upgraded = 0;
const report = [];

for (const team of TEAMS) {
  const t = doc.teams?.[team];
  if (!t) { console.log(`✗ ${team}: not in season-preview.json`); continue; }
  const url = official.teams?.[team]?.url;
  if (!url) { console.log(`✗ ${team}: no official roster URL on file`); continue; }

  let html;
  try { html = curl(url); } catch (e) { console.log(`✗ ${team}: fetch failed — ${e.message}`); continue; }
  const { players: listed, mode } = readRoster(html);

  if (listed.length < MIN_POSTED) {
    console.log(`· ${team}: only ${listed.length} listed (under ${MIN_POSTED}) — roster not fully posted, left alone`);
    continue;
  }

  // Who we already carry. Within one roster the loose first-initial/last key is
  // safe and catches Bart-vs-school spelling drift.
  const onRoster = (name) => t.roster.find((p) =>
    key(p.name) === key(name) || tight(p.name) === tight(name) || (initLast(p.name) && initLast(p.name) === initLast(name)));
  const listedKeys = new Set();
  for (const p of listed) { listedKeys.add(key(p.name)); listedKeys.add(tight(p.name)); const il = initLast(p.name); if (il) listedKeys.add(il); }

  const missing = listed.filter((p) => !onRoster(p.name));
  const unlisted = t.roster.filter((p) => !listedKeys.has(key(p.name)) && !listedKeys.has(tight(p.name)) && !listedKeys.has(initLast(p.name) ?? " "));

  const lines = [];

  // Rows we already hold, filled in from the school's own card. A player who
  // arrived as a bare slug has no class, no height and no bart id, so he can
  // never pick up impact numbers; the portal record makes him a real transfer.
  for (const p of listed) {
    const row = onRoster(p.name);
    if (!row) continue;
    const pe = portalByName.get(key(p.name)) ?? portalByName.get(tight(p.name));
    const fixes = [];
    if (!row.cls && p.cls) { row.cls = p.cls; fixes.push(`cls ${p.cls}`); }
    if (!row.ht && p.ht) { row.ht = p.ht; fixes.push(`ht ${p.ht}`); }
    if (row.bart_id == null && pe?.team_to === team && pe.bart_player_id != null) {
      row.bart_id = pe.bart_player_id;
      row.status = "transfer";
      if (pe.team_from) row.from = pe.team_from;
      fixes.push(`bart ${pe.bart_player_id}, transfer from ${pe.team_from}`);
    }
    if (p.named && row.name !== p.name && tight(row.name) === tight(p.name)
        && spellingScore(p.name) >= spellingScore(row.name)) {
      fixes.push(`name "${row.name}" → "${p.name}"`); row.name = p.name;
    }
    if (fixes.length) { upgraded++; lines.push(`   ^ FILL ${p.name.padEnd(22)} ${fixes.join("; ")}`); }
  }

  for (const p of missing) {
    const k = key(p.name);
    const pe = portalByName.get(k) ?? portalByName.get(tight(p.name));
    const found = teamOf.get(tight(p.name));

    if (found && found.team !== team) {
      // Two schools list him — the norm, since a school keeps a departed player
      // posted for weeks. Only our own commitment record may break the tie, and
      // only when the bart ids agree: same name is not same player.
      if (!pe || pe.team_to !== team) {
        skipped++;
        lines.push(`   ~ SKIP ${p.name} — also on ${found.team}, no portal record confirming a move here`);
        continue;
      }
      if (found.row.bart_id != null && pe.bart_player_id != null && found.row.bart_id !== pe.bart_player_id) {
        skipped++;
        lines.push(`   ~ SKIP ${p.name} — ${found.team} carries bart ${found.row.bart_id}, portal says ${pe.bart_player_id}: different players sharing a name`);
        continue;
      }
      const src = doc.teams[found.team];
      const before = src.roster.length;
      src.roster = src.roster.filter((r) => r !== found.row);
      moved++;
      lines.push(`   → MOVE ${p.name} off ${found.team} (${before}→${src.roster.length}) — portal: ${pe.team_from} → ${pe.team_to}`);
    }

    const isTransfer = pe && pe.team_to === team && pe.bart_player_id != null;
    const row = {
      name: p.name,
      bart_id: isTransfer ? pe.bart_player_id : null,
      cls: p.cls ?? (pe ? normCls(pe.eligibility) : null),
      ht: p.ht ?? null,
      status: isTransfer ? "transfer" : "newcomer",
      link: false,               // refresh-preview-links.mjs decides this properly
      ...NULL_STATS,
    };
    if (isTransfer && pe.team_from) row.from = pe.team_from;
    t.roster.push(row);
    teamOf.set(tight(row.name), { team, row });
    added++;
    lines.push(`   + ${row.status === "transfer" ? "XFER" : "NEW "} ${row.name.padEnd(22)} ${String(row.cls ?? "?").padEnd(3)} ${String(row.ht ?? "?").padEnd(5)}${row.from ? ` from ${row.from}` : ""}${row.bart_id ? `  bart ${row.bart_id}` : ""}`);
  }
  for (const p of unlisted) lines.push(`   ? carried but not listed by the school: ${p.name} [${p.status}] — left in place (prune is reconcile's job)`);

  report.push(`${team}: ${t.roster.length} on roster (school lists ${listed.length}, parsed via ${mode})`);
  report.push(...lines);
}

console.log(`\n${report.join("\n")}`);
console.log(`\nadded ${added} · filled ${upgraded} · moved ${moved} · skipped ${skipped}`);

if (DRY) { console.log("\n--dry: nothing written."); process.exit(0); }
doc.additions_patched_at = new Date().toISOString();
fs.writeFileSync(PREVIEW, JSON.stringify(doc));
console.log(`✓ rewrote ${PREVIEW}`);
