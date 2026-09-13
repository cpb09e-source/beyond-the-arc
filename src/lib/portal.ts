/**
 * The transfer portal: the shape of public/data/portal.json and the rules every
 * view of it shares.
 *
 * Used by the site's /portal page and by the desktop app's Transfer Portal, so
 * the two list the same players, in the same order, rated the same way. The
 * numbers themselves are baked into the file by scripts/rescore-portal.mjs.
 */

export type PortalEntry = {
  cbba_player_id: number;
  bart_player_id: number | null;
  name: string;
  eligibility: string;
  status: string;
  division: number | null;
  division_from: number | null;
  division_to: number | null;
  date_entered: string | null;
  date_updated: string | null;
  team_from: string | null;
  conf_from: string | null;
  team_to: string | null;
  conf_to: string | null;
  last_year: number | null;
  /**
   * Position on the overall EPM board for his last season, when inside the
   * top hundred. Absent for everybody else.
   *
   * The same number the top-100 seal draws on the player's own page, baked
   * in by rescore-portal.mjs. It pins the default order and it is why the
   * five-star tier means exactly "top-100 player".
   */
  t100?: number;
  last_team: string | null;
  last_conf: string | null;
  gp: number | null;
  mpg: number | null;
  ppg: number | null;
  rpg: number | null;
  apg: number | null;
  spg: number | null;
  bpg: number | null;
  pir: number | null;
  // Baked into portal.json by scripts/rescore-portal.mjs — real play-by-play
  // fit first, box estimate as fallback for EPM.
  epm: number | null;
  /**
   * Whether each end of the move is a D-I team, resolved against our own
   * archive rather than taken from the feed. On3's division fields are wrong
   * whenever it sends a school in registrar form ("Gonzaga University"), which
   * reported Massamba Diop's Arizona State -> Gonzaga move as D-II on both ends
   * and hid him — and 50 others — from this table entirely.
   */
  d1_from?: boolean;
  d1_to?: boolean;
  /**
   * Wins added over an average player across the possessions he actually
   * played. Null for the handful with only a box estimate: eWins comes solely
   * from the play-by-play fit, and inventing one would put a fabricated zero
   * next to a real number.
   */
  ewins: number | null;
  /** eWins plus the measured freshman development bump. */
  ewins_proj?: number | null;
  /** PIR after the conference-tier multiplier, and that term converted to wins. */
  pir_adj?: number | null;
  pir_wins?: number;
  /** Team net rating on-floor minus off-floor, and the charge for a negative one. */
  on_off?: number | null;
  onoff_pen?: number;
  /** 10% off the finished number for a non-power-conference season. */
  mm_penalty?: number;
  /** eWins + freshman development bump + tiered-PIR term, in wins. */
  value?: number | null;
  /**
   * THE TRANSFER RATING shown in the table: `value` on a readable 0-100 scale
   * at 30 points per win, where 0 is an average player and the best transfer in
   * this cycle lands at 97. Negative for players who cost their team more than
   * an average one would have. Drives the star tiers, so the number and the
   * chip beside it can never disagree.
   */
  rating?: number | null;
  /** EPM added by the sophomore leap; 0 for everyone who is not a freshman. */
  dev_bump?: number;
  stars: 0 | 1 | 2 | 3 | 4 | 5;
  /**
   * A RETURNER'S RATING, when one replaced last season's. A player going back to
   * a school he played for is rated on his last season there when that rates
   * higher (scripts/rescore-portal.mjs). `rating`, `value` and `stars` then
   * describe that season, while the eWins, PIR and on/off terms on the entry are
   * still last season's: they do not add up to `value`, and nothing should
   * present them as if they did.
   */
  rating_basis?: "return";
  /** The season the replacing rating comes from. */
  rating_year?: number;
  /** What last season rated, null where he did not clear the baseline. */
  rating_last_season?: number | null;
};

