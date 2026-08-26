"use client";

import { useRouter } from "next/navigation";
import { Select } from "@/components/select";

/**
 * Jump to a teammate's page.
 *
 * DESKTOP ONLY. On a phone the hero is already carrying a headshot, a name, two
 * badges, a vitals run, a draft chip and the Top-100 mark on the same few
 * hundred pixels, and a control that goes somewhere else does not belong in
 * that contest. The bottom bar is what a phone reader navigates with here.
 *
 * A NAVIGATION CONTROL, NOT A FILTER, which is why it always reads "Teammates"
 * rather than the current player's name. A select showing a value implies the
 * page is a view of that value and that changing it changes the view; this one
 * leaves for a different page entirely. The placeholder never sticks — the
 * value resets on selection so the label is still there when the reader lands
 * on the next player's hero and looks for it again.
 *
 * The list only contains players who HAVE a page: see readTeammates, and the
 * static-export note there about linking to an unbuilt route.
 */
export function TeammatePicker({
  teammates,
  teamName,
}: {
  teammates: Array<{ id: number; name: string; cls: string | null }>;
  teamName: string;
}) {
  const router = useRouter();
  if (teammates.length === 0) return null;

  return (
    <label className="hidden lg:flex items-center gap-2 justify-end">
      <span className="text-[0.6rem] uppercase tracking-widest text-ink-muted font-medium">
        Teammates
      </span>
      <Select
        value=""
        onChange={(v) => {
          if (v) router.push(`/players/${v}/`);
        }}
        // Not "a ${teamName} teammate" — that reads "a Arizona" for
        // every vowel-initial school.
        ariaLabel={`${teamName} teammates`}
        className="w-48"
      >
        <option value="">Select…</option>
        {teammates.map((t) => (
          <option key={t.id} value={t.id}>
            {t.cls ? `${t.name} · ${t.cls}` : t.name}
          </option>
        ))}
      </Select>
    </label>
  );
}
