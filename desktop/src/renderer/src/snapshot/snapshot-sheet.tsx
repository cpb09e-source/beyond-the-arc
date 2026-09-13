import logoOnDark from "@public/images/newbtalogo-white-01.svg";
import logoOnLight from "@public/images/btalogo_final-01.svg";
import { Camera, Copy, Download, X } from "lucide-react";
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { objTitle, objYear } from "~/objects/object";
import { Kbd } from "~/ui/kbd";
import { usePersisted } from "~/ui/persisted";
import { useToast } from "~/ui/toast";
import { CARD_SIZE, SnapshotCard, type CardFormat, type SnapObj } from "./snapshot-cards";

/**
 * The snapshot sheet: the card at the size it will be posted, Wide or Square,
 * then Copy image or Save PNG.
 *
 * WHAT YOU SEE IS THE IMAGE. The preview is the card itself, and Copy captures
 * those pixels from the window (Electron's capturePage, in the main process),
 * so there is no second renderer to disagree with the first. When the window is
 * too small to show the card at full size, the preview is zoomed to fit and the
 * capture is scaled back up to the card's size.
 */

const isFormat = (v: unknown): v is CardFormat => v === "wide" || v === "square";

const slug = (s: string) =>
  s
    .normalize("NFKD")
    .replace(/[^\w\s-]/g, "")
    .trim()
    .replace(/\s+/g, "-")
    .toLowerCase();

function fileName(o: SnapObj, format: CardFormat): string {
  const year = objYear(o);
  return `${slug(objTitle(o))}${year != null ? `-${year - 1}-${String(year).slice(2)}` : ""}-${format}.png`;
}

async function settle(el: HTMLElement): Promise<void> {
  await Promise.all([...el.querySelectorAll("img")].map((img) => img.decode().catch(() => undefined)));
  await document.fonts.ready;
  await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
}

export function SnapshotSheet({ obj, onClose }: { obj: SnapObj; onClose: () => void }) {
  const [format, setFormat] = usePersisted<CardFormat>("bta.snapshot.format", "wide", isFormat);
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState<"copy" | "save" | null>(null);
  const [zoom, setZoom] = useState(1);
  const stageRef = useRef<HTMLDivElement>(null);
  const cardRef = useRef<HTMLDivElement>(null);
  const toast = useToast();
  const { width, height } = CARD_SIZE[format];
  const onReady = useCallback((r: boolean) => setReady(r), []);

  useLayoutEffect(() => {
    const el = stageRef.current;
    if (!el) return;
    const fit = () => setZoom(Math.min(1, (el.clientWidth - 56) / width, (el.clientHeight - 40) / height));
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(el);
    return () => ro.disconnect();
  }, [width, height]);

  const deliver = useCallback(
    async (action: "copy" | "save") => {
      const el = cardRef.current;
      if (!el || !ready || busy) return;
      setBusy(action);
      try {
        await settle(el);
        const r = el.getBoundingClientRect();
        const shot = await window.bta.snapshot.grab({ x: r.left, y: r.top, width: r.width, height: r.height });
        if (!shot) throw new Error("capture");
        const res = await window.bta.snapshot.deliver(shot, { action, name: fileName(obj, format), width, height });
        if (!res.ok) {
          setBusy(null);
          return;
        }
        toast(
          action === "copy"
            ? { title: "Image copied", body: `${objTitle(obj)} · ${width} × ${height}. Paste it into a post or a message.` }
            : { title: "Image saved", body: res.path },
        );
        onClose();
      } catch {
        setBusy(null);
        toast({ title: "The snapshot could not be made", body: "Try again with the window in front." });
      }
    },
    [ready, busy, obj, format, width, height, toast, onClose],
  );

  return (
    <div
      className="fixed inset-0 z-50"
      onKeyDown={(e) => {
        e.stopPropagation();
        const mod = e.ctrlKey || e.metaKey;
        if (e.key === "Escape") {
          e.preventDefault();
          onClose();
        } else if ((mod && e.code === "KeyC") || (e.key === "Enter" && !mod)) {
          e.preventDefault();
          void deliver("copy");
        } else if (mod && e.code === "KeyS") {
          e.preventDefault();
          void deliver("save");
        }
      }}
    >
      <div aria-hidden className="palette-scrim absolute inset-0" onMouseDown={onClose} />
      <div
        role="dialog"
        aria-modal="true"
        aria-label={`Snapshot of ${objTitle(obj)}`}
        tabIndex={-1}
        ref={(el) => el?.focus({ preventScroll: true })}
        className="palette-in absolute inset-x-8 bottom-8 top-12 flex flex-col overflow-hidden rounded-xl border border-hairline bg-card outline-none"
        style={{ boxShadow: "var(--overlay-shadow)" }}
      >
        <header className="flex h-[52px] shrink-0 items-center gap-3 border-b border-hairline px-4">
          <Camera size={16} strokeWidth={2} className="text-ink-muted" />
          <h2 className="text-[14px] font-semibold text-ink">Snapshot</h2>
          <span className="min-w-0 truncate text-[13px] text-ink-muted">{objTitle(obj)}</span>
          <div role="radiogroup" aria-label="Card shape" className="ml-auto flex h-[28px] items-center rounded-md border border-hairline bg-paper p-0.5 text-[12.5px]">
            {(
              [
                ["wide", "Wide"],
                ["square", "Square"],
              ] as const
            ).map(([value, label]) => (
              <button
                key={value}
                type="button"
                role="radio"
                aria-checked={format === value}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => {
                  // The card remounts, and reports ready again, only when the shape really changes.
                  if (value === format) return;
                  setReady(false);
                  setFormat(value);
                }}
                className={`h-full rounded-[4px] px-2.5 transition-colors ${
                  format === value ? "bg-[var(--nav-active)] font-medium text-ink" : "text-ink-muted hover:text-ink"
                }`}
              >
                {label}
              </button>
            ))}
          </div>
          <button
            type="button"
            aria-label="Close"
            onMouseDown={(e) => e.preventDefault()}
            onClick={onClose}
            className="grid size-[28px] place-items-center rounded-md text-ink-muted transition-colors hover:bg-[var(--row-hover)] hover:text-ink"
          >
            <X size={15} strokeWidth={2} />
          </button>
        </header>

        <div ref={stageRef} className="grid min-h-0 flex-1 place-items-center overflow-hidden bg-[color-mix(in_oklab,var(--ink)_5%,var(--paper))]">
          <div style={{ zoom }} className="shadow-[0_1px_3px_rgb(0_0_0/0.08),0_12px_40px_rgb(0_0_0/0.10)]">
            <div ref={cardRef}>
              <SnapshotCard key={format} obj={obj} format={format} onReady={onReady} />
            </div>
          </div>
        </div>

        <footer className="flex h-[56px] shrink-0 items-center gap-3 border-t border-hairline px-4">
          <span className="text-[12.5px] text-ink-muted tabular">
            {width} × {height} PNG
            {zoom < 1 ? ` · preview at ${Math.round(zoom * 100)}%` : ""}
          </span>
          <button
            type="button"
            disabled={!ready || !!busy}
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => void deliver("save")}
            className="ml-auto inline-flex h-[32px] items-center gap-2 rounded-md border border-hairline bg-card px-3 text-[13px] text-ink-soft transition-colors hover:border-ink-muted hover:text-ink disabled:opacity-50"
          >
            <Download size={14} strokeWidth={2} />
            {busy === "save" ? "Saving…" : "Save PNG"}
            <Kbd>Ctrl S</Kbd>
          </button>
          <button
            type="button"
            disabled={!ready || !!busy}
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => void deliver("copy")}
            className="inline-flex h-[32px] items-center gap-2 rounded-md bg-accent px-3.5 text-[13px] font-medium text-white transition-[filter,opacity] hover:brightness-110 disabled:opacity-50"
          >
            <Copy size={14} strokeWidth={2} />
            {busy === "copy" ? "Copying…" : "Copy image"}
          </button>
        </footer>
      </div>
    </div>
  );
}

