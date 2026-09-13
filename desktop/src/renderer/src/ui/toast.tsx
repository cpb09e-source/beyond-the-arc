import { X } from "lucide-react";
import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";

/**
 * Short confirmations, bottom left, the way Linear does them.
 *
 * FIVE SECONDS, AND NEVER WHILE THE POINTER IS ON ONE: a toast someone is
 * reaching for must not vanish under the cursor. At most three at a time; a
 * fourth pushes the oldest out.
 *
 * FOR WHAT JUST HAPPENED, never for errors that need a decision. Those belong
 * where the problem is (a season that cannot open says so in its table).
 */

export type ToastInput = {
  title: string;
  body?: string;
  action?: { label: string; run: () => void };
};

type Toast = ToastInput & { id: number };

const ToastContext = createContext<(t: ToastInput) => void>(() => {});

export const useToast = () => useContext(ToastContext);

const LIFETIME_MS = 5000;

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const seq = useRef(0);

  const push = useCallback((t: ToastInput) => {
    seq.current += 1;
    const id = seq.current;
    setToasts((s) => [...s.slice(-2), { ...t, id }]);
  }, []);
  const dismiss = useCallback((id: number) => setToasts((s) => s.filter((x) => x.id !== id)), []);

  return (
    <ToastContext.Provider value={push}>
      {children}
      <div aria-live="polite" className="pointer-events-none fixed bottom-4 left-4 z-[70] flex w-[340px] flex-col gap-2">
        {toasts.map((t) => (
          <ToastCard key={t.id} toast={t} onDone={dismiss} />
        ))}
      </div>
    </ToastContext.Provider>
  );
}

function ToastCard({ toast, onDone }: { toast: Toast; onDone: (id: number) => void }) {
  const [hovered, setHovered] = useState(false);

  useEffect(() => {
    if (hovered) return;
    const timer = setTimeout(() => onDone(toast.id), LIFETIME_MS);
    return () => clearTimeout(timer);
  }, [hovered, onDone, toast.id]);

  return (
    <div
      role="status"
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      className="toast-in pointer-events-auto flex items-start gap-3 rounded-lg border border-hairline bg-card px-3.5 py-2.5"
      style={{ boxShadow: "var(--overlay-shadow)" }}
    >
      <div className="min-w-0 flex-1">
        <p className="text-[13px] font-medium text-ink">{toast.title}</p>
        {toast.body && <p className="mt-0.5 text-[12px] text-ink-muted">{toast.body}</p>}
      </div>
      {toast.action && (
        <button
          type="button"
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => {
            toast.action?.run();
            onDone(toast.id);
          }}
          className="shrink-0 self-center rounded-md px-2 py-1 text-[12.5px] font-medium text-accent transition-colors hover:bg-[var(--accent-wash)]"
        >
          {toast.action.label}
        </button>
      )}
      <button
        type="button"
        aria-label="Dismiss"
        onMouseDown={(e) => e.preventDefault()}
        onClick={() => onDone(toast.id)}
        className="mt-0.5 grid size-[18px] shrink-0 place-items-center rounded text-ink-muted transition-colors hover:bg-[var(--row-hover)] hover:text-ink"
      >
        <X size={12} />
      </button>
    </div>
  );
}
