import type { SiteLocation } from "./url";

// Mirrors Android KeywordMatcher exactly:
//   youtube.com            whole site
//   youtube.com/shorts     one section
//   /shorts                a path on any site
//   *.youtube.com          root plus one subdomain level
//   youtube                a complete word in the domain
//   r:shorts|reels         raw regex against domain, path, query and fragment
export function matchKeyword(loc: SiteLocation, rawPattern: string): boolean {
  const pattern = rawPattern.trim();
  if (!pattern) return false;
  const full = normalize(`${loc.domain}${loc.path}`);

  if (pattern.toLowerCase().startsWith("r:")) return compiled(pattern, () => new RegExp(pattern.slice(2), "i"))?.test(full) ?? false;

  const keyword = normalize(pattern);
  if (keyword.includes("*") || keyword.includes("?")) return compiled(keyword, () => wildcardToRegex(keyword))!.test(full);

  if (keyword.startsWith("/")) {
    const pathStart = full.indexOf("/");
    if (pathStart < 0) return false;
    const path = full.slice(pathStart);
    return (
      path === keyword ||
      path.startsWith(`${keyword}/`) ||
      path.startsWith(`${keyword}?`) ||
      path.startsWith(`${keyword}#`)
    );
  }

  if (
    full === keyword ||
    full.startsWith(`${keyword}/`) ||
    full.startsWith(`${keyword}?`) ||
    full.startsWith(`${keyword}#`)
  ) {
    return true;
  }

  if (!keyword.includes(".") && !keyword.includes("/")) {
    const domain = full.split(/[/?#]/, 1)[0];
    return domain.split(".").includes(keyword);
  }
  return false;
}

export function groupMatches(loc: SiteLocation, matchers: string[]): boolean {
  return matchers.some((matcher) => matchKeyword(loc, matcher));
}

// Matchers run per path, per group, on every evaluation, so build each
// expression once. null remembers a pattern that is not a valid expression.
const regexCache = new Map<string, RegExp | null>();

function compiled(key: string, build: () => RegExp): RegExp | null {
  let regex = regexCache.get(key);
  if (regex !== undefined) return regex;
  try {
    regex = build();
  } catch {
    regex = null;
  }
  if (regexCache.size >= 1000) regexCache.clear();
  regexCache.set(key, regex);
  return regex;
}

function wildcardToRegex(pattern: string): RegExp {
  const optionalSubdomain = pattern.startsWith("*.");
  const glob = optionalSubdomain ? pattern.slice(2) : pattern;
  const escaped = glob
    .replace(/[.+^${}()|[\]\\]/g, "\\$&")
    .replace(/\*/g, ".*")
    .replace(/\?/g, ".");
  const prefix = optionalSubdomain
    ? "^(?:[^/]+\\.)?"
    : pattern.startsWith("/")
      ? "^[^/]+"
      : pattern.split("/", 1)[0].includes(".")
        ? "^"
        : "";
  const suffix = optionalSubdomain && !pattern.includes("/") ? "(?=$|[/?#])" : "";
  return new RegExp(`${prefix}${escaped}${suffix}`, "i");
}

function normalize(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, "")
    .replace(/^www\./, "")
    .replace(/\/$/, "");
}
