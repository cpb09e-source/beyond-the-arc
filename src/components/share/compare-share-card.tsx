"use client";

import { forwardRef } from "react";
import { pctBg, pctColor } from "@/components/percentile-chip";

/**
 * The picture a comparison turns into when you share it.
 *
 * WHY IT IS ITS OWN COMPONENT AND NOT THE TABLE. The share image used to be a
 * literal photograph of the desktop comparison table — the same DOM, captured
 * where it stood. That is a screenshot of a screen, and it looks like one:
 * chrome, sort arrows, a scrollbar's worth of dead space, type sized for a
 * pointer sitting a foot away, and no indication of what site it came from
 * once it lands in somebody's group chat.
 *
 * A share image has a different job from a UI. Nobody scrolls it, nobody sorts
 * it, and it is looked at small — a thumbnail in a message thread — before it
 * is ever looked at large. So it is built for that: fixed width, generous
 * type, one idea per row, the matchup stated at the top in the largest thing
 * on the card, and the wordmark carried so the picture still says where it is
 * from when it has been forwarded three times.
 *
 * It renders off-screen at a fixed 1080px and is captured from there, which
 * also means the phone gets the same image the desktop does. Nothing about the
 * output depends on the size of the screen that asked for it.
 */

export type ShareEntity = {
  /** Display name — the headline of its column. */
  name: string;
  /** One line under it: season, team, conference. */
  sub: string;
  /** Crest or portrait. Passed in because each modal has its own kind. */
  logo?: React.ReactNode;
};

export type ShareCell = {
  /** Already-formatted value. */
  display: string;
  /** Percentile, when the stat has one — drawn as the site's chip. */
  pct?: number | null;
  best?: boolean;
  worst?: boolean;
};

export type ShareRow = {
  /** Set on the row that OPENS a section, not on every row in it. */
  section?: string;
  label: string;
  cells: ShareCell[];
};

export const CompareShareCard = forwardRef<HTMLDivElement, {
  /** "Compare teams" → drawn as the kicker. */
  kicker: string;
  entities: ShareEntity[];
  rows: ShareRow[];
  /** Season or scope line in the footer. */
  footnote?: string;
}>(function CompareShareCard({ kicker, entities, rows, footnote }, ref) {
  const n = entities.length;
  // Two entities get a real head-to-head layout; three or four fall back to
  // even columns, because a "vs" divider between four things means nothing.
  const cols = `minmax(0, 1.15fr) repeat(${n}, minmax(0, 1fr))`;

  return (
    <div
      ref={ref}
      style={{ width: 1080, background: "var(--paper)" }}
      className="font-sans"
    >
      {/* ── Masthead. Ink band so the card reads as a published thing rather
             than a window, and so the wordmark survives being seen small. */}
      <div
        className="flex items-center justify-between"
        style={{ background: "var(--ink)", padding: "26px 40px" }}
      >
        <div
          className="font-display"
          style={{
            color: "var(--paper)",
            fontSize: 25,
            fontWeight: 700,
            letterSpacing: "-0.02em",
            lineHeight: 1,
          }}
        >
          Beyond the Arc
        </div>
        <div
          style={{
            color: "var(--coral-soft)",
            fontSize: 12,
            fontWeight: 700,
            letterSpacing: "0.22em",
            textTransform: "uppercase",
          }}
        >
          {kicker}
        </div>
      </div>

      {/* ── The matchup. The largest type on the card: this is what someone
             reads at thumbnail size, and everything below is the evidence. */}
      <div
        className="grid items-end"
        style={{
          gridTemplateColumns: `repeat(${n}, minmax(0, 1fr))`,
          gap: 1,
          background: "var(--hairline)",
          borderBottom: "2px solid var(--ink)",
        }}
      >
        {entities.map((e, i) => (
          <div
            key={i}
            className="flex flex-col items-center text-center"
            style={{ background: "var(--paper-deep)", padding: "26px 16px 22px", gap: 10 }}
          >
            {e.logo && <div className="flex items-center justify-center">{e.logo}</div>}
            <div
              className="font-display"
              style={{
                color: "var(--ink)",
                fontSize: n > 2 ? 26 : 34,
                fontWeight: 700,
                letterSpacing: "-0.02em",
                lineHeight: 1.05,
              }}
            >
              {e.name}
            </div>
            <div
              style={{
                color: "var(--ink-muted)",
                fontSize: 12,
                fontWeight: 600,
                letterSpacing: "0.14em",
                textTransform: "uppercase",
              }}
            >
              {e.sub}
            </div>
          </div>
        ))}
      </div>

      {/* ── The rows. */}
      <div>
        {rows.map((row, ri) => (
          <div key={ri}>
            {row.section && (
              <div
                className="flex items-center"
                style={{
                  gap: 10,
                  padding: "22px 40px 8px",
                  color: "var(--coral)",
                  fontSize: 11,
                  fontWeight: 700,
                  letterSpacing: "0.2em",
                  textTransform: "uppercase",
                }}
              >
                <span style={{ width: 20, height: 2, background: "var(--coral)" }} />
                {row.section}
              </div>
            )}
            <div
              className="grid items-center"
              style={{
                gridTemplateColumns: cols,
                borderBottom: "1px solid var(--hairline)",
                padding: "0 40px",
              }}
            >
              <div
                style={{
                  color: "var(--ink-soft)",
                  fontSize: 13,
                  fontWeight: 600,
                  letterSpacing: "0.1em",
                  textTransform: "uppercase",
                  padding: "14px 16px 14px 0",
                }}
              >
                {row.label}
              </div>
              {row.cells.map((c, ci) => (
                <div
                  key={ci}
                  className="flex items-center justify-center"
                  style={{
                    gap: 7,
                    padding: "10px 8px",
                    // The winner is marked by its GROUND, not by its type
                    // colour — at thumbnail size a tinted band is legible when
                    // a shade of green on one number is not.
                    background: c.best
                      ? "rgba(74,124,89,0.13)"
                      : c.worst
                        ? "rgba(185,76,76,0.10)"
                        : "transparent",
                    borderRadius: 6,
                  }}
                >
                  <span
                    className="tabular"
                    style={{
                      color: c.best ? "var(--good)" : c.worst ? "var(--bad)" : "var(--ink)",
                      fontSize: 20,
                      fontWeight: c.best || c.worst ? 700 : 500,
                      lineHeight: 1.2,
                      textAlign: "center",
                    }}
                  >
                    {c.display}
                  </span>
                  {typeof c.pct === "number" && (
                    <span
                      className="tabular"
                      style={{
                        color: pctColor(c.pct),
                        background: pctBg(c.pct),
                        fontSize: 11,
                        fontWeight: 700,
                        padding: "2px 5px",
                        borderRadius: 4,
                        lineHeight: 1.2,
                      }}
                    >
                      {c.pct}
                    </span>
                  )}
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>

      {/* ── Colophon. The URL is the whole reason the card is branded. */}
      <div
        className="flex items-center justify-between"
        style={{ padding: "20px 40px 24px", borderTop: "2px solid var(--ink)" }}
      >
        <div
          style={{
            color: "var(--ink)",
            fontSize: 15,
            fontWeight: 700,
            letterSpacing: "0.06em",
          }}
        >
          btacbb.xyz
        </div>
        <div
          style={{
            color: "var(--ink-muted)",
            fontSize: 11,
            fontWeight: 600,
            letterSpacing: "0.16em",
            textTransform: "uppercase",
          }}
        >
          {footnote ?? "College basketball analytics"}
        </div>
      </div>
    </div>
  );
});
