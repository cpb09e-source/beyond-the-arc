"use client";

import { useState } from "react";
import cbbTeams from "@/data/cbb-team-ids.json";
import { cn } from "@/lib/utils";

type CbbEntry = {
  bart_name: string;
  id: number;
  market: string;
  mascot: string;
  color1: string;
  color2: string;
  conf: string;
};

const TEAMS = cbbTeams as Record<string, CbbEntry>;

// Secondary lookup: normalize each entry's `market` field. CBB game logs use
// market names ("Texas A&M", "Saint Mary's (CA)") that don't always match the
// keys (normalized Bart names) — this falls back to a market match before
// giving up to the monogram.
const TEAMS_BY_MARKET: Record<string, CbbEntry> = (() => {
  const out: Record<string, CbbEntry> = {};
  for (const k of Object.keys(TEAMS)) {
    const e = TEAMS[k]!;
    if (e.market) out[normalize(e.market)] = e;
  }
  return out;
})();

function normalize(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

// Sports Reference uses display names that diverge from Bart's. When the
// primary lookup misses, we try these explicit aliases before giving up.
// (Bart-name on the right resolves via the normal TEAMS map.)
const SR_NAME_ALIASES: Record<string, string> = {
  "unc": "north carolina",
  "virginia commonwealth": "virginia commonwealth", // CBB entry may key as VCU only
  "vcu": "vcu",
  "byu": "byu",
  "brigham young": "byu",
  "ucla": "ucla",
  "usc": "usc",
  "smu": "smu",
  "lsu": "lsu",
  "ucf": "ucf",
  "siu edwardsville": "siu edwardsville",
  "ut martin": "tennessee martin",
  "umkc": "kansas city",
  "ualbany": "albany",
  "miami fl": "miami fl",
  "miami florida": "miami fl",
  "miami oh": "miami oh",
  "miami ohio": "miami oh",
};

function lookup(name: string): CbbEntry | null {
  const k = normalize(name);
  if (TEAMS[k]) return TEAMS[k]!;
  if (TEAMS_BY_MARKET[k]) return TEAMS_BY_MARKET[k]!;
  // Try SR alias
  const alias = SR_NAME_ALIASES[k];
  if (alias && TEAMS[alias]) return TEAMS[alias]!;
  // " State" → " st" swap (SR writes "Oklahoma State", Bart writes "Oklahoma St.")
  const stateToSt = k.replace(/\bstate\b/g, "st");
  if (stateToSt !== k) {
    if (TEAMS[stateToSt]) return TEAMS[stateToSt]!;
    if (TEAMS_BY_MARKET[stateToSt]) return TEAMS_BY_MARKET[stateToSt]!;
  }
  // Drop common suffix words ("Wildcats", "Tigers", etc.) — SR sometimes
  // includes the mascot in displayed names that came from URLs.
  const noSuffix = k.replace(/\b(wildcats|tigers|bulldogs|huskies|hurricanes|cowboys|raiders|spartans|gators|tar heels|cougars|bears|aggies|red raiders|sun devils|seminoles|jayhawks|wolverines|lions|cyclones|cavaliers|panthers|fighting irish|heels|tide|crimson|jaguars|knights|colonels|musketeers|cardinals)\b/g, "").trim().replace(/\s+/g, " ");
  if (noSuffix !== k && noSuffix.length > 0) {
    if (TEAMS[noSuffix]) return TEAMS[noSuffix]!;
    if (TEAMS_BY_MARKET[noSuffix]) return TEAMS_BY_MARKET[noSuffix]!;
  }
  return null;
}

function initials(name: string): string {
  // "North Carolina State" → "NC", "Duke" → "D", "St. Mary's" → "SM"
  const parts = name
    .replace(/[^A-Za-z\s]/g, " ")
    .split(/\s+/)
    .filter(Boolean)
    .filter((p) => !["of", "the", "at"].includes(p.toLowerCase()));
  if (parts.length === 1) return parts[0]!.slice(0, 2).toUpperCase();
  return (parts[0]![0]! + parts[1]![0]!).toUpperCase();
}

// Pick text color that contrasts with given hex background (simple luminance).
function contrastFor(hex: string): string {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex);
  if (!m) return "#1a2238";
  const v = parseInt(m[1]!, 16);
  const r = (v >> 16) & 0xff;
  const g = (v >> 8) & 0xff;
  const b = v & 0xff;
  const lum = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  return lum > 0.6 ? "#1a2238" : "#ffffff";
}

export function TeamLogo({
  name,
  size = 24,
  className,
}: {
  name: string;
  size?: number;
  className?: string;
}) {
  const entry = lookup(name);
  const [errored, setErrored] = useState(false);

  // No CBB match → monogram fallback in ink
  // CBB match exists → try the GCS logo, fall back to colored monogram on error
  const logoUrl = entry
    ? `https://storage.googleapis.com/cbb-image-files/team-logos/${entry.id}.png`
    : null;

  if (logoUrl && !errored) {
    return (
      <img
        src={logoUrl}
        alt={`${name} logo`}
        width={size}
        height={size}
        loading="lazy"
        onError={() => setErrored(true)}
        className={cn("inline-block object-contain shrink-0", className)}
        style={{ width: size, height: size }}
      />
    );
  }

  // Monogram fallback — use team colors if we have them, else paper-deep
  const bg = entry?.color1 ?? "#e7e2d5";
  const fg = entry ? contrastFor(bg) : "#1a2238";
  return (
    <span
      className={cn(
        "inline-flex items-center justify-center rounded font-display font-medium shrink-0 select-none",
        className
      )}
      style={{
        width: size,
        height: size,
        background: bg,
        color: fg,
        fontSize: Math.round(size * 0.45),
        letterSpacing: "-0.02em",
      }}
      aria-label={`${name} (logo unavailable)`}
    >
      {initials(name)}
    </span>
  );
}
