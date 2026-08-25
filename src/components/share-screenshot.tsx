"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { cn } from "@/lib/utils";

/**
 * The sheet that appears after a comparison has been rendered to a PNG:
 * the image itself, and one button that hands it to the phone.
 *
 * WHY IT EXISTS. The capture used to end in `window.open(objectUrl)`. On a
 * desktop that is a new tab with the picture in it; on a phone it is nothing at
 * all. Two reasons, both fatal on their own: the open happens after a chain of
 * awaits — the image pre-fetch, two animation frames, the encode — so by the
 * time it fires iOS no longer considers it part of the tap that started it and
 * the popup blocker takes it; and Safari has never been reliable about blob
 * URLs opened into a new tab regardless. So the button appeared to do nothing,
 * which is exactly what it looked like.
 *
 * Showing the result in the page instead of navigating to it fixes the visible
 * half. The other half is that a phone does not want a new tab — it wants the
 * share sheet, so the picture can go to Messages or a group chat. That is
 * `navigator.share` with a File, which IS allowed to be async, because it is
 * gated on the user tapping THIS button rather than the one two seconds ago.
 *
 * The fallbacks matter and are ordered by how much the platform can do:
 *   1. Web Share with files — iOS and Android. The native sheet.
 *   2. A download. Desktop Chrome and Firefox, which can share nothing.
 *   3. A new tab. Last resort, and now it IS inside a real gesture, so on the
 *      rare browser that reaches this line it actually opens.
 */
export function ShareScreenshotSheet({
  blob,
  filename,
  caption,
  onClose,
}: {
  /** The rendered PNG. */
  blob: Blob;
  /** Name the file gets in the share sheet or the downloads folder. */
  filename: string;
  /** One line under the title — what this is a picture of. */
  caption?: string;
  onClose: () => void;
}) {
  const [url, setUrl] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const closeRef = useRef<HTMLButtonElement>(null);

  // NO `mounted` FLAG. This only ever renders once a capture has finished, so
  // it cannot be reached during SSR; the typeof guard below is enough. The
  // usual useEffect(() => setMounted(true)) dance would be a cascading render
  // bought for nothing.
  useEffect(() => {
    const u = URL.createObjectURL(blob);
    setUrl(u);
    return () => URL.revokeObjectURL(u);
  }, [blob]);

  // Escape closes, and the page behind stays put while this is up.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    closeRef.current?.focus();
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [onClose]);

  async function share() {
    if (!url || busy) return;
    setBusy(true);
    setNote(null);
    try {
      const file = new File([blob], filename, { type: "image/png" });
      // canShare({files}) is the only honest test. `navigator.share` existing
      // says nothing about whether this browser will take a file.
      if (typeof navigator !== "undefined" && navigator.canShare?.({ files: [file] })) {
        await navigator.share({ files: [file], title: caption ?? "Beyond the Arc" });
        return;
      }
      const a = document.createElement("a");
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setNote("Saved to your downloads.");
    } catch (e) {
      // AbortError is the user backing out of the native sheet. That is not a
      // failure and must not be reported as one.
      if (e instanceof DOMException && e.name === "AbortError") return;
      try {
        window.open(url, "_blank", "noopener,noreferrer");
      } catch {
        setNote("Could not share the image. Press and hold it to save.");
      }
    } finally {
      setBusy(false);
    }
  }

  if (typeof document === "undefined") return null;

  return createPortal(
    <div
      className="fixed inset-0 z-[80] flex flex-col bg-ink/85 backdrop-blur-sm"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label="Share screenshot"
    >
      <div className="flex items-center justify-between gap-3 px-5 pt-[max(1rem,env(safe-area-inset-top))] pb-4 shrink-0">
        <div className="min-w-0">
          <h2 className="font-display text-xl md:text-2xl text-paper leading-none tracking-tight">
            Share screenshot
          </h2>
          {caption && (
            <p className="text-[0.7rem] uppercase tracking-[0.15em] text-paper/55 font-semibold mt-1.5 truncate">
              {caption}
            </p>
          )}
        </div>
        <button
          ref={closeRef}
          type="button"
          onClick={onClose}
          aria-label="Close"
          className="shrink-0 text-paper/70 hover:text-paper transition-colors w-9 h-9 inline-flex items-center justify-center rounded-full hover:bg-paper/10 text-2xl leading-none"
        >
          ×
        </button>
      </div>

      {/* The picture. A tall comparison is a tall PNG, so it scrolls rather
          than being squeezed down to an unreadable strip. */}
      <div
        className="flex-1 min-h-0 overflow-y-auto overscroll-contain px-5 pb-4"
        onClick={(e) => e.stopPropagation()}
      >
        {url && (
          // Not next/image: this is a blob made moments ago, with no width
          // known ahead of time and nothing for an optimiser to do.
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={url}
            alt="Comparison screenshot"
            className="w-full h-auto rounded-lg ring-1 ring-paper/15 shadow-2xl bg-paper"
          />
        )}
      </div>

      <div
        className="shrink-0 px-5 pt-3 pb-[max(1.25rem,env(safe-area-inset-bottom))]"
        onClick={(e) => e.stopPropagation()}
      >
        {note && (
          <p className="text-center text-[0.7rem] text-paper/70 mb-2.5">{note}</p>
        )}
        <button
          type="button"
          onClick={share}
          disabled={busy || !url}
          className={cn(
            "w-full h-13 rounded-full bg-coral text-white font-semibold",
            "text-xs uppercase tracking-[0.2em]",
            "transition-colors hover:bg-coral/90 active:bg-coral/80",
            (busy || !url) && "opacity-60 pointer-events-none",
          )}
        >
          {busy ? "Sharing…" : "Share"}
        </button>
        <p className="text-center text-[0.62rem] text-paper/45 mt-2.5">
          Or press and hold the image to save it.
        </p>
      </div>
    </div>,
    document.body,
  );
}