export type TCPlayer = {
  cbba_player_id: number;
  bart_player_id: number | null;
  name: string;
  // Portal Value Score — EPM scaled by role. Tiers the player (the stars);
  // NOT what the class total is built from. See scripts/rescore-portal.mjs.
  pvs: number | null;
  epm: number | null;
  /** Wins over an average player, as measured last season. */
  ewins: number | null;
  /** eWins plus the measured freshman development bump. */
  ewins_proj: number | null;
  /** EPM added by the sophomore leap; 0 for everyone who is not a freshman. */
  dev_bump?: number;
  /** PIR after the conference-tier multiplier. */
  pir_adj?: number | null;
  /** The tiered-PIR term converted to wins, centered so average = 0. */
  pir_wins?: number;
  /** Team net rating on-floor minus off-floor, and the charge for a negative one. */
  on_off?: number | null;
  onoff_pen?: number;
  /**
   * eWins + development bump + tiered-PIR term − on/off penalty, in wins. The
   * quantity behind the Rating; the class card sums the Rating itself.
   */
  value: number | null;
  /** The player's Rating. Class scores are these, summed. */
  rating?: number | null;
  stars: 0 | 1 | 2 | 3 | 4 | 5;
  /** Overall board position when inside the top 100, else null. */
  t100?: number | null;
  counter_team: string | null;   // OUT: where they went. IN: where they came from.
  counter_conf: string | null;
};

export type TransferClassRow = {
  school: string;
  conference: string | null;
  /**
   * Sum of incoming player Ratings minus the sum of outgoing — a straight
   * ledger, both sides at full weight, so the two columns in the modal
   * subtract to the number on the card.
   */
  net: number;
  /** The same class expressed in wins, for the modal's secondary line. */
  net_wins?: number;
  /**
   * The rating sum, rounded. Runs in the hundreds because a class is seven or
   * eight players and one can be worth 97 alone.
   */
  score: number;
  in_count: number;
  out_count: number;
  in_players: TCPlayer[];
  out_players: TCPlayer[];
};

export type PortalFile = {
  generated_at: string;
  entries: PortalEntry[];
  transfer_classes?: {
    top_overall: TransferClassRow[];
    worst_power: TransferClassRow[];
    by_school?: Record<string, TransferClassRow>;
  };
};

/**
 * Who is worth a row on any view of the portal.
 *
 * BENCH-LEVEL PRODUCTION IS LEFT OFF: ten games, twelve minutes and four points
 * a game, all three.
 *
 * DIVISION I AT ONE END OR THE OTHER. The flags rescore-portal.mjs derives from
 * the site's own team archive come first, and the feed's division fields are
 * the fallback when they are absent: On3 reports a school sent in registrar form
 * ("Gonzaga University") as Division II, which once hid fifty real moves.
 */
export function passesPortalBaseline(e: PortalEntry): boolean {
  if ((e.gp ?? 0) < 10) return false;
  if ((e.mpg ?? 0) < 12) return false;
  if ((e.ppg ?? 0) < 4) return false;
  const fromD1 = e.d1_from ?? (e.division_from === 1);
  const toD1 = e.d1_to ?? (e.division_to === 1);
  if (!fromD1 && !toD1) return false;
  return true;
}

/** When a player committed, for sorting: null until he has a destination. */
export const committedAt = (e: PortalEntry): string | null => (e.team_to ? (e.date_updated ?? null) : null);

/**
 * THE BOARD IS THE FIRST KEY OF EVERY SORT. One block of top-100 players, one
 * block of everyone else; whatever column is picked orders each block
 * internally. Without that, sorting by Rating put a 4-star 89 above every
 * five-star on the board, which is the table contradicting its own tier column.
 */
export const boardBlock = (e: PortalEntry): 0 | 1 => (e.t100 ? 0 : 1);

/**
 * The default order inside each block. Inside the hundred, board order;
 * outside it, commit date newest first with the uncommitted parked at the
 * bottom exactly as they are under the plain commit-date sort.
 */
export function boardCompare(a: PortalEntry, b: PortalEntry): number {
  const ar = a.t100 ?? Infinity, br = b.t100 ?? Infinity;
  if (ar !== br) return ar - br;
  const ad = committedAt(a), bd = committedAt(b);
  if (ad === null && bd === null) return 0;
  if (ad === null) return 1;
  if (bd === null) return -1;
  return ad < bd ? 1 : ad > bd ? -1 : 0;
}

/** A portal date as the table prints it, month and day: "03/25". */
export function fmtPortalDate(s: string | null): string {
  if (!s) return "—";
  // Accept "2026-03-25 01:27:44+00:00" or "2026-03-25T..."
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  return m ? `${m[2]}/${m[3]}` : s.slice(0, 10);
}

