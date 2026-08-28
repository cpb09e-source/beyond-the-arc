/**
 * Write docs/free-vs-paid.csv — every gating decision on the site, one per row,
 * with a blank column to fill in.
 *
 * WHY A GENERATED FILE AND NOT A TYPED ONE. There are 25 views across the two
 * explorers, each with its own bands, and the answer to "what does this view
 * cost today?" lives in src/lib/access.ts rather than next to the view. Typing
 * that list by hand means it is wrong the first time a view is renamed, and a
 * worksheet that disagrees with the code is worse than no worksheet — the
 * decisions get made against rows that do not exist.
 *
 * So this reads the registries themselves: TABLE_VIEWS, PLAYER_VIEWS,
 * VIEW_ACCESS, FREE_LIMITS, PAID_TEAM_TABS. Re-run it whenever a view is added
 * and the new row appears with its gate already filled in.
 *
 *   npx tsx scripts/build-gating-worksheet.mts
 *
 * THE PLAYER ROWS ALL SAY "free" TODAY, and that is not an opinion this script
 * has — VIEW_ACCESS has no entries for player views, and viewAccess() treats an
 * unknown key as free on purpose, so that shipping a view locked by accident
 * cannot happen. Every player view is therefore genuinely open right now.
 */
import { writeFileSync } from "node:fs";
import { TABLE_VIEWS } from "../src/lib/team-views";
import { PLAYER_VIEWS } from "../src/lib/player-views";
import { FREE_LIMITS, FREE_SEASONS, PAID_TEAM_TABS, SAMPLE_TEAM_SLUGS, viewAccess } from "../src/lib/access";
import { MAX_SAVED } from "../src/lib/saved-filters";

/** One line of the worksheet. `call` is deliberately empty — that is his half. */
type Row = {
  area: string;
  what: string;
  detail: string;
  today: string;
  call: string;
  notes: string;
};

const rows: Row[] = [];

/** Describes a ViewAccess in the words the worksheet uses, not the type's. */
function gateToday(key: string): string {
  const a = viewAccess(key);
  switch (a.kind) {
    case "free": return "free";
    case "preview": return `preview (top ${FREE_LIMITS.previewRows}, no re-sort)`;
    case "bands": return `bands free: ${a.free.join(" / ")}`;
    case "cols": return `capped at ${FREE_LIMITS.statCols} columns`;
  }
}

// ── §1 The archive ─────────────────────────────────────────────────────────
rows.push({
  area: "Season archive",
  what: "Which seasons need an account",
  detail: `13 seasons, 2014-2026`,
  today: FREE_SEASONS.length >= 13 ? "every season free (gate built, switched off)" : FREE_SEASONS.join(", "),
  call: "",
  notes: "THE ONLY DATA GATE on the site — a paid season is never published to the CDN. Everything else on this sheet hides presentation of data the browser already holds. Agreed setting was 'current season and the one before'.",
});

// ── §2 The free-tier allowances ────────────────────────────────────────────
const allowances: Array<[keyof typeof FREE_LIMITS, string, string]> = [
  ["statCols", "Stat columns at once", "Identity columns (rank, team, season, record) never count."],
  ["boundedStatCols", "Of those, how many may carry a filter", "Lower than the column cap on purpose: looking at a number is cheaper than asking who clears a bar."],
  ["savedFilters", "Saved filter views kept", `Subscribers get ${MAX_SAVED}.`],
  ["previewRows", "Rows shown of a preview-gated view", "Enough to see the shape, not the ranking."],
  ["seasonsAtOnce", "Seasons selectable at once", "The allowance that gets stronger once the archive gate is on."],
];
for (const [key, what, notes] of allowances) {
  rows.push({
    area: "Free-tier allowance",
    what,
    detail: `FREE_LIMITS.${key}`,
    today: String(FREE_LIMITS[key]),
    call: "",
    notes,
  });
}

