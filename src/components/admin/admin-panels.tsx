"use client";

import { useCallback, useEffect, useId, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { popoverStyle, usePopoverAnchor } from "@/components/explorer/use-popover-anchor";
import {
  addTransfer, readBanner, readTransfers, saveBanner, setTransferActive,
  type Banner, type ManualTransfer,
} from "@/lib/admin-api";
import { BannerView } from "@/components/banner-view";
import { dataUrl } from "@/lib/data-url";
import { cn } from "@/lib/utils";

/** Shared card chrome, so the two panels and the run record read as one page. */
export function Panel({ title, hint, children }: { title: string; hint?: string; children: React.ReactNode }) {
  return (
    <section className="rounded-xl border border-ink/10 bg-card shadow-sm overflow-hidden">
      <div className="px-4 py-3 border-b border-hairline">
        <h2 className="text-sm font-semibold text-ink">{title}</h2>
        {hint && <p className="text-[0.7rem] text-ink-muted mt-0.5 leading-relaxed">{hint}</p>}
      </div>
      <div className="p-4">{children}</div>
    </section>
  );
}

const INPUT =
  "w-full h-9 rounded-md border border-ink/15 bg-paper px-2.5 text-sm text-ink " +
  "focus:outline-none focus:ring-2 focus:ring-coral/40 focus:border-coral/40";

const BTN =
  "h-9 inline-flex items-center rounded-md px-3 text-sm font-semibold border border-ink/15 " +
  "text-ink hover:bg-paper-deep transition-colors disabled:opacity-50 disabled:cursor-not-allowed";

/** A saved/failed line that clears itself, so the page does not accumulate receipts. */
function useFlash() {
  const [msg, setMsg] = useState<{ text: string; bad: boolean } | null>(null);
  useEffect(() => {
    if (!msg) return;
    const t = setTimeout(() => setMsg(null), 4000);
    return () => clearTimeout(t);
  }, [msg]);
  return [msg, setMsg] as const;
}

// ── Banner ─────────────────────────────────────────────────────────────────

const EMPTY: Banner = { enabled: false, message: "", tone: "info" };

/**
 * The site banner.
 *
 * WHAT MAKES THIS WORTH HAVING: it is the only thing on the site that can be
 * said to every reader without a build and a 45-minute upload. Everything else
 * on a page is baked.
 *
 * The preview is not decoration. This is the one control whose output every
 * visitor sees, and the gap between typing a sentence and seeing it across the
 * top of the site is where the embarrassing version ships.
 */
/**
 * The things that actually get announced, ready to click.
 *
 * WHY CANNED LINES AND NOT A BLANK BOX. A banner is written in the five
 * minutes when something is already wrong, which is the worst moment to be
 * composing a sentence that every visitor will read. Every one of these is a
 * situation this site has or will have — a feed running late, a maintenance
 * window, the previews going live — and having the wording settled in advance
 * is what stops the 11pm version being the one people see.
 *
 * They FILL THE FORM, they do not publish. The message is still editable, the
 * preview still updates, and Publish is still a separate deliberate click —
 * a one-click path from a menu to every reader's screen is not a convenience.
 *
 * Tone travels with the text because it is part of the message: "delayed" is a
 * warning and "previews are live" is not, and a canned line that arrives in
 * the wrong colour has to be corrected every time it is used.
 */
const PRESETS: Array<{ short: string; message: string; tone: "info" | "warn"; href?: string; label?: string }> = [
  {
    short: "Scores delayed",
    message: "Tonight's scores are running late while the feed catches up. They will fill in shortly.",
    tone: "warn",
  },
  {
    short: "Stats updating",
    message: "Last night's numbers are still updating across the site.",
    tone: "warn",
  },
  {
    short: "Data issue",
    message: "We are looking into a problem with today's data. Some numbers may be wrong or missing.",
    tone: "warn",
  },
  {
    short: "Maintenance",
    message: "Brief maintenance is underway. Some pages may be slow or unavailable for a few minutes.",
    tone: "warn",
  },
  {
    short: "Previews live",
    message: "2026-27 season previews are live — projected rosters, returning minutes and transfers for all 365 teams.",
    tone: "info",
    href: "/preview/",
    label: "Browse the previews",
  },
  {
    short: "Season opens",
    message: "The 2026-27 season is under way. Every page now updates nightly.",
    tone: "info",
    href: "/scoreboard/",
    label: "Tonight's scoreboard",
  },
  {
    short: "Portal update",
    message: "Transfer portal tracking is up to date through today.",
    tone: "info",
    href: "/portal/",
    label: "See the portal",
  },
];

export function BannerPanel() {
  const [b, setB] = useState<Banner>(EMPTY);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [flash, setFlash] = useFlash();

  useEffect(() => {
    let live = true;
    readBanner()
      .then((v) => { if (live && v) setB({ ...EMPTY, ...v }); })
      .catch(() => {})
      .finally(() => { if (live) setLoading(false); });
    return () => { live = false; };
  }, []);

  const save = useCallback(async (next: Banner) => {
    setBusy(true);
    try {
      await saveBanner(next);
      setB(next);
      setFlash({ text: next.enabled ? "Banner is live." : "Banner is off.", bad: false });
    } catch (e) {
      setFlash({ text: e instanceof Error ? e.message : "Could not save.", bad: true });
    } finally {
      setBusy(false);
    }
  }, [setFlash]);

  if (loading) return <Panel title="Site banner"><p className="text-sm text-ink-muted">Loading…</p></Panel>;

  const canEnable = b.message.trim().length > 0;

  return (
    <Panel
      title="Site banner"
      hint="Across the top of every page, for everyone, live the moment you save. No deploy."
    >
      <div className="flex flex-col gap-3">
        <div>
          <span className="text-[0.6rem] uppercase tracking-widest text-ink-muted font-medium">Common messages</span>
          <div className="mt-1.5 flex flex-wrap gap-1.5">
            {PRESETS.map((p) => (
              <button
                key={p.short}
                type="button"
                title={p.message}
                // Fills the form. Publishing stays a separate, deliberate click.
                onClick={() => setB({ ...b, message: p.message, tone: p.tone, href: p.href, label: p.label })}
                className="h-7 px-2.5 rounded-full text-[0.7rem] font-medium border border-ink/15 text-ink-soft hover:border-coral/40 hover:text-ink transition-colors"
              >
                {p.short}
              </button>
            ))}
          </div>
        </div>

        <label className="flex flex-col gap-1">
          <span className="text-[0.6rem] uppercase tracking-widest text-ink-muted font-medium">Message</span>
          <input
            className={INPUT}
            value={b.message}
            maxLength={280}
            placeholder="Scores are delayed tonight while the feed catches up."
            onChange={(e) => setB({ ...b, message: e.target.value })}
          />
        </label>

        <div className="grid grid-cols-2 gap-3">
          <label className="flex flex-col gap-1">
            <span className="text-[0.6rem] uppercase tracking-widest text-ink-muted font-medium">Link (optional)</span>
            <input
              className={INPUT}
              value={b.href ?? ""}
              placeholder="/preview/"
              onChange={(e) => setB({ ...b, href: e.target.value || undefined })}
            />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-[0.6rem] uppercase tracking-widest text-ink-muted font-medium">Link text</span>
            <input
              className={INPUT}
              value={b.label ?? ""}
              placeholder="See the previews"
              onChange={(e) => setB({ ...b, label: e.target.value || undefined })}
            />
          </label>
        </div>

        <div className="flex items-center gap-2">
          <span className="text-[0.6rem] uppercase tracking-widest text-ink-muted font-medium">Tone</span>
          {(["info", "warn"] as const).map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => setB({ ...b, tone: t })}
              className={cn(
                "h-7 px-2.5 rounded text-[0.7rem] font-semibold border transition-colors",
                b.tone === t ? "border-coral/50 bg-coral/10 text-ink" : "border-ink/15 text-ink-muted hover:text-ink",
              )}
            >
              {t === "info" ? "Info" : "Warning"}
            </button>
          ))}
        </div>

        {/*
          ALWAYS VISIBLE, AND DRAWN BY THE REAL COMPONENT.

          Always visible because this is the one control on the site whose
          output every single visitor sees, and the gap between typing a
          sentence and watching it appear across the top of the site is exactly
          where the embarrassing version ships. Showing it only once there is
          text means the moment you most want to see the shape — before you
          have committed to any — is the moment it is hidden.

          Drawn by BannerView, which is the same component the site itself
          renders, so this cannot quietly stop matching. A preview built from a
          second copy of the classes is accurate right up until somebody
          changes one of them, at which point it is confidently wrong.

          Full-bleed out of the card's padding, because the real thing spans
          the window and a preview inset by 16px reads narrower than it is.
        */}
        <div>
          <span className="text-[0.6rem] uppercase tracking-widest text-ink-muted font-medium">
            Preview {!b.enabled && <span className="normal-case tracking-normal">— not live</span>}
          </span>
          <div className="mt-1 -mx-4 border-y border-hairline">
            <BannerView
              banner={{
                message: b.message.trim() || "Your message will appear here.",
                tone: b.tone,
                href: b.href,
                label: b.label,
              }}
              className={cn("border-b-0", !b.message.trim() && "italic opacity-60")}
            />
          </div>
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          <button
            type="button"
            disabled={busy || !canEnable}
            onClick={() => save({ ...b, enabled: true })}
            className={cn(BTN, "border-coral/40 bg-coral/10")}
            title={canEnable ? undefined : "A banner needs something to say."}
          >
            {b.enabled ? "Update" : "Publish"}
          </button>
          <button
            type="button"
            disabled={busy || !b.enabled}
            onClick={() => save({ ...b, enabled: false })}
            className={BTN}
          >
            Take it down
          </button>
          {b.enabled && (
            <span className="text-[0.7rem] text-good font-semibold">Live now</span>
          )}
          {flash && (
            <span className={cn("text-[0.7rem] font-semibold", flash.bad ? "text-bad" : "text-good")}>
              {flash.text}
            </span>
          )}
        </div>
      </div>
    </Panel>
  );
}

