/**
 * The filter box's grammar, checked without the app: parsing, the comparisons
 * as printed, catalog names, and what completion offers.
 *
 *   npx tsx --tsconfig tsconfig.json scripts/check-filter.mts
 */
import assert from "node:assert/strict";
import { catalogStats, completeFilter, conditionTest, filterHelp, parseFilter, statIndex } from "../src/renderer/src/ui/filter-query";

// ── Parsing ──────────────────────────────────────────────────────────────
{
  const p = parseFilter("conf:SEC net>20 tempo<68");
  assert.deepEqual(p.scopes, [{ scope: "conf", value: "SEC" }]);
  assert.deepEqual(p.conditions, [
    { name: "net", op: ">", value: 20 },
    { name: "tempo", op: "<", value: 68 },
  ]);
  assert.equal(p.words, "");
}
{
  const p = parseFilter("conf: Big Ten net >= −3.5 duke");
  assert.deepEqual(p.scopes, [{ scope: "conf", value: "Big Ten" }]);
  assert.deepEqual(p.conditions, [{ name: "net", op: ">=", value: -3.5 }]);
  assert.equal(p.words.trim(), "duke");
}
{
  const p = parseFilter("teams: Duke, Houston, Auburn");
  assert.deepEqual(p.scopes, [{ scope: "teams", value: "Duke, Houston, Auburn" }]);
}
{
  // Half-typed clauses narrow nothing.
  const p = parseFilter("net> conf:");
  assert.deepEqual(p.scopes, []);
  assert.deepEqual(p.conditions, []);
  assert.equal(p.words.trim(), "");
}
{
  const p = parseFilter("michigan st");
  assert.equal(p.words, "michigan st");
  assert.deepEqual(p.conditions, []);
}
{
  const p = parseFilter("7>6 efg>55% 3p%≥38");
  assert.equal(p.words.trim(), "7>6");
  assert.deepEqual(p.conditions, [
    { name: "efg", op: ">", value: 55 },
    { name: "3p%", op: ">=", value: 38 },
  ]);
}
{
  const p = parseFilter("player: Cooper Flagg pts>=20 opponents: Duke");
  assert.deepEqual(p.scopes, [
    { scope: "player", value: "Cooper Flagg" },
    { scope: "opponents", value: "Duke" },
  ]);
  assert.deepEqual(p.conditions, [{ name: "pts", op: ">=", value: 20 }]);
}

// ── Comparisons, as printed ──────────────────────────────────────────────
type Row = { net: number | null; efg: number };
const index = statIndex<Row>([
  { name: "net", label: "Net", desc: "Adjusted net rating", digits: 1, get: (r) => r.net },
  { name: "efg", label: "eFG%", desc: "Effective field goal %", pct: true, digits: 1, get: (r) => r.efg },
]);
const rows: Row[] = [
  { net: 20.04, efg: 0.553 },
  { net: 20.06, efg: 0.5 },
  { net: null, efg: 0.6 },
];
const run = (q: string) => rows.map(conditionTest(index, parseFilter(q).conditions)!);
assert.deepEqual(run("net>20"), [false, true, false], "20.04 prints 20.0, which is not above 20; a blank fails");
assert.deepEqual(run("net>=20"), [true, true, false]);
assert.deepEqual(run("efg>=55.3"), [true, false, true]);
assert.deepEqual(run("efg=55.3"), [true, false, false]);
assert.deepEqual(run("efg%<51"), [false, true, false]);
assert.deepEqual(run("temp>1"), [false, false, false], "an unknown stat keeps nothing");
assert.equal(conditionTest(index, []), null);

