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
  B10: "BIG 10",
  B12: "BIG 12",
  BE: "BIG EAST",
  SEC: "SEC",
  Amer: "AMER",
  A10: "A10",
  MWC: "MWC",
  WCC: "WCC",
  MVC: "MVC",
  P12: "PAC 12",
  Pat: "PAT",
  CAA: "CAA",
  CUSA: "C-USA",
  MAC: "MAC",
  Ivy: "IVY",
  WAC: "WAC",
  SB: "SUN BELT",
  BSky: "BIG SKY",
  BSth: "BIG SOUTH",
  BW: "BIG WEST",
  Horz: "HORZ",
  Slnd: "SOUTHLAND",
  Sum: "SUM",
  SC: "SOUTHERN",
  MAAC: "MAAC",
  ASun: "ASUN",
  AE: "AE",
  OVC: "OVC",
  NEC: "NEC",
  SWAC: "SWAC",
  MEAC: "MEAC",
  GWC: "GREAT WEST",
  Ind: "IND",
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
