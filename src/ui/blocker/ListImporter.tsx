import { useEffect, useRef, useState } from "react";
import { update } from "../../lib/storage";
import { uid } from "../../lib/types";
import {
  MERGE_LIMIT,
  PACK_REPO,
  fetchPackEntries,
  fetchPacks,
  parseWordList,
  type WebsitePack,
  type WordListRef,
} from "../../lib/word-lists";
import { EditorSheet, btnOutline } from "../components";

const SECTIONS: WebsitePack["section"][] = ["Topics", "Mixed topics", "Ads and trackers"];

function sizeLabel(bytes: number): string {
  return bytes >= 1_000_000 ? `${(bytes / 1_000_000).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1000))} KB`;
}

function PackPicker({
  added,
  onPick,
  onClose,
}: {
  added: Set<string>;
  onPick: (pack: WebsitePack) => Promise<void>;
  onClose: () => void;
}) {
  const [packs, setPacks] = useState<WebsitePack[] | null>(null);
  const [error, setError] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);

  useEffect(() => {
    fetchPacks().then(setPacks, () => setError(true));
  }, []);

  const pick = async (pack: WebsitePack) => {
    setBusy(pack.url);
    try {
      await onPick(pack);
      onClose();
    } finally {
      setBusy(null);
    }
  };

  return (
    <EditorSheet title="Website packs" subtitle="Ready made lists from the Curbox community." onClose={onClose}>
      {error && <p className="text-sm text-muted">I can't reach GitHub right now. Check your connection and try again.</p>}
      {!error && !packs && <p className="text-sm text-muted">Asking GitHub for the packs…</p>}
      {packs && (
        <div className="flex flex-col gap-5">
          {SECTIONS.map((section) => (
            <div key={section} className="flex flex-col">
              <p className="label mb-1">{section}</p>
              {packs
                .filter((pack) => pack.section === section)
                .map((pack) => (
                  <div key={pack.url} className="flex items-center gap-3 border-b border-line/70 py-2.5">
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm text-ink">{pack.name}</span>
                      <span className="text-xs text-faint">{sizeLabel(pack.bytes)}</span>
                    </span>
                    <button
                      disabled={added.has(pack.url) || busy !== null}
                      onClick={() => void pick(pack)}
                      className="text-sm font-medium text-primary disabled:text-faint"
                    >
                      {added.has(pack.url) ? "Added" : busy === pack.url ? "Adding…" : "Add"}
                    </button>
                  </div>
                ))}
            </div>
          ))}
          <p className="text-xs text-faint">Source: {PACK_REPO}</p>
        </div>
      )}
    </EditorSheet>
  );
}

export function ListImporter({
  matchers,
  lists,
  onChange,
}: {
  matchers: string[];
  lists: WordListRef[];
  onChange: (next: { matchers: string[]; lists: WordListRef[] }) => void;
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [picking, setPicking] = useState(false);
  const [notice, setNotice] = useState("");

  // Small lists join the keywords above, like Android. Big ones stay whole.
  const store = async (name: string, entries: string[], source?: string) => {
    if (entries.length === 0) return setNotice("Nothing new to add.");
    if (!source && entries.length <= MERGE_LIMIT) {
      onChange({ matchers: [...matchers, ...entries], lists });
      return setNotice(`I added ${entries.length} keyword${entries.length === 1 ? "" : "s"}.`);
    }
    const id = uid();
    await update("wordLists", (stored) => ({ ...stored, [id]: { text: entries.join("\n"), createdAt: Date.now() } }));
    onChange({ matchers, lists: [...lists, { id, name, source, count: entries.length }] });
    setNotice(`I added ${name} with ${entries.length.toLocaleString()} sites.`);
  };

  const importFile = async (file: File) => {
    try {
      await store(file.name.replace(/\.[^.]+$/, ""), parseWordList(await file.text(), matchers));
    } catch {
      setNotice("I couldn't read that file.");
    }
  };

  const importPack = async (pack: WebsitePack) => {
    try {
      await store(pack.name, await fetchPackEntries(pack.url), pack.url);
    } catch {
      setNotice("I couldn't download that pack. Please try again.");
    }
  };

  return (
    <div className="flex flex-col gap-2">
      <p className="label">Word lists</p>
      {lists.map((ref) => (
        <div key={ref.id} className="flex items-center justify-between border-b border-line/70 py-2">
          <span className="min-w-0">
            <span className="block truncate text-sm">{ref.name}</span>
            <span className="text-xs text-faint">{ref.count.toLocaleString()} sites</span>
          </span>
          <button
            onClick={() => onChange({ matchers, lists: lists.filter((x) => x.id !== ref.id) })}
            className="text-xs text-faint transition-colors hover:text-ink"
          >
            ✕
          </button>
        </div>
      ))}
      <div className="flex flex-wrap gap-2">
        <button onClick={() => fileRef.current?.click()} className={btnOutline}>
          Import a file
        </button>
        <button onClick={() => setPicking(true)} className={btnOutline}>
          Website packs
        </button>
      </div>
      <input
        ref={fileRef}
        type="file"
        accept=".txt,text/plain"
        hidden
        onChange={(e) => {
          const file = e.target.files?.[0];
          e.target.value = "";
          if (file) void importFile(file);
        }}
      />
      {notice && <p className="text-xs text-muted">{notice}</p>}
      {picking && (
        <PackPicker
          added={new Set(lists.flatMap((ref) => (ref.source ? [ref.source] : [])))}
          onPick={importPack}
          onClose={() => setPicking(false)}
        />
      )}
    </div>
  );
}