// ── Manual transfers ───────────────────────────────────────────────────────

/**
 * Hand-confirmed portal moves.
 *
 * WHY THIS EXISTS AS A TABLE AND NOT A LIST IN A SCRIPT. It was a list in a
 * script — in TWO scripts, patch-preview-manual-transfers.mjs and
 * patch-portal-manual.mts, each carrying a comment telling whoever edits it to
 * keep the other in step. A move added to one and not the other leaves the
 * portal table and the team pages disagreeing about where a player is. Adding
 * one also meant editing source and running a build.
 *
 * WITHDRAW, NOT DELETE. A move that turns out to be wrong is something that
 * was believed on a date and then retracted, and the retraction is worth
 * keeping — not least because it stops the same claim being re-entered next
 * week by someone who does not remember why it went away.
 */

/**
 * The destination field.
 *
 * THE STRING HAS TO MATCH THE DATA, which is the whole reason this is not a
 * plain text box. The pipeline resolves the destination against the team
 * table, so "UNC" applies a move to a school that does not exist and "Miami"
 * is ambiguous between two. The script this replaces handles that with
 * DEST_ALIAS, a hand-kept map of shorthands — which covers the ones somebody
 * already thought of and silently fails on the next one.
 *
 * So the field offers the real names and marks the value as unrecognised until
 * one is chosen. It does NOT refuse a free-typed value: a brand-new program in
 * its first season will not be in a list built from last season's data, and
 * being unable to record a real move is worse than recording one that needs
 * checking. The warning is the honest middle.
 *
 * Matching is substring, not prefix — "carolina" should find North Carolina,
 * South Carolina and East Carolina, which is exactly the moment a reader needs
 * to see them side by side.
 */
