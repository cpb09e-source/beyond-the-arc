"use client";

import { Sun, Moon } from "lucide-react";
import { useEffect, useState } from "react";
import { cn } from "@/lib/utils";

type Theme = "light" | "dark";

function readTheme(): Theme {
  if (typeof document === "undefined") return "light";
  return document.documentElement.getAttribute("data-theme") === "dark"
    ? "dark"
    : "light";
}

function writeTheme(t: Theme) {
  if (typeof document === "undefined") return;
  if (t === "dark") {
    document.documentElement.setAttribute("data-theme", "dark");
  } else {
    document.documentElement.removeAttribute("data-theme");
  }
  try {
    localStorage.setItem("bta-theme", t);
  } catch {
    // Storage blocked (private mode, etc.) — theme still applies for this session.
  }
}

/**
 * Apply the theme instantly. We mute every element's `transition-colors`
 * for one frame via `.theme-flipping` so the whole page flips in a
 * single paint instead of cascading at different per-component speeds
 * (which read as glitchy). Transitions are restored after the next
 * paint cycle so hover/focus animations keep working normally.
 */
function applyTheme(t: Theme) {
  const root = document.documentElement;
  root.classList.add("theme-flipping");
  writeTheme(t);
  requestAnimationFrame(() => {
    requestAnimationFrame(() => root.classList.remove("theme-flipping"));
  });
}

/**
 * ThemeToggle — segmented Light / Dark control, editorial register.
 *
 * Pre-hydration script in `src/app/layout.tsx` reads localStorage and
 * sets `data-theme="dark"` on <html> before first paint, so users who
 * picked dark never see a flash of light tokens. On mount this control
 * reads the current attribute and reflects it as the active option.
 *
 * Visual register: rounded-full segmented control sized to match the
 * kicker line (≈18px tall). Inactive options sit on the page color;
 * the active option lifts onto `bg-paper` with a hairline shadow.
 */
export function ThemeToggle({ className }: { className?: string }) {
  const [theme, setTheme] = useState<Theme>("light");
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setTheme(readTheme());
    setMounted(true);
  }, []);

  function pick(t: Theme) {
    if (t === theme) return;
    setTheme(t);
    applyTheme(t);
  }

  return (
    <div
      role="group"
      aria-label="Color theme"
      className={cn(
        "inline-flex items-center gap-0.5 rounded-full border border-hairline bg-paper-deep/40 p-[2px]",
        className,
      )}
    >
      {(["light", "dark"] as const).map((t) => {
        const Icon = t === "light" ? Sun : Moon;
        const active = mounted && theme === t;
        return (
          <button
            key={t}
            type="button"
            onClick={() => pick(t)}
            aria-pressed={active}
            aria-label={`${t === "light" ? "Light" : "Dark"} theme`}
            title={t === "light" ? "Light" : "Dark"}
            className={cn(
              "inline-flex items-center justify-center rounded-full w-6 h-6 transition-colors",
              active
                ? "bg-paper text-ink shadow-[0_1px_2px_rgba(0,0,0,0.08)]"
                : "text-ink-muted hover:text-ink",
            )}
          >
            <Icon size={12} strokeWidth={2.25} aria-hidden />
          </button>
        );
      })}
    </div>
  );
}
