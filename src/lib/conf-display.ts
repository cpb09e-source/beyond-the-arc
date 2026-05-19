/**
 * Conference-abbreviation display names. The underlying data uses Bart Torvik's
 * compact codes (B10, B12, BE, P12, CUSA, SB, BSky, …) as both internal keys
 * (BTA RTG multipliers, filter values, sort keys) and as the wire format from
 * `teams-all.json`. This module is the single place that maps each code to the
 * label users actually see.
 *
 * Add new aliases here whenever Bart adds a conference; the rest of the app
 * picks up the change automatically.
 */

export const CONF_DISPLAY: Record<string, string> = {
  ACC: "ACC",
  B10: "Big 10",
  B12: "Big 12",
  BE: "Big East",
  SEC: "SEC",
  Amer: "American",
  A10: "A10",
  MWC: "MWC",
  WCC: "WCC",
  MVC: "MVC",
  P12: "Pac 12",
  Pat: "Patriot",
  CAA: "CAA",
  CUSA: "C-USA",
  MAC: "MAC",
  Ivy: "Ivy",
  WAC: "WAC",
  SB: "Sun Belt",
  BSky: "Big Sky",
  BSth: "Big South",
  BW: "Big West",
  Horz: "Horizon",
  Slnd: "Southland",
  Sum: "Summit",
  SC: "Southern",
  MAAC: "MAAC",
  ASun: "ASUN",
  AE: "America East",
  OVC: "OVC",
  NEC: "NEC",
  SWAC: "SWAC",
  MEAC: "MEAC",
  GWC: "Great West",
  Ind: "Indep.",
};

/**
 * Pretty-print a Bart conference code. Unknown codes pass through unchanged
 * so we never silently drop data — newly-added conferences just show their
 * raw code until they're added to CONF_DISPLAY above.
 */
export function confDisplay(code: string | null | undefined): string {
  if (!code) return "—";
  return CONF_DISPLAY[code] ?? code;
}
