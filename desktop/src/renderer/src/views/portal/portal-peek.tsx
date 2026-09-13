import { ArrowRight } from "lucide-react";
import { TopHundredPill } from "@/components/portal/top-hundred-pill";
import { confDisplay } from "@/lib/conf-display";
import { fmtPortalDate, ratingTerms, type PortalEntry } from "@/lib/portal";
import { seasonLabel } from "~/ui/format";
import { TeamLogo } from "~/ui/logo";
import { logoIdOf } from "~/ui/logo-id";
import { PlayerPhoto } from "~/ui/player-photo";
import { Stars } from "~/ui/stars";
import { hasPhotoFor } from "./portal-model";

const MINUS = "−";
const signed2 = (v: number) => `${v > 0 ? "+" : v < 0 ? MINUS : ""}${Math.abs(v).toFixed(2)}`;
const one = (v: number | null) => (v == null ? "–" : v.toFixed(1));

/**
 * What a transfer Peek says: the move, the rating, and last season.
 *
 * THE LEDGER IS THE SITE'S HOVER TEXT, LAID OUT. On the site the rating's
 * arithmetic is one long tooltip; here each term is a line in wins, and they sum
 * to the value the rating is scaled from (lib/portal.ts ratingTerms), so the
 * number can be checked rather than taken.
 *
 * EXCEPT FOR A RETURNER, whose rating comes from his last season at the school
 * he is going back to while the terms on his row are last season's. Laying
 * those out would draw a sum that does not add up, so his Peek says what the
 * rating is instead.
 */
export function PortalPeekBody({ entry: e }: { entry: PortalEntry }) {
  const returner = e.rating_basis === "return";
  const line: Array<[string, number | null]> = [
    ["MPG", e.mpg],
    ["PPG", e.ppg],
    ["RPG", e.rpg],
    ["APG", e.apg],
    ["SPG", e.spg],
    ["BPG", e.bpg],
  ];
  return (
    <>
      <header className="flex items-start gap-3 px-4 pb-3 pt-3.5">
        <PlayerPhoto bartId={e.bart_player_id} hasPhoto={hasPhotoFor(e.bart_player_id)} name={e.name} size={52} />
        <div className="min-w-0 flex-1">
          <div className="flex items-baseline justify-between gap-2">
            <h2 className="truncate text-[16px] font-semibold leading-tight tracking-[-0.01em] text-ink">{e.name}</h2>
            {e.t100 && <TopHundredPill rank={e.t100} className="h-[18px] px-1.5 text-[11px]" />}
          </div>
          <div className="mt-1 flex items-center gap-2 text-[12px] text-ink-muted">
            <Stars stars={e.stars} size={11} />
            <span className="truncate">
              {e.eligibility}
              {e.last_year ? ` · after ${seasonLabel(e.last_year)}` : ""}
            </span>
          </div>
        </div>
      </header>

      <div className="border-t border-hairline px-4 py-2.5">
        <div className="grid grid-cols-[minmax(0,1fr)_16px_minmax(0,1fr)] items-center gap-2 text-[12.5px]">
          <Side team={e.team_from} conf={e.conf_from} />
          <ArrowRight size={14} strokeWidth={2} className="text-ink-muted" />
          <Side team={e.team_to} conf={e.conf_to} />
        </div>
        <div className="mt-1.5 text-[11.5px] text-ink-muted tabular">
          Entered {fmtPortalDate(e.date_entered)}
          {e.team_to ? ` · committed ${fmtPortalDate(e.date_updated)}` : ""}
        </div>
      </div>

      <section className="border-t border-hairline px-4 py-2.5">
        <h3 className="mb-1.5 flex items-baseline justify-between text-[10.5px] font-semibold uppercase tracking-[0.1em] text-ink-muted">
          <span>Transfer rating</span>
          {!returner && <span className="normal-case tracking-normal">in wins</span>}
        </h3>
        {e.rating == null || e.value == null ? (
          <p className="text-[12px] text-ink-muted">No rating: there is no play-by-play fit for this player.</p>
        ) : (
          <>
            {returner ? (
              <p className="text-[12.5px] leading-snug text-ink-soft">
                Rated on his {e.rating_year ? seasonLabel(e.rating_year) : "earlier"} season at {e.team_to}, the school he is going back
                to, because it rates higher than last season
                {e.rating_last_season == null ? ", when he did not clear the baseline" : `'s ${e.rating_last_season}`}.
              </p>
            ) : (
              <ul className="grid gap-[3px]">
                {ratingTerms(e).map((t) => (
                  <li key={t.key} className="grid grid-cols-[minmax(0,1fr)_auto] items-baseline gap-3 text-[12.5px]">
                    <span className="min-w-0 truncate text-ink-soft">
                      {t.label}
                      {t.note && <span className="text-ink-muted"> · {t.note}</span>}
                    </span>
                    <span className="font-mono text-[12px] text-ink tabular">{signed2(t.wins)}</span>
                  </li>
                ))}
              </ul>
            )}
            <div className="mt-1.5 flex items-baseline justify-between border-t border-hairline pt-1.5 text-[12.5px]">
              <span className="text-ink-soft">
                Value <span className="font-mono text-[12px] text-ink tabular">{signed2(e.value)}</span> wins
              </span>
              <span className="flex items-baseline gap-1.5">
                <span className="text-[11.5px] text-ink-muted">Rating</span>
                <span className={`text-[18px] font-semibold leading-none tabular ${e.rating < 0 ? "text-bad" : "text-ink"}`}>{e.rating}</span>
              </span>
            </div>
          </>
        )}
      </section>

      <section className="border-t border-hairline px-4 pb-3 pt-2.5">
        <h3 className="mb-1.5 flex items-baseline justify-between text-[10.5px] font-semibold uppercase tracking-[0.1em] text-ink-muted">
          <span className="truncate">Last season{e.last_team ? ` at ${e.last_team}` : ""}</span>
          <span className="shrink-0 normal-case tracking-normal tabular">{e.gp ?? "–"} games</span>
        </h3>
        <div className="grid grid-cols-6 gap-2">
          {line.map(([label, v]) => (
            <div key={label} className="flex flex-col gap-0.5">
              <span className="text-[10.5px] text-ink-muted">{label}</span>
              <span className="text-[14px] leading-none text-ink tabular">{one(v)}</span>
            </div>
          ))}
        </div>
        <div className="mt-2 flex items-center gap-4 text-[12px] text-ink-muted tabular">
          <span>
            EPM <span className="text-ink">{e.epm == null ? "–" : `${e.epm > 0 ? "+" : ""}${e.epm.toFixed(1)}`}</span>
          </span>
          <span>
            eWins <span className="text-ink">{e.ewins == null ? "–" : e.ewins.toFixed(1)}</span>
          </span>
        </div>
      </section>
    </>
  );
}

function Side({ team, conf }: { team: string | null; conf: string | null }) {
  if (!team) return <span className="text-ink-muted">Undecided</span>;
  return (
    <span className="flex min-w-0 items-center gap-2">
      <TeamLogo id={logoIdOf(team)} name={team} size={20} />
      <span className="min-w-0">
        <span className="block truncate text-ink">{team}</span>
        {conf && <span className="block truncate text-[11px] text-ink-muted">{confDisplay(conf) || conf}</span>}
      </span>
    </span>
  );
}
