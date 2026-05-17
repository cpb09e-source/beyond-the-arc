"use client";

import { useRouter } from "next/navigation";
import { Select } from "@/components/select";

function seasonLabel(y: number): string {
  return `${(y - 1).toString().slice(-2)}-${y.toString().slice(-2)}`;
}

/**
 * Hero-mounted season picker for the team page. Changing the value navigates
 * to `/teams/<slug>/<year>/`, which is statically pre-rendered for every
 * (team, year) we have data for.
 */
export function SeasonSwitcher({
  slug,
  currentYear,
  years,
}: {
  slug: string;
  currentYear: number;
  years: number[];
}) {
  const router = useRouter();
  const sorted = [...years].sort((a, b) => b - a);
  return (
    <Select
      value={String(currentYear)}
      onChange={(v) => router.push(`/teams/${slug}/${v}/`)}
      ariaLabel="Switch season"
      className="min-w-28"
    >
      {sorted.map((y) => (
        <option key={y} value={String(y)}>
          {seasonLabel(y)}
        </option>
      ))}
    </Select>
  );
}
