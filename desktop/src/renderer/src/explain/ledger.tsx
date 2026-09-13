import { ChevronRight } from "lucide-react";
import { useState, type MouseEvent } from "react";
import { useStatLens } from "~/lens/stat-lens";
import { TeamLogo } from "~/ui/logo";
import type { Explanation, FactorKey, Side } from "./explain-model";

/**
 * A gap, taken apart: one row per part, each a bar either side of zero, and the
 * gap itself underneath, the same length the parts add up to.
 *
 * OPEN A ROW FOR WHAT IT IS MADE OF: the numbers each side put up at each end
 * of the floor and what that end is worth. Every number opens the Stat Lens on
 * the games behind it, so the drill goes gap → part → number → games.
 *
 * NO TEAM COLORS. A bar's direction says who the part favors, in one ink, as
 * every data mark in the app is drawn.
 */

export type LedgerSide = {
  /** How a column heads it: "Duke", "Last 10", "2025-26". */
  label: string;
  team: { name: string; logoId: number | null; year: number };
  side: Side;
};

type Input = { label: string; read: (s: Side) => number | null; fmt: (v: number | null) => string; lens?: string };

const pct = (v: number | null) => (v == null ? "–" : `${(v * 100).toFixed(1)}%`);
const per100 = (v: number | null) => (v == null ? "–" : (v * 100).toFixed(1));
const ratio = (v: number | null) => (v == null ? "–" : v.toFixed(3));

export const PART_TEXT: Record<FactorKey | "schedule", { label: string; blurb: string }> = {
  shooting: { label: "Shooting", blurb: "Effective FG%" },
  turnovers: { label: "Turnovers", blurb: "Possessions that end without a shot" },
  rebounds: { label: "Offensive rebounds", blurb: "Second chances" },
  freeThrows: { label: "Free throws", blurb: "Getting to the line, and making them" },
  count: { label: "Possession count", blurb: "How the log counted possessions" },
  schedule: { label: "Schedule", blurb: "Adjusted for opponents and venue" },
};

const INPUTS: Record<FactorKey, { offense: Input[]; defense: Input[] }> = {
  shooting: {
    offense: [{ label: "eFG%", read: (s) => s.offIn?.e ?? null, fmt: pct, lens: "efg" }],
    defense: [{ label: "Opponent eFG%", read: (s) => s.defIn?.e ?? null, fmt: pct, lens: "efgd" }],
  },
  turnovers: {
    offense: [{ label: "Turnover rate", read: (s) => s.offIn?.t ?? null, fmt: pct, lens: "tovr" }],
    defense: [{ label: "Turnovers forced", read: (s) => s.defIn?.t ?? null, fmt: pct, lens: "tovd" }],
  },
  rebounds: {
    offense: [{ label: "Offensive rebounds per 100", read: (s) => s.offIn?.r ?? null, fmt: per100, lens: "orebp" }],
    defense: [{ label: "Allowed per 100", read: (s) => s.defIn?.r ?? null, fmt: per100, lens: "orebpd" }],
  },
  freeThrows: {
    offense: [
      { label: "Free throw attempts per 100", read: (s) => s.offIn?.a ?? null, fmt: per100, lens: "ftap" },
      { label: "Free throw %", read: (s) => s.offIn?.f ?? null, fmt: pct, lens: "ft_pct" },
    ],
    defense: [
      { label: "Attempts allowed per 100", read: (s) => s.defIn?.a ?? null, fmt: per100, lens: "ftapd" },
      { label: "Opponent free throw %", read: (s) => s.defIn?.f ?? null, fmt: pct, lens: "ftpd" },
    ],
  },
  count: {
    offense: [{ label: "Box-score possessions per logged one", read: (s) => s.offIn?.c ?? null, fmt: ratio }],
    defense: [{ label: "Opponents' box-score possessions per logged one", read: (s) => s.defIn?.c ?? null, fmt: ratio }],
  },
};

const BAR = "color-mix(in oklab, var(--ink) 58%, var(--card))";
const MINUS = "−";

export const signedText = (v: number): string => {
  const t = Math.abs(v).toFixed(1);
  return Number(t) === 0 ? "0.0" : `${v > 0 ? "+" : MINUS}${t}`;
};

function Bar({ value, scale, strong = false }: { value: number; scale: number; strong?: boolean }) {
  const w = Math.min(50, (Math.abs(value) / scale) * 50);
  return (
    <span className="relative block h-[12px]">
      <span aria-hidden className="absolute -inset-y-[5px] left-1/2 w-px bg-hairline" />
      {w > 0.05 && (
        <span
          aria-hidden
          className="absolute inset-y-0 rounded-[3px]"
          style={{ left: value >= 0 ? "50%" : `${50 - w}%`, width: `${w}%`, background: strong ? "var(--accent)" : BAR }}
        />
      )}
    </span>
  );
}

const GRID = "grid grid-cols-[minmax(150px,230px)_minmax(120px,1fr)_68px_22px] items-center gap-x-4";