/**
 * Shorthands that do NOT contain the real name, so a substring search cannot
 * find them.
 *
 * This is the case the field exists for, and it was found by testing it:
 * typing "UNC" offered UNC Asheville, UNC Greensboro and UNC Wilmington and
 * did not offer North Carolina — three wrong schools and not the intended one,
 * which is worse than no suggestions at all.
 *
 * Seeded from DEST_ALIAS in patch-preview-manual-transfers.mjs, which is the
 * same list the pipeline already resolves against. It is intentionally short:
 * these are aliases nobody can derive, not a synonym dictionary. "St." and
 * "State" are handled below instead, because that one IS a rule.
 */
const ALIASES: Record<string, string> = {
  unc: "North Carolina",
  miami: "Miami FL",
  cincy: "Cincinnati",
  "long island": "LIU",
  pitt: "Pittsburgh",
  "ole miss": "Mississippi",
  uconn: "Connecticut",
};

function DestinationField({
  value, onChange, teams,
}: { value: string; onChange: (v: string) => void; teams: string[] }) {
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const listId = useId();

  const matches = useMemo(() => {
    const q = value.trim().toLowerCase();
    if (!q) return [];
    /**
     * "State" is a rule, not an alias: the data spells every one of them
     * "St.", and somebody typing "Oregon State" should be shown Oregon St.
     * rather than nothing at all.
     */
    const spelled = q.replace(/state/g, "st.");
    const aliased = ALIASES[q] ?? ALIASES[spelled];
    const hit = teams.filter(
      (t) => t.toLowerCase().includes(q) || t.toLowerCase().includes(spelled),
    );
    if (aliased) {
      const rest = hit.filter((t) => t !== aliased);
      hit.length = 0;
      hit.push(aliased, ...rest);
      return hit.slice(0, 8);
    }
    // A name that STARTS with the query is almost always the one meant, so
    // those lead — "kansas" should not put Kansas St. above Kansas.
    hit.sort((a, b) => {
      const as = a.toLowerCase().startsWith(q) ? 0 : 1;
      const bs = b.toLowerCase().startsWith(q) ? 0 : 1;
      return as - bs || a.localeCompare(b);
    });
    return hit.slice(0, 8);
  }, [value, teams]);

  const exact = teams.some((t) => t.toLowerCase() === value.trim().toLowerCase());
  const showList = open && matches.length > 0 && !exact;

  /**
   * PORTALLED AND FIXED, not absolute — the same fix the explorers' menus use.
   *
   * The first version of this was an absolutely-positioned <ul>, and it was
   * cropped to about one and a half rows. Panel carries `overflow-hidden` to
   * clip its contents to its rounded corners, and that clip applies to
   * absolutely-positioned descendants too. usePopoverAnchor's header documents
   * this exact bug being found three separate times on this site.
   */
  const { anchorRef, popRef, at } = usePopoverAnchor({ open: showList, width: "trigger" });

  useEffect(() => {
    if (!showList) return;
    function onDown(e: MouseEvent) {
      const t = e.target as Node;
      // Both refs: the panel is no longer a descendant of the wrapper.
      if (anchorRef.current?.contains(t) || popRef.current?.contains(t)) return;
      setOpen(false);
    }
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [showList, anchorRef, popRef]);

  function choose(name: string) {
    onChange(name);
    setOpen(false);
  }

  const warn = value.trim() && !exact;

  return (
    <div className="flex flex-col gap-1 flex-1 min-w-[10rem]">
      <span className="text-[0.6rem] uppercase tracking-widest text-ink-muted font-medium">To</span>
      <div ref={anchorRef} className="relative">
        <input
          className={cn(INPUT, warn && "border-bad/50")}
          value={value}
          placeholder="Missouri"
          autoComplete="off"
          role="combobox"
          aria-expanded={showList}
          aria-controls={listId}
          aria-autocomplete="list"
          onChange={(e) => { onChange(e.target.value); setOpen(true); setActive(0); }}
          onFocus={() => setOpen(true)}
          onKeyDown={(e) => {
            if (!showList) return;
            if (e.key === "ArrowDown") { e.preventDefault(); setActive((i) => Math.min(i + 1, matches.length - 1)); }
            if (e.key === "ArrowUp") { e.preventDefault(); setActive((i) => Math.max(i - 1, 0)); }
            if (e.key === "Enter") { e.preventDefault(); choose(matches[active] ?? matches[0]!); }
            if (e.key === "Escape") setOpen(false);
          }}
        />
        {/*
          OUT OF FLOW, DELIBERATELY. In the flow this message made the field
          taller the moment it appeared, which pushed every other control in
          the row down and left the labels misaligned — the row jumped while
          you were typing in it. A validation hint must not resize the thing
          it is validating.
        */}
        {warn && (
          <span className="absolute left-0 top-full mt-0.5 text-[0.65rem] text-bad leading-tight">
            Not a name we hold — pick one from the list.
          </span>
        )}
      </div>

      {showList && at && typeof document !== "undefined" && createPortal(
        // popRef is typed for a div, and the div is the right owner anyway: it
        // carries the fixed placement and the scroll, leaving the <ul> to be
        // just the list.
        <div
          ref={popRef}
          style={popoverStyle(at)}
          className="z-60 overflow-y-auto rounded-lg border border-hairline bg-popover shadow-xl py-1"
        >
        <ul id={listId} role="listbox">
          {matches.map((t, i) => (
            <li key={t}>
              <button
                type="button"
                role="option"
                aria-selected={i === active}
                onMouseEnter={() => setActive(i)}
                onClick={() => choose(t)}
                className={cn(
                  "w-full text-left px-2.5 py-1.5 text-sm text-ink transition-colors",
                  i === active ? "bg-ink/[0.06]" : "hover:bg-ink/[0.04]",
                )}
              >
                {t}
              </button>
            </li>
          ))}
        </ul>
        </div>,
        document.body,
      )}
    </div>
  );
}

export function TransfersPanel() {
  const [rows, setRows] = useState<ManualTransfer[] | null>(null);
  const [name, setName] = useState("");
  const [pid, setPid] = useState("");
  const [dest, setDest] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [teams, setTeams] = useState<string[]>([]);
  const [flash, setFlash] = useFlash();

  // 12 KB of names, from the same export the site is built from. A failure
  // here leaves the field as a plain text box rather than blocking the form.
  useEffect(() => {
    let live = true;
    fetch(dataUrl("/data/team-names.json"))
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => { if (live && j?.teams) setTeams(j.teams.map((t: { name: string }) => t.name)); })
      .catch(() => {});
    return () => { live = false; };
  }, []);

  const load = useCallback(() => {
    readTransfers().then(setRows).catch((e) => {
      setRows([]);
      setFlash({ text: e instanceof Error ? e.message : "Could not load.", bad: true });
    });
  }, [setFlash]);

  useEffect(load, [load]);

  async function add() {
    if (!name.trim() || !dest.trim()) return;
    setBusy(true);
    try {
      await addTransfer({
        player_name: name.trim(),
        destination: dest.trim(),
        bart_player_id: pid.trim() ? Number(pid.trim()) : null,
        note: note.trim() || undefined,
      });
      setName(""); setPid(""); setDest(""); setNote("");
      setFlash({ text: "Added. It applies on the next pipeline run.", bad: false });
      load();
    } catch (e) {
      setFlash({ text: e instanceof Error ? e.message : "Could not add.", bad: true });
    } finally { setBusy(false); }
  }

  async function flip(t: ManualTransfer) {
    setBusy(true);
    try {
      await setTransferActive(t.id, !t.active);
      load();
    } catch (e) {
      setFlash({ text: e instanceof Error ? e.message : "Could not update.", bad: true });
    } finally { setBusy(false); }
  }

  const active = rows?.filter((r) => r.active) ?? [];
  const withdrawn = rows?.filter((r) => !r.active) ?? [];

  return (
    <Panel
      title="Manual transfers"
      hint="Moves the feeds miss. Applied by the pipeline, so a change here shows up after the next run — not instantly."
    >
      {/* pb-4 reserves the space the out-of-flow validation hint sits in, so it
          never lands on top of the list below. */}
      <div className="flex flex-wrap gap-2 items-end pb-4">
        <label className="flex flex-col gap-1 flex-1 min-w-[10rem]">
          <span className="text-[0.6rem] uppercase tracking-widest text-ink-muted font-medium">Player</span>
          <input className={INPUT} value={name} placeholder="Seth Trimble" onChange={(e) => setName(e.target.value)} />
        </label>
        {/*
          OPTIONAL, AND ONLY WORTH FILLING WHEN THE NAME IS AMBIGUOUS.

          Two Curtis Williamses played in 2025-26, both 6-6 juniors, separated
          only by a suffix — the case patch-preview-manual-transfers.mjs
          documents. That script refuses to guess between them and attaches no
          id at all, which leaves the move applied but unlinked. Supplying the
          id here is what resolves it, and it is why two same-named players can
          both be recorded.

          Left blank the pipeline matches by name, exactly as it does today.
        */}
        <label className="flex flex-col gap-1 w-28">
          <span className="text-[0.6rem] uppercase tracking-widest text-ink-muted font-medium">Player id</span>
          <input
            className={INPUT}
            value={pid}
            inputMode="numeric"
            placeholder="optional"
            title="Bart player id. Only needed when two players share a name."
            onChange={(e) => setPid(e.target.value.replace(/[^0-9]/g, ""))}
          />
        </label>
        <DestinationField value={dest} onChange={setDest} teams={teams} />
        {/*
          PROVENANCE, and the label says so because "Note" did not.
          These rows outrank portal.json and the roster scrape both — they are
          asserted on one person's say-so — so the only thing that makes a
          six-month-old claim reviewable is a record of where it came from.
          The placeholder is an example rather than an instruction for the same
          reason: "beat writer" is a useful answer and "note" prompts nothing.
        */}
        <label className="flex flex-col gap-1 flex-1 min-w-[11rem]">
          <span className="text-[0.6rem] uppercase tracking-widest text-ink-muted font-medium">
            Where you saw it
          </span>
          <input
            className={INPUT}
            value={note}
            placeholder="His Instagram post, 8/17"
            title="Optional. Where the move was confirmed — his own post, a beat writer, the school's roster page."
            onChange={(e) => setNote(e.target.value)}
          />
        </label>
        <button type="button" className={cn(BTN, "border-coral/40 bg-coral/10")} disabled={busy || !name.trim() || !dest.trim()} onClick={add}>
          Add
        </button>
      </div>

      {flash && (
        <p className={cn("mt-2 text-[0.7rem] font-semibold", flash.bad ? "text-bad" : "text-good")}>{flash.text}</p>
      )}

      {rows === null && <p className="mt-4 text-sm text-ink-muted">Loading…</p>}

      {rows !== null && rows.length === 0 && (
        <p className="mt-4 text-sm text-ink-muted">
          Nothing yet. The existing hand-confirmed moves still live in the two patch scripts —
          seed them with <code className="font-mono text-xs">npm run seed:transfers</code>.
        </p>
      )}

      {/*
        COLLAPSED BY DEFAULT, because the list is 53 rows on the day it is
        seeded and only grows. What someone opens this panel to do is ADD a
        move; reading the existing ones is the rarer errand, and an unrolled
        list pushes the run controls and the last-run record below the fold on
        every visit.

        A native <details> rather than useState: it keeps the open state
        through a re-render on its own, it is keyboard- and screen-reader-
        correct without any aria, and Ctrl-F finds text inside a closed one in
        current browsers — which matters for a list whose whole purpose is
        looking someone up.
      */}
      {active.length > 0 && (
        <details className="mt-4 group">
          <summary className="flex items-center gap-2 cursor-pointer text-sm text-ink list-none [&::-webkit-details-marker]:hidden">
            <span
              aria-hidden
              className="text-ink-muted text-[0.7rem] transition-transform group-open:rotate-90"
            >
              ▶
            </span>
            <span className="font-semibold">{active.length} active</span>
            {/* Hidden once open: "show" on an expanded list is a lie, and the
                rotated caret already says what state it is in. */}
            <span className="text-ink-muted text-[0.7rem] group-open:hidden">show</span>
          </summary>
          <TransferList rows={active} onFlip={flip} busy={busy} />
        </details>
      )}

      {withdrawn.length > 0 && (
        <details className="mt-3 group">
          <summary className="flex items-center gap-2 cursor-pointer text-sm text-ink-muted list-none [&::-webkit-details-marker]:hidden">
            <span aria-hidden className="text-[0.7rem] transition-transform group-open:rotate-90">▶</span>
            <span className="font-semibold">{withdrawn.length} withdrawn</span>
          </summary>
          <TransferList rows={withdrawn} onFlip={flip} busy={busy} />
        </details>
      )}
    </Panel>
  );
}

