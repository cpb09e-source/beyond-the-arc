"use client";

import { useMemo, useState } from "react";
import { cn } from "@/lib/utils";
import { GLOSSARY_ENTRIES, indexLetter, type GlossaryEntry } from "@/lib/glossary";

const LETTERS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ".split("");

/**
 * A DICTIONARY, NOT A CARD WALL.
 *
 * This was three columns of bordered cards, which is the shape you reach for
 * when entries are few and roughly equal. There are several hundred now, and
 * they are nothing like equal — "GP" is four words and EPM is a paragraph with
 * a caveat. In a grid the tall ones drag their whole row open and the eye has
 * to travel left-right-down-left to read alphabetically, which is exactly the
 * order the page is sorted in.
 *
 * One entry per row, term in its own left column, definition beside it. The
 * terms line up as a single vertical index you can run a finger down, and a
 * long definition costs its own row rather than three.
 *
 * NO CATEGORY CHIPS. There were twenty-eight of them once every catalogue was
 * wired in — three wrapped rows of buttons above the first definition, which
 * is a filing system sitting on top of a dictionary. A dictionary is searched
 * and scanned, not filtered: the search box, the A-Z rail and one toggle for
 * the metrics that are ours cover what a reader actually does here. Each
 * entry still names its own category in a caption, which is where that fact
 * belongs — attached to the word rather than hovering above the page.
 */
