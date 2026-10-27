import { get, update, watch } from "../lib/storage";
import type { Settings } from "../lib/types";
import { compileList, fetchPackEntries, type CompiledLists } from "../lib/word-lists";

// Packs can hold a hundred thousand domains, so compile them once and keep the
// result until the stored lists change.
let cache: Promise<CompiledLists> | null = null;

watch((changed) => {
  if ("wordLists" in changed) cache = null;
});

export function compiledLists(): Promise<CompiledLists> {
  cache ??= get("wordLists").then(
    (stored) => new Map(Object.entries(stored).map(([id, list]) => [id, compileList(list.text)])),
  );
  return cache;
}

// Unsaved imports are kept for a day so an open editor never loses them.
const ORPHAN_GRACE_MS = 24 * 3_600_000;
const fetching = new Set<string>();

// Settings sync carries only list references. Fetch any website pack this
// device is missing, and drop stored lists no group uses any more.
export async function reconcileLists(settings: Settings): Promise<void> {
  const refs = settings.groups.flatMap((group) => group.lists);
  const used = new Set(refs.map((ref) => ref.id));
  const stored = await get("wordLists");
  const now = Date.now();
  const stale = Object.keys(stored).filter((id) => !used.has(id) && now - stored[id].createdAt > ORPHAN_GRACE_MS);
  if (stale.length > 0) {
    await update("wordLists", (lists) => Object.fromEntries(Object.entries(lists).filter(([id]) => !stale.includes(id))));
  }
  for (const ref of refs) {
    if (stored[ref.id] || !ref.source || fetching.has(ref.id)) continue;
    fetching.add(ref.id);
    try {
      const entries = await fetchPackEntries(ref.source);
      await update("wordLists", (lists) => ({ ...lists, [ref.id]: { text: entries.join("\n"), createdAt: Date.now() } }));
    } catch {
      // Offline or rate limited. The next settings change or restart retries.
    } finally {
      fetching.delete(ref.id);
    }
  }
}
