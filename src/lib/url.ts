export interface SiteLocation {
  domain: string;
  path: string;
}

const SKIP_PROTOCOLS = ["chrome:", "chrome-extension:", "about:", "moz-extension:", "edge:", "file:", "view-source:"];

// Query params that identify distinct content, so usage lands on the video
// being watched instead of one flat "/watch" bucket (mirroring the Android
// tracker's per video granularity).
const CONTENT_PARAMS: Array<[site: string, param: string]> = [["youtube.com", "v"]];

export function parseLocation(rawUrl: string): SiteLocation | null {
  try {
    const url = new URL(rawUrl);
    if (SKIP_PROTOCOLS.includes(url.protocol)) return null;
    // The trailing dot form of a hostname ("youtube.com.") is the same site
    // and must not split its stats into a second domain.
    const domain = url.hostname.replace(/^www\./, "").replace(/\.$/, "");
    if (!domain) return null;
    return { domain, path: `${url.pathname || "/"}${contentQuery(domain, url)}` };
  } catch {
    return null;
  }
}

function contentQuery(domain: string, url: URL): string {
  for (const [site, param] of CONTENT_PARAMS) {
    if (!domainMatches(domain, site)) continue;
    const value = url.searchParams.get(param);
    if (value) return `?${param}=${value}`;
  }
  return "";
}

export function domainMatches(target: string, rule: string): boolean {
  const t = target.toLowerCase();
  const r = rule.toLowerCase().replace(/^www\./, "");
  return t === r || t.endsWith(`.${r}`);
}