export function Ledger({
  e,
  x,
  y,
  towardX,
  towardY,
  totalLabel,
}: {
  e: Explanation;
  x: LedgerSide;
  y: LedgerSide;
  /** What a bar to the right means: "Duke ahead", "Better". */
  towardX: string;
  towardY: string;
  totalLabel: string;
}) {
  const [open, setOpen] = useState<FactorKey | null>(null);
  const openLens = useStatLens();
  const rows = e.parts.filter((p) => p.key !== "count" || Math.abs(p.total) >= 0.05);
  const count = e.parts.find((p) => p.key === "count");
  const scale = Math.max(1, Math.abs(e.gap), ...e.parts.map((p) => Math.abs(p.total)), Math.abs(e.schedule ?? 0));

  const lens = (ev: MouseEvent, s: LedgerSide, input: Input) => {
    if (!openLens || !input.lens) return;
    openLens(
      { subject: { kind: "team", ...s.team }, stat: input.lens, shown: { label: `${input.label} (${s.label})`, value: input.fmt(input.read(s.side)) } },
      { x: ev.clientX, y: ev.clientY },
    );
  };

  const ends: Array<"offense" | "defense"> = e.measure === "net" ? ["offense", "defense"] : [e.measure];

  return (
    <div className="text-[13px]">
      <div className={`${GRID} pb-1.5 text-[11px] text-ink-muted`}>
        <span />
        <span className="flex justify-between gap-2">
          <span className="truncate">◂ {towardY}</span>
          <span className="truncate text-right">{towardX} ▸</span>
        </span>
        <span className="text-right">Per 100</span>
        <span />
      </div>

      {rows.map((p) => {
        const expanded = open === p.key;
        const text = PART_TEXT[p.key];
        return (
          <div key={p.key} className="border-t border-hairline">
            <button
              type="button"
              aria-expanded={expanded}
              onMouseDown={(ev) => ev.preventDefault()}
              onClick={() => setOpen(expanded ? null : p.key)}
              className={`${GRID} w-full py-2.5 text-left transition-colors hover:bg-[var(--row-hover)]`}
            >
              <span className="min-w-0">
                <span className="block truncate font-medium text-ink">{text.label}</span>
                <span className="block truncate text-[11.5px] text-ink-muted">{text.blurb}</span>
              </span>
              <Bar value={p.total} scale={scale} />
              <span className="text-right text-[14px] font-semibold text-ink tabular">{signedText(p.total)}</span>
              <ChevronRight size={14} strokeWidth={2} className={`text-ink-muted transition-transform ${expanded ? "rotate-90" : ""}`} />
            </button>
            {expanded && (
              <div className="mb-3 rounded-lg bg-[color-mix(in_oklab,var(--ink)_3%,var(--card))] px-3 py-2">
                <div className="grid grid-cols-[minmax(0,1fr)_92px_92px_64px] items-center gap-x-3 pb-1 text-[11px] text-ink-muted">
                  <span />
                  <SideHead s={x} />
                  <SideHead s={y} />
                  <span className="text-right">Worth</span>
                </div>
                {ends.map((end) =>
                  INPUTS[p.key][end].map((input, i) => (
                    <div key={`${end}:${input.label}`} className="grid h-[30px] grid-cols-[minmax(0,1fr)_92px_92px_64px] items-center gap-x-3 border-t border-hairline/60">
                      <span className="min-w-0 truncate text-ink-soft">
                        {i === 0 && <span className="mr-1.5 text-[10.5px] font-semibold uppercase tracking-[0.07em] text-ink-muted">{end === "offense" ? "Off" : "Def"}</span>}
                        {input.label}
                      </span>
                      {[x, y].map((s) => (
                        <button
                          key={s.label}
                          type="button"
                          disabled={!input.lens || !openLens}
                          title={input.lens ? `${input.label}, ${s.team.name}: game by game` : undefined}
                          onMouseDown={(ev) => ev.preventDefault()}
                          onClick={(ev) => lens(ev, s, input)}
                          className="-mx-1.5 rounded px-1.5 py-0.5 text-right text-ink tabular transition-colors enabled:hover:bg-[var(--row-hover)] enabled:hover:underline disabled:cursor-default"
                        >
                          {input.fmt(input.read(s.side))}
                        </button>
                      ))}
                      <span className="text-right text-ink-soft tabular">{i === 0 ? signedText(end === "offense" ? p.offense : p.defense) : ""}</span>
                    </div>
                  )),
                )}
                {p.key === "count" && (
                  <p className="pt-1.5 text-[11.5px] leading-relaxed text-ink-muted">
                    The log counts a game&rsquo;s possessions its own way, close to the average of both teams&rsquo; box scores. Where a team&rsquo;s own box score counts more, its
                    rating reads lower with no shot changing. Up to about two and a half points between two teams.
                  </p>
                )}
              </div>
            )}
          </div>
        );
      })}

      {e.schedule != null && (
        <div className={`${GRID} border-t border-hairline py-2.5`}>
          <span className="min-w-0">
            <span className="block truncate font-medium text-ink">{PART_TEXT.schedule.label}</span>
            <span className="block truncate text-[11.5px] text-ink-muted">{PART_TEXT.schedule.blurb}</span>
          </span>
          <Bar value={e.schedule} scale={scale} />
          <span className="text-right text-[14px] font-semibold text-ink tabular">{signedText(e.schedule)}</span>
          <span />
        </div>
      )}

      <div className={`${GRID} border-t-2 border-ink/70 py-3`}>
        <span className="font-semibold text-ink">{totalLabel}</span>
        <Bar value={e.gap} scale={scale} strong />
        <span className="text-right text-[16px] font-semibold text-ink tabular">{signedText(e.gap)}</span>
        <span />
      </div>
      {count && Math.abs(count.total) < 0.05 && (
        <p className="text-[11.5px] text-ink-muted">The possession count is worth less than a tenth here, so it is left out.</p>
      )}
    </div>
  );
}

function SideHead({ s }: { s: LedgerSide }) {
  return (
    <span className="flex min-w-0 items-center justify-end gap-1.5">
      <TeamLogo id={s.team.logoId} name={s.team.name} size={13} />
      <span className="truncate">{s.label}</span>
    </span>
  );
}