// ── §3 The views, both explorers ───────────────────────────────────────────
for (const v of TABLE_VIEWS) {
  rows.push({
    area: "Team Explorer view",
    what: v.label,
    detail: v.custom ? "reader's own columns" : v.bands.map((b) => b.label).join(" / "),
    today: gateToday(v.key),
    call: "",
    notes: v.desc,
  });
}
for (const v of PLAYER_VIEWS) {
  rows.push({
    area: "Players Explorer view",
    what: v.label,
    detail: v.custom ? "reader's own columns" : v.bands.map((b) => b.label).join(" / "),
    today: gateToday(v.key),
    call: "",
    notes: v.desc,
  });
}

// ── §4 Team pages ──────────────────────────────────────────────────────────
const TEAM_TABS: Array<[string, string]> = [
  ["overview", "Ratings, four factors, the season at a glance"],
  ["schedule", "Every game, result and quality"],
  ["roster", "Who played, and how much"],
  ["shooting", "Shot profile and splits"],
  ["lineups", "Every five-man unit, from stint data"],
  ["onoff", "On/off splits, from stint data"],
];
for (const [tab, desc] of TEAM_TABS) {
  rows.push({
    area: "Team page tab",
    what: tab,
    detail: desc,
    today: PAID_TEAM_TABS.has(tab) ? "paid" : "free",
    call: "",
    notes: tab === "lineups" || tab === "onoff"
      ? `Open to everyone for ${[...SAMPLE_TEAM_SLUGS].join(' and ')} as a worked example. Prerendered into the HTML, so this gate is visible in view-source.`
      : "Prerendered at build time — a gate here would take the page out of Google.",
  });
}

// ── §5 Everything else that could carry a price ────────────────────────────
const FEATURES: Array<[string, string, string, string]> = [
  ["Download", "CSV of the current view", "free on players, gated on teams", "Raw values, nothing rounded."],
  ["Download", "Excel Workbook of the current view", "free on players, gated on teams", "Formatted, percentile colours, a sheet describing the export."],
  ["Download", "Excel - Select Views (multi-tab)", "free on players, gated on teams", "One tab per view. The most obviously paid-shaped thing in the menu."],
  ["Download", "Sample workbook", "free", "Runs the same code as the paid export on a fixed slice. The pitch, not a limit."],
  ["Explorer", "Compare (teams)", "free", "Hidden on players for now by decision."],
  ["Explorer", "Saved filter views", `capped at ${FREE_LIMITS.savedFilters}`, "Stored in the browser, not on the account."],
  ["Player page", "Shot chart", "free", "Zones and rates, 2014 onward."],
  ["Player page", "Game log / box scores", "free", ""],
  ["Site", "Coaches (812 pages)", "free", ""],
  ["Site", "Transfer portal / recruits / draftees", "free", ""],
  ["Site", "/calc archive calculator", "gated", "Already behind the archive gate."],
  ["Site", "/32-0 game", "free", ""],
];
for (const [area, what, today, notes] of FEATURES) {
  rows.push({ area, what, detail: "", today, call: "", notes });
}

// ── Write it ───────────────────────────────────────────────────────────────
/** Excel-safe: quote everything, double interior quotes, CRLF between rows. */
const cell = (s: string) => `"${String(s).replace(/"/g, '""')}"`;
const header = ["Area", "What", "Columns / detail", "Gate today", "YOUR CALL", "Notes"];
const legend = [
  ["LEGEND", "Fill in the YOUR CALL column only", "", "", "", ""],
  ["", "free", "no gate at all", "", "", ""],
  ["", "preview", `columns render, top ${FREE_LIMITS.previewRows} rows only, no re-sort`, "", "", ""],
  ["", "bands: A / B", "name the bands that stay free; the rest render blurred under a lock", "", "", ""],
  ["", "paid", "subscribers only", "", "", ""],
  ["", "a number", "for the allowance rows — the new limit", "", "", ""],
  ["", "", "", "", "", ""],
];

const lines = [
  ...legend.map((r) => r.map(cell).join(",")),
  header.map(cell).join(","),
  ...rows.map((r) => [r.area, r.what, r.detail, r.today, r.call, r.notes].map(cell).join(",")),
];
const out = "docs/free-vs-paid.csv";
writeFileSync(out, lines.join("\r\n") + "\r\n", "utf8");
console.log(`${out}: ${rows.length} decisions`);
