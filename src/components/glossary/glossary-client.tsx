"use client";

import { useMemo, useState } from "react";
import { cn } from "@/lib/utils";
import {
  GLOSSARY_ENTRIES,
  GLOSSARY_CATEGORIES,
  indexLetter,
  type GlossaryEntry,
} from "@/lib/glossary";

const LETTERS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ".split("");

/**
 * Browsed alphabetically, filtered three ways: a letter, a category chip, and
 * free text. All three narrow the same list rather than switching views, so the
 * A-Z rail keeps working while a category is active.
 *
 * Letters with no entries under the current category/search are disabled rather
 * than hidden — a jumping rail is harder to use than a greyed one.
 */
export function GlossaryClient() {
  const [letter, setLetter] = useState<string | null>(null);
  const [category, setCategory] = useState<string | null>(null);
  const [query, setQuery] = useState("");

  const q = query.trim().toLowerCase();

  // Category + search applied first; the letter rail is derived from THIS, so
  // it only offers letters that would actually land on something.
  const preLetter = useMemo(() => {
    return GLOSSARY_ENTRIES.filter((e) => {
      if (category && e.category !== category) return false;
      if (!q) return true;
      return (
        e.term.toLowerCase().includes(q)
        || e.body.toLowerCase().includes(q)
        || e.category.toLowerCase().includes(q)
        || (e.aka?.some((a) => a.toLowerCase().includes(q)) ?? false)
      );
    });
  }, [category, q]);

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

  return (
    <>
      <div className="mt-6 max-w-[30rem]">
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search terms, stats, abbreviations…"
          aria-label="Search the glossary"
          className="w-full rounded-lg border border-hairline bg-card px-3.5 py-2.5 text-sm
                     placeholder:text-ink-soft focus:outline-none focus:ring-2 focus:ring-coral/40"
        />
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

      {/* Category chips */}
      <div className="mt-3 flex flex-wrap gap-2">
        {GLOSSARY_CATEGORIES.map((c) => {
          const on = category === c;
          return (
            <button
              key={c}
              type="button"
              onClick={() => setCategory(on ? null : c)}
              aria-pressed={on}
              className={cn(
                "px-3 py-1 rounded-full border text-xs transition-colors",
                on
                  ? "border-transparent bg-ink text-paper"
                  : "border-hairline text-ink-muted hover:text-ink hover:border-ink-soft",
              )}
            >
              {c}
            </button>
          );
        })}
      </div>

      <p className="mt-4 text-xs text-ink-soft" role="status">
        {total} {total === 1 ? "term" : "terms"}
        {category ? ` in ${category}` : ""}
        {q ? ` matching “${query.trim()}”` : ""}
      </p>

      {grouped.length === 0 ? (
        <div className="mt-8 rounded-lg border border-hairline bg-card p-10 text-center text-ink-muted">
          <p className="text-sm">Nothing matches that.</p>
          <button
            type="button"
            onClick={() => { setQuery(""); setCategory(null); setLetter(null); }}
            className="mt-3 text-xs underline underline-offset-4 hover:text-ink"
          >
            Clear filters
          </button>
        </div>
      ) : (
        <div className="mt-6 space-y-10">
          {grouped.map(([L, entries]) => (
            <section key={L}>
              <h2 className="text-base font-semibold border-b border-hairline pb-1.5">{L}</h2>
              <div className="mt-4 grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
                {entries.map((e) => (
                  <article
                    key={e.term}
                    className="rounded-xl bg-paper-deep border border-hairline/60 p-4"
                  >
                    <h3 className="flex items-baseline gap-2 flex-wrap font-semibold text-[0.95rem]">
                      {e.term}
                      {e.original && (
                        <span className="text-[0.58rem] uppercase tracking-wider px-1.5 py-0.5
                                         rounded border border-hairline text-ink-soft font-normal">
                          BTA original
                        </span>
                      )}
                    </h3>
                    <p className="mt-1.5 text-[0.8rem] text-ink-muted leading-relaxed">{e.body}</p>
                    {e.formula && (
                      <code className="mt-2.5 block bg-card rounded px-2 py-1 text-[0.7rem]
                                       text-ink-soft overflow-x-auto overscroll-x-contain">
                        {e.formula}
                      </code>
                    )}
                    {e.caveat && (
                      <p className="mt-2.5 text-[0.72rem] text-ink-soft leading-relaxed">
                        <span className="uppercase tracking-wider text-[0.58rem]">Caveat </span>
                        {e.caveat}
                      </p>
                    )}
                  </article>
                ))}
              </div>
            </section>
          ))}
        </div>
      )}
    </>
  );
}
