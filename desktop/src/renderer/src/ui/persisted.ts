import { useEffect, useState, type Dispatch, type SetStateAction } from "react";

/** State that survives a relaunch, validated on the way back in. */
export function usePersisted<T>(
  key: string,
  fallback: T,
  valid: (v: unknown) => v is T,
): [T, Dispatch<SetStateAction<T>>] {
  const [value, setValue] = useState<T>(() => {
    try {
      const raw = localStorage.getItem(key);
      if (raw != null) {
        const parsed: unknown = JSON.parse(raw);
        if (valid(parsed)) return parsed;
      }
    } catch {
      /* unreadable: fall back */
    }
    return fallback;
  });
  useEffect(() => {
    try {
      localStorage.setItem(key, JSON.stringify(value));
    } catch {
      /* not persisted; still applies for this session */
    }
  }, [key, value]);
  return [value, setValue];
}
