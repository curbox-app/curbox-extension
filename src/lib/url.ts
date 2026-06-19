export interface SiteLocation {
  domain: string;
  path: string;
}

const SKIP_PROTOCOLS = ["chrome:", "chrome-extension:", "about:", "moz-extension:", "edge:", "file:", "view-source:"];

export function parseLocation(rawUrl: string): SiteLocation | null {
  try {
    const url = new URL(rawUrl);
    if (SKIP_PROTOCOLS.includes(url.protocol)) return null;
    const domain = url.hostname.replace(/^www\./, "");
    if (!domain) return null;
    return { domain, path: url.pathname || "/" };
  } catch {
    return null;
  }
}

export function domainMatches(target: string, rule: string): boolean {
  const t = target.toLowerCase();
  const r = rule.toLowerCase().replace(/^www\./, "");
  return t === r || t.endsWith(`.${r}`);
}