async function loadImage(src: string): Promise<HTMLImageElement> {
  const img = new Image();
  img.src = src;
  await img.decode();
  return img;
}

/**
 * The tab in front, as an image: the pane's own pixels with a foot that names the
 * view and the site, so a table or chart shared from the app says where it is from.
 *
 * DRAWN ON A CANVAS, safely: the pane comes back from the main process as a PNG
 * data URL and the wordmark is the app's own file, so nothing on the canvas is
 * from another origin. Toasts and the compare tray are hidden for the moment of
 * the capture.
 */
export async function snapshotView(label: string, action: "copy" | "save"): Promise<{ ok: boolean; path?: string }> {
  const pane = document.querySelector("main");
  if (!pane) return { ok: false };
  const root = document.documentElement;
  root.dataset.snapshotting = "";
  try {
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    const r = pane.getBoundingClientRect();
    const shot = await window.bta.snapshot.grab({ x: r.left, y: r.top, width: r.width, height: r.height });
    if (!shot) return { ok: false };
    const img = await loadImage(shot);
    const scale = img.naturalWidth / r.width;
    const foot = Math.round(52 * scale);
    const canvas = document.createElement("canvas");
    canvas.width = img.naturalWidth;
    canvas.height = img.naturalHeight + foot;
    const ctx = canvas.getContext("2d");
    if (!ctx) return { ok: false };
    const css = getComputedStyle(root);
    const token = (name: string, fallback: string) => css.getPropertyValue(name).trim() || fallback;
    const dark = root.dataset.theme === "dark";

    ctx.drawImage(img, 0, 0);
    ctx.fillStyle = token("--chrome", dark ? "#171717" : "#f3efe7");
    ctx.fillRect(0, img.naturalHeight, canvas.width, foot);
    ctx.fillStyle = token("--hairline", dark ? "#333331" : "#e7e2d5");
    ctx.fillRect(0, img.naturalHeight, canvas.width, Math.max(1, Math.round(scale)));

    const logo = await loadImage(dark ? logoOnDark : logoOnLight);
    const lh = 17 * scale;
    const ratio = logo.naturalWidth && logo.naturalHeight ? logo.naturalWidth / logo.naturalHeight : 5.5;
    ctx.drawImage(logo, 20 * scale, img.naturalHeight + (foot - lh) / 2, lh * ratio, lh);

    ctx.font = `${13 * scale}px "Schibsted Grotesk Variable", system-ui, sans-serif`;
    ctx.fillStyle = token("--ink-muted", dark ? "#8f8a82" : "#6b6f7e");
    ctx.textAlign = "right";
    ctx.textBaseline = "middle";
    ctx.fillText(`${label}  ·  btacbb.xyz`, canvas.width - 20 * scale, img.naturalHeight + foot / 2);

    const name = `${slug(label)}.png`;
    return window.bta.snapshot.deliver(canvas.toDataURL("image/png"), { action, name, width: canvas.width, height: canvas.height });
  } finally {
    delete root.dataset.snapshotting;
  }
}
