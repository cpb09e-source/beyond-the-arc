import type { ReactNode } from "react";

export function Kbd({ children }: { children: ReactNode }) {
  return (
    <kbd className="inline-flex h-[18px] min-w-[18px] items-center justify-center rounded-[4px] border border-hairline bg-paper px-1 font-mono text-[10.5px] font-medium leading-none text-ink-soft">
      {children}
    </kbd>
  );
}
