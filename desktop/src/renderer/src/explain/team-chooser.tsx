import { ChevronDown } from "lucide-react";
import { useMemo, useRef, useState } from "react";
import type { StaticTeamSeasonRow } from "@/lib/static-data";
import { shapeSeason, type Season } from "~/data/team-model";
import { useCorpus } from "~/data/use-corpus";
import { TeamLogo } from "~/ui/logo";
import { Popover } from "~/ui/popover";
import { SearchList, type ListItem } from "~/ui/search-list";

const shapeTeams = (json: string, year: number): Season => shapeSeason(year, JSON.parse(json) as StaticTeamSeasonRow[]);

/**
 * A team's name that is also the control that changes it, as on the Matchup
 * Predictor: the choice is made where the answer is read.
 *
 * Every Division I team of the season, strongest first, found by name or
 * conference.
 */
export function TeamChooser({
  year,
  name,
  logoId,
  label,
  onPick,
  size = "large",
  startOpen = false,
}: {
  year: number;
  name: string | null;
  logoId: number | null;
  /** What the choice is for, for a screen reader and the empty button: "First team". */
  label: string;
  onPick: (name: string) => void;
  size?: "large" | "small";
  /** Opens the list at once, for a page that has nothing to show until a team is chosen. */
  startOpen?: boolean;
}) {
  const [open, setOpen] = useState(startOpen);
  const anchor = useRef<HTMLButtonElement>(null);
  const [state] = useCorpus("teams", year, shapeTeams);
  const items = useMemo<ListItem[]>(() => {
    if (state.status !== "ready") return [];
    return [...state.value.teams]
      .sort((a, b) => (a.btaRank ?? 1e9) - (b.btaRank ?? 1e9))
      .map((t) => ({
        key: t.name,
        label: t.name,
        leading: <TeamLogo id={t.logoId} name={t.name} size={16} />,
        meta: t.confLabel,
        keywords: `${t.conf} ${t.confLabel}`,
      }));
  }, [state]);

  const large = size === "large";
  return (
    <>
      <button
        ref={anchor}
        type="button"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={name ? `${label}, ${name}` : label}
        title={`Change the ${label.toLowerCase()}`}
        onMouseDown={(e) => e.preventDefault()}
        onClick={() => setOpen((o) => !o)}
        className={`group -mx-1.5 flex min-w-0 max-w-[calc(100%+12px)] items-center gap-2 rounded-md px-1.5 py-0.5 transition-colors hover:bg-[color-mix(in_oklab,var(--ink)_7%,transparent)] ${
          open ? "bg-[color-mix(in_oklab,var(--ink)_7%,transparent)]" : ""
        }`}
      >
        {name && <TeamLogo id={logoId} name={name} size={large ? 30 : 18} />}
        <span
          className={`truncate font-semibold tracking-[-0.02em] ${large ? "text-[21px] leading-tight" : "text-[13px]"} ${name ? "text-ink" : "text-ink-muted"}`}
        >
          {name ?? `Choose the ${label.toLowerCase()}`}
        </span>
        <ChevronDown size={large ? 16 : 13} strokeWidth={2} className={`shrink-0 text-ink-muted transition-transform group-hover:text-ink-soft ${open ? "rotate-180" : ""}`} />
      </button>
      {open && (
        <Popover anchor={anchor} onClose={() => setOpen(false)} width={320} label={label}>
          <SearchList
            items={items}
            label={label}
            selected={name ? new Set([name]) : undefined}
            placeholder={state.status === "ready" ? `${items.length} teams` : "Loading teams…"}
            emptyText={state.status === "error" ? "The season's teams did not load" : "No team matches"}
            onPick={(key) => {
              onPick(key);
              setOpen(false);
            }}
            onClose={() => setOpen(false)}
          />
        </Popover>
      )}
    </>
  );
}
