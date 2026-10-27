const SITE_NAMES: Record<string, string> = {
  "instagram.com": "Instagram",
  "discord.com": "Discord",
  "youtube.com": "YouTube",
  "reddit.com": "Reddit",
  "x.com": "X",
  "twitter.com": "Twitter",
  "tiktok.com": "TikTok",
  "facebook.com": "Facebook",
  "netflix.com": "Netflix",
  "spotify.com": "Spotify",
  "github.com": "GitHub",
};

function bareHost(domain: string): string {
  return domain.replace(/^www\./, "").toLowerCase();
}

export function siteName(domain: string): string {
  const host = bareHost(domain);
  return SITE_NAMES[host] ?? host;
}

export function siteCategory(domain: string): string {
  const host = bareHost(domain);
  if (/instagram|facebook|twitter|^x\.com|tiktok|snapchat|reddit|discord|threads|linkedin|pinterest|tumblr|whatsapp/.test(host)) {
    return "Social networking";
  }
  if (/youtube|netflix|twitch|vimeo|hulu|disney|primevideo/.test(host)) return "Video";
  if (/spotify|soundcloud|music\.|pandora/.test(host)) return "Music";
  if (/mail\.|gmail|outlook|proton/.test(host)) return "Communication";
  if (/github|gitlab|stackoverflow|notion|figma|docs\.google/.test(host)) return "Productivity";
  if (/amazon|ebay|etsy/.test(host)) return "Shopping";
  if (/news|nytimes|bbc\.|cnn\.|theguardian/.test(host)) return "News";
  return "Website";
}
