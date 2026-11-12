import { useEffect, useRef, useState } from "react";

// Edit a local draft copy and merge partial changes, so an editor commits only
// once on save and leaves nothing behind on cancel.
export function useDraft<T>(initial: T) {
  const [draft, setDraft] = useState<T>(initial);
  const patch = (p: Partial<T>) => setDraft((d) => ({ ...d, ...p }));
  return [draft, patch, setDraft] as const;
}

// A draft that saves once edits settle, since sliders and pickers fire on every move.
export function useSettledDraft<T>(value: T, onChange: (value: T) => void, delayMs = 300) {
  const [draft, setDraft] = useState<T>(value);
  const pending = useRef<ReturnType<typeof setTimeout> | null>(null);
  const patch = (p: Partial<T>) => {
    const next = { ...draft, ...p };
    setDraft(next);
    if (pending.current) clearTimeout(pending.current);
    pending.current = setTimeout(() => {
      pending.current = null;
      onChange(next);
    }, delayMs);
  };
  useEffect(() => {
    if (!pending.current) setDraft(value);
  }, [value]);
  return [draft, patch] as const;
}
