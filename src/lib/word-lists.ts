import { groupMatches } from "./match";
import type { SiteLocation } from "./url";

/** What a group keeps about an imported list. The entries live in storage. */
export interface WordListRef {
  id: string;
  name: string;
  /** Where a website pack came from, so another device can fetch it again. */
  source?: string;
  count: number;
}

export interface StoredList {
  text: string; // one entry per line
  createdAt: number;
}

export interface CompiledList {
  domains: Set<string>;
  patterns: string[];
}

export type CompiledLists = Map<string, CompiledList>;

// Android merges every imported line into the group. Past this size I keep the
// lines as their own list so matching and syncing stay fast.
export const MERGE_LIMIT = 200;

const IP = /^(?:\d{1,3}\.){3}\d{1,3}$|^[0-9a-f:]+$/i;
const LOCAL = /^(?:localhost(?:\.localdomain)?|local|broadcasthost|ip6-\w+)$/i;
const PLAIN_DOMAIN = /^(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/;

// Reads plain word lists like Android does (one entry per line), and also hosts
// files, which put an address before each domain.
export function parseWordList(text: string, existing: Iterable<string> = []): string[] {
  const seen = new Set(existing);
  const out: string[] = [];
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const fields = line.replace(/\s+#.*$/, "").split(/\s+/);
    const entry = fields.length > 1 && IP.test(fields[0]) ? fields[1] : line;
    if (!entry || LOCAL.test(entry) || IP.test(entry) || seen.has(entry)) continue;
    seen.add(entry);
    out.push(entry);
  }
  return out;
}

export function compileList(text: string): CompiledList {
  const domains = new Set<string>();
  const patterns: string[] = [];
  for (const entry of text.split("\n")) {
    if (!entry) continue;
    const clean = entry.toLowerCase().replace(/^www\./, "");
    if (PLAIN_DOMAIN.test(clean)) domains.add(clean);
    else patterns.push(entry);
  }
  return { domains, patterns };
}

// A listed domain also covers its subdomains, since packs name the main site.
function listMatches(loc: SiteLocation, list: CompiledList): boolean {
  const labels = loc.domain.toLowerCase().split(".");
  for (let i = 0; i < labels.length - 1; i++) {
    if (list.domains.has(labels.slice(i).join("."))) return true;
  }
  return list.patterns.length > 0 && groupMatches(loc, list.patterns);
}

export function targetMatches(
  loc: SiteLocation,
  target: { matchers: string[]; lists?: WordListRef[] },
  lists: CompiledLists | undefined,
): boolean {
  if (groupMatches(loc, target.matchers)) return true;
  return !!lists && !!target.lists?.some((ref) => {
    const list = lists.get(ref.id);
    return !!list && listMatches(loc, list);
  });
}

export const PACK_REPO = "https://github.com/curbox-app/website_packs";
const PACK_TREE = "https://api.github.com/repos/curbox-app/website_packs/git/trees/master?recursive=1";
const PACK_RAW = "https://raw.githubusercontent.com/curbox-app/website_packs/master/";

export interface WebsitePack {
  name: string;
  section: "Topics" | "Mixed topics" | "Ads and trackers";
  url: string;
  bytes: number;
}

// websites/alternates/social-only  -> "Social" (topic)
// websites/alternates/gambling-social -> "Gambling + social + ads" (mixed)
// websites/extensions/porn/tiuxo     -> "Porn · tiuxo" (topic, one source)
// websites/data/adaway.org          -> "adaway.org" (ads and trackers)
export function packFromPath(path: string, bytes: number): WebsitePack | null {
  const match = /^websites\/(?:(extensions|alternates|data)\/(.+)\/)?websites\.txt$/.exec(path);
  if (!match) return null;
  const [, kind, rest] = match;
  const url = PACK_RAW + path;
  if (!kind) return { name: "All ads and trackers", section: "Ads and trackers", url, bytes };
  if (kind === "data") return { name: rest, section: "Ads and trackers", url, bytes };
  const topic = (word: string) => (word === "fakenews" ? "fake news" : word);
  if (kind === "extensions") {
    // A topic without a named source repeats its "only" pack.
    const [category, ...source] = rest.split("/");
    if (source.length === 0) return null;
    return { name: capitalize([topic(category), ...source].join(" · ")), section: "Topics", url, bytes };
  }
  const only = rest.endsWith("-only");
  const topics = rest.replace(/-only$/, "").split("-").map(topic);
  const name = capitalize(topics.join(" + ") + (only ? "" : " + ads"));
  return { name, section: only && topics.length === 1 ? "Topics" : "Mixed topics", url, bytes };
}

export async function fetchPacks(): Promise<WebsitePack[]> {
  const res = await fetch(PACK_TREE);
  if (!res.ok) throw new Error(`GitHub ${res.status}`);
  const body = (await res.json()) as { tree: { path: string; size?: number }[] };
  return body.tree
    .map((item) => packFromPath(item.path, item.size ?? 0))
    .filter((pack): pack is WebsitePack => pack !== null)
    .sort((a, b) => a.name.localeCompare(b.name));
}

export async function fetchPackEntries(url: string): Promise<string[]> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`GitHub ${res.status}`);
  return parseWordList(await res.text());
}

function capitalize(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}
