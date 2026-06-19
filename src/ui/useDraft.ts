import { useState } from "react";

// Edit a local draft copy and merge partial changes, so an editor commits only
// once on save and leaves nothing behind on cancel.
export function useDraft<T>(initial: T) {
  const [draft, setDraft] = useState<T>(initial);
  const patch = (p: Partial<T>) => setDraft((d) => ({ ...d, ...p }));
  return [draft, patch, setDraft] as const;
}