function TransferList({
  rows, onFlip, busy,
}: { rows: ManualTransfer[]; onFlip: (t: ManualTransfer) => void; busy: boolean }) {
  return (
    <ul className="mt-3 flex flex-col divide-y divide-hairline border-t border-hairline">
      {rows.map((t) => (
        <li key={t.id} className="py-2 flex items-center gap-3 flex-wrap">
          <span className="flex-1 min-w-[12rem] text-sm text-ink">
            <strong className="font-semibold">{t.player_name}</strong>
            {/* Shown only when set — for an unambiguous name it is noise, and
                for an ambiguous one it is the only thing telling the two rows
                apart. */}
            {t.bart_player_id !== null && (
              <span className="text-[0.7rem] text-ink-muted font-mono"> #{t.bart_player_id}</span>
            )}
            <span className="text-ink-muted"> → </span>
            {t.destination}
            {t.note && <span className="block text-[0.7rem] text-ink-muted mt-0.5">{t.note}</span>}
          </span>
          <span className="text-[0.7rem] text-ink-muted tabular-nums whitespace-nowrap">{t.confirmed_on}</span>
          <button type="button" className={BTN} disabled={busy} onClick={() => onFlip(t)}>
            {t.active ? "Withdraw" : "Restore"}
          </button>
        </li>
      ))}
    </ul>
  );
}