// ── Catalog names ────────────────────────────────────────────────────────
{
  const cat = statIndex(
    catalogStats(
      [
        { key: "tov", label: "TOV", fmt: "int" },
        { key: "tovr", label: "TOV%", fmt: "pct1" },
        { key: "fg3_pct", label: "3P%", fmt: "pct1" },
        { key: "efgd", label: "eFG% D", fmt: "pct1" },
        { key: "reb_dif", label: "REB±", fmt: "int" },
        { key: "pa", label: "OPP", fmt: "int" },
      ] as const,
      { get: () => () => 1, fmt: (s) => s.fmt },
    ),
  );
  assert.deepEqual(cat.all.map((s) => s.name), ["tov", "tov%", "3p", "efgd", "reb_dif", "opp"]);
  assert.equal(cat.find("tov")?.label, "TOV", "a game log's tov is the count");
  assert.equal(cat.find("tov%")?.label, "TOV%");
  assert.equal(cat.find("tovr")?.label, "TOV%");
  assert.equal(cat.find("3p")?.label, "3P%");
  assert.equal(cat.find("3P%")?.label, "3P%");
  assert.equal(cat.find("fg3_pct")?.label, "3P%");
  assert.equal(cat.find("pa")?.label, "OPP");
  assert.equal(cat.find("REB_DIF")?.label, "REB±");
  assert.equal(cat.find("nope"), null);
}
{
  // A name typed in full is offered before the longer names it begins.
  const shots = statIndex(
    catalogStats(
      [
        { key: "fg3m", label: "3PM", fmt: "int" },
        { key: "fg3a", label: "3PA", fmt: "int" },
        { key: "fg3_pct", label: "3P%", fmt: "pct1" },
      ] as const,
      { get: () => () => 1, fmt: (s) => s.fmt, desc: () => "Three-pointers made." },
    ),
  );
  const help = filterHelp({ noun: "games", index: shots, rows: [], scopes: [], names: {} });
  const c = completeFilter("3p", 2, help)!;
  assert.deepEqual(c.items.map((i) => i.text), ["3p", "3pm", "3pa"]);
  assert.equal(c.items[1]!.label, "Three-pointers made", "no trailing period");
}

// ── Completion ───────────────────────────────────────────────────────────
{
  const help = filterHelp({
    noun: "teams",
    index,
    rows,
    scopes: ["team", "teams", "conf"],
    names: { conf: () => ["SEC", "Big Ten", "Big 12"], teams: () => ["Duke", "Houston", "Auburn"] },
  });
  const texts = (q: string, caret = q.length) => completeFilter(q, caret, help)?.items.map((i) => i.text);

  let c = completeFilter("ne", 2, help)!;
  assert.equal(c.items[0]!.text, "net");
  assert.deepEqual([c.items[0]!.value, c.items[0]!.caret], ["net", 3]);

  c = completeFilter("co", 2, help)!;
  assert.equal(c.items[0]!.text, "conf:");
  assert.equal(c.items[0]!.value, "conf: ");

  assert.deepEqual(texts("conf: b"), ["Big Ten", "Big 12"]);
  assert.equal(completeFilter("conf: b", 7, help)!.items[0]!.value, "conf: Big Ten ");
  assert.equal(completeFilter("conf: b net>1", 7, help)!.items[0]!.value, "conf: Big Ten net>1");
  assert.equal(completeFilter("conf: SEC", 9, help), null, "a name typed in full has nothing to add");
  assert.equal(completeFilter("teams: Duke, ho", 15, help)!.items[0]!.value, "teams: Duke, Houston ");

  c = completeFilter("net>", 4, help)!;
  assert.equal(c.title, "Net");
  assert.ok(c.items.length > 0 && c.items.every((i) => i.text.startsWith("net>")));
  assert.match(c.note ?? "", /across 2 teams/);

  assert.equal(completeFilter("net>20", 6, help), null);
  assert.match(completeFilter("temp>", 5, help)!.note ?? "", /temp/);
  assert.equal(completeFilter("du", 2, help), null);
  assert.equal(completeFilter("n", 1, help), null, "one letter offers nothing");
  assert.match(completeFilter("player: x", 9, help)!.note ?? "", /no “player:” filter/);
}

console.log("ALL FILTER CHECKS PASSED");