/** The rating's arithmetic, spelled out, as the portal table's hover text reads. */
export function portalRatingTitle(e: PortalEntry): string | undefined {
  return e.rating == null ? undefined
                        : `${e.value?.toFixed(2) ?? "—"} wins = ` +
                          `${e.ewins_proj?.toFixed(2) ?? "—"} eWins${(e.dev_bump ?? 0) > 0 ? " (incl. sophomore leap)" : ""}` +
                          `  ·  ${(e.pir_wins ?? 0) >= 0 ? "+" : ""}${(e.pir_wins ?? 0).toFixed(2)} from conference-tiered PIR` +
                          `${e.pir_adj != null ? ` (PIR ${e.pir_adj.toFixed(1)} after tier)` : ""}` +
                          `${(e.onoff_pen ?? 0) < 0 ? `  ·  ${e.onoff_pen?.toFixed(2)} for an on/off of ${e.on_off?.toFixed(1)}` : ""}` +
                          `${(e.mm_penalty ?? 0) < 0 ? `  ·  ${e.mm_penalty?.toFixed(2)} mid-major discount` : ""}` +
                          `${e.epm != null ? `  ·  EPM ${e.epm > 0 ? "+" : ""}${e.epm.toFixed(1)}` : ""}`;
}

/** The same arithmetic for a player inside a transfer class, as the class list's hover text reads. */
export function classPlayerRatingTitle(p: TCPlayer): string | undefined {
  return p.value === null ? undefined
                    : `${p.ewins_proj?.toFixed(2) ?? "—"} eWins${(p.dev_bump ?? 0) > 0 ? " (incl. soph leap)" : ""}` +
                      `  ·  ${(p.pir_wins ?? 0) >= 0 ? "+" : ""}${(p.pir_wins ?? 0).toFixed(2)} from tiered PIR` +
                      `${p.pir_adj != null ? ` (PIR ${p.pir_adj.toFixed(1)} after conference tier)` : ""}` +
                      `${(p.onoff_pen ?? 0) < 0 ? `  ·  ${p.onoff_pen?.toFixed(2)} for an on/off of ${p.on_off?.toFixed(1)}` : ""}`;
}

/** A transfer class lists moves of two stars and up: walk-ons and minimal-impact moves are left out. */
export const CLASS_MIN_STARS = 2;

/** One term of a rating, in wins. */
export type RatingTerm = { key: string; label: string; wins: number; note?: string };

/**
 * The rating, term by term, in wins, as a ledger rather than a sentence. The
 * terms sum to `value` (the file's own quantity), and `rating` is that value on
 * the readable scale. Not for a returner (`rating_basis`), whose value comes from
 * another season than these terms.
 */
export function ratingTerms(e: {
  ewins: number | null;
  ewins_proj?: number | null;
  dev_bump?: number;
  pir_wins?: number;
  pir_adj?: number | null;
  onoff_pen?: number;
  on_off?: number | null;
  mm_penalty?: number;
}): RatingTerm[] {
  const out: RatingTerm[] = [];
  const base = e.ewins_proj ?? e.ewins;
  if (base != null) {
    out.push({
      key: "ewins",
      label: "eWins",
      wins: base,
      note: (e.dev_bump ?? 0) > 0 ? `includes a +${(e.dev_bump ?? 0).toFixed(2)} EPM sophomore leap` : undefined,
    });
  }
  out.push({
    key: "pir",
    label: "Conference-tiered PIR",
    wins: e.pir_wins ?? 0,
    note: e.pir_adj != null ? `PIR ${e.pir_adj.toFixed(1)} after the tier` : undefined,
  });
  if ((e.onoff_pen ?? 0) < 0) {
    out.push({
      key: "onoff",
      label: "On/off charge",
      wins: e.onoff_pen ?? 0,
      note: e.on_off != null ? `on/off of ${e.on_off.toFixed(1)}` : undefined,
    });
  }
  if ((e.mm_penalty ?? 0) < 0) out.push({ key: "mm", label: "Mid-major discount", wins: e.mm_penalty ?? 0 });
  return out;
}