export function GlossaryClient() {
  const [letter, setLetter] = useState<string | null>(null);
  const [origin, setOrigin] = useState(false);
  const [query, setQuery] = useState("");

  const q = query.trim().toLowerCase();

  // Search and the "ours only" toggle apply first; the letter rail is derived
  // from THIS, so it only offers letters that would land on something.
  const preLetter = useMemo(() => {
    return GLOSSARY_ENTRIES.filter((e) => {
      if (origin && !e.origin) return false;
      if (!q) return true;
      return (
        e.term.toLowerCase().includes(q)
        || e.body.toLowerCase().includes(q)
        || e.category.toLowerCase().includes(q)
        || (e.aka?.some((a) => a.toLowerCase().includes(q)) ?? false)
      );
    });
  }, [origin, q]);

  const liveLetters = useMemo(
    () => new Set(preLetter.map((e) => indexLetter(e.term))),
    [preLetter],
  );

  const grouped = useMemo(() => {
    const rows = letter ? preLetter.filter((e) => indexLetter(e.term) === letter) : preLetter;
    const by = new Map<string, GlossaryEntry[]>();
    for (const e of rows) {
      const k = indexLetter(e.term);
      if (!by.has(k)) by.set(k, []);
      by.get(k)!.push(e);
    }
    for (const list of by.values()) list.sort((a, b) => a.term.localeCompare(b.term));
    return [...by.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  }, [preLetter, letter]);

  const total = preLetter.length;
  const ours = useMemo(() => GLOSSARY_ENTRIES.filter((e) => e.origin).length, []);

  return (
    <>
      <div className="mt-6 flex flex-wrap items-center gap-3">
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search terms, stats, abbreviations…"
          aria-label="Search the glossary"
          className="w-full max-w-[30rem] rounded-lg border border-hairline bg-card px-3.5 py-2.5 text-sm
                     placeholder:text-ink-soft focus:outline-none focus:ring-2 focus:ring-coral/40"
        />
        <button
          type="button"
          onClick={() => setOrigin((v) => !v)}
          aria-pressed={origin}
          className={cn(
            "h-9 px-3 rounded-lg border text-xs font-semibold transition-colors",
            origin
              ? "border-coral bg-coral text-accent-foreground"
              : "border-hairline text-ink-muted hover:text-ink hover:border-ink-soft",
          )}
        >
          Ours only · {ours}
        </button>
      </div>

      {/* A-Z rail */}
      <nav aria-label="Jump to letter" className="mt-5 flex items-center gap-1.5 flex-wrap">
        <button
          type="button"
          onClick={() => setLetter(null)}
          aria-pressed={letter === null}
          className={cn(
            "px-2.5 py-1 rounded-md text-xs font-semibold transition-colors",
            letter === null
              ? "bg-ink text-paper"
              : "text-ink-muted hover:text-ink hover:bg-paper-deep",
          )}
        >
          All
        </button>
        <span aria-hidden className="mx-1 h-4 w-px bg-hairline" />
        {LETTERS.map((L) => {
          const live = liveLetters.has(L);
          return (
            <button
              key={L}
              type="button"
              disabled={!live}
              onClick={() => setLetter(letter === L ? null : L)}
              aria-pressed={letter === L}
              className={cn(
                "w-6 h-6 rounded-md text-xs font-medium transition-colors",
                !live && "text-ink-soft/40 cursor-default",
                live && letter !== L && "text-ink-muted hover:text-ink hover:bg-paper-deep",
                letter === L && "bg-ink text-paper",
              )}
            >
              {L}
            </button>
          );
        })}
      </nav>

      <p className="mt-4 text-xs text-ink-soft" role="status">
        {total} {total === 1 ? "term" : "terms"}
        {origin ? " we build ourselves" : ""}
        {q ? ` matching “${query.trim()}”` : ""}
      </p>

      {grouped.length === 0 ? (
        <div className="mt-8 rounded-lg border border-hairline bg-card p-10 text-center text-ink-muted">
          <p className="text-sm">Nothing matches that.</p>
          <button
            type="button"
            onClick={() => { setQuery(""); setLetter(null); setOrigin(false); }}
            className="mt-3 text-xs underline underline-offset-4 hover:text-ink"
          >
            Clear filters
          </button>
        </div>
      ) : (
        <div className="mt-8 max-w-[62rem]">
          {grouped.map(([L, entries]) => (
            <section key={L} className="mb-8">
              {/* The letter is a margin mark, not a banner: it sits in the
                  term column so the definitions keep one left edge all the
                  way down the page. */}
              <h2
                className="sticky top-0 z-10 bg-paper/90 backdrop-blur-sm border-b border-hairline
                           py-1.5 text-[0.7rem] font-semibold uppercase tracking-[0.18em] text-ink-muted"
              >
                {L}
              </h2>

              <dl className="divide-y divide-hairline">
                {entries.map((e) => (
                  <div
                    key={`${e.category}-${e.term}`}
                    className="grid sm:grid-cols-[13rem_minmax(0,1fr)] gap-x-6 gap-y-1 py-3
                               hover:bg-ink/[0.02] transition-colors"
                  >
                    {/* self-start, or the grid stretches this cell to the height
                        of a long definition and align-content spreads the
                        wrapped badge halfway down the column, away from the
                        term it belongs to. */}
                    <dt className="self-start flex flex-wrap items-baseline gap-x-2 gap-y-1">
                      <span className="font-semibold text-[0.9rem] text-ink">{e.term}</span>
                      {e.origin && <OriginMark origin={e.origin} />}
                    </dt>

                    <dd className="min-w-0">
                      <p className="text-[0.82rem] text-ink-soft leading-relaxed">{e.body}</p>

                      {e.formula && (
                        <code
                          className="mt-2 inline-block rounded bg-paper-deep px-2 py-1 text-[0.72rem]
                                     text-ink-muted max-w-full overflow-x-auto overscroll-x-contain"
                        >
                          {e.formula}
                        </code>
                      )}

                      {e.caveat && (
                        <p className="mt-2 text-[0.75rem] text-ink-muted leading-relaxed">
                          <span className="uppercase tracking-[0.12em] text-[0.6rem] font-semibold mr-1.5">
                            Caveat
                          </span>
                          {e.caveat}
                        </p>
                      )}

                      {/* The category rides with the entry rather than heading a
                          section: the page sorts alphabetically, so a term's
                          category is a fact about it, not where it lives. */}
                      <p className="mt-1.5 text-[0.65rem] text-ink-muted/80">{e.category}</p>
                    </dd>
                  </div>
                ))}
              </dl>
            </section>
          ))}
        </div>
      )}
    </>
  );
}

/**
 * Two marks, because there are two different claims and flattening them into
 * one would overstate the weaker of them. Neither is decoration: both are read
 * from provenance the catalogues already carry — see the header of glossary.ts.
 */
function OriginMark({ origin }: { origin: "original" | "computed" }) {
  const original = origin === "original";
  return (
    <span
      title={
        original
          ? "A metric we invented. There is no upstream definition to look up."
          : "A public concept, but the number is ours — nobody publishes it for college basketball, so we build it from the play-by-play we archive."
      }
      className={cn(
        "text-[0.55rem] uppercase tracking-[0.1em] px-1.5 py-0.5 rounded border font-semibold whitespace-nowrap",
        original
          ? "border-coral/40 bg-coral/10 text-coral"
          : "border-hairline bg-paper-deep text-ink-muted",
      )}
    >
      {original ? "BTA original" : "BTA-built"}
    </span>
  );
}
