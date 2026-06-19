import type { SiteLocation } from "./url";
import { domainMatches } from "./url";

// Mirrors the Android keyword syntax (see keyword-blocker docs):
//   youtube.com            whole site
//   youtube.com/shorts     one section
//   /shorts                a path on any site
//   *.youtube.com          subdomain wildcard
//   youtube                a word in the domain
//   r:shorts|reels         raw regex against the url
export function matchKeyword(loc: SiteLocation, rawPattern: string): boolean {
  const pattern = rawPattern.trim();
  if (!pattern) return false;

  const domain = loc.domain.toLowerCase();
  const path = loc.path.toLowerCase() || "/";
  const full = `${domain}${path}`;

  if (pattern.startsWith("r:")) {
    try {
      return new RegExp(pattern.slice(2), "i").test(full);
    } catch {
      return false;
    }
  }

  const p = pattern
    .toLowerCase()
    .replace(/^https?:\/\//, "")
    .replace(/^www\./, "");

  if (p.includes("*") || p.includes("?")) {
    const re = wildcardToRegex(p);
    return re.test(domain) || re.test(full);
  }

  if (p.startsWith("/")) {
    return path.startsWith(p);
  }

  if (p.includes("/")) {
    const slash = p.indexOf("/");
    const d = p.slice(0, slash);
    const sub = p.slice(slash);
    return domainMatches(domain, d) && path.startsWith(sub);
  }

  if (p.includes(".")) {
    return domainMatches(domain, p);
  }

  return domain.split(".").includes(p);
}

export function groupMatches(loc: SiteLocation, matchers: string[]): boolean {
  return matchers.some((m) => matchKeyword(loc, m));
}

function wildcardToRegex(glob: string): RegExp {
  const escaped = glob.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*").replace(/\?/g, ".");
  return new RegExp(`^${escaped}$`, "i");
}
