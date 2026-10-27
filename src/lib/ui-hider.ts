import { domainMatches } from "./url";

export interface HiderRule {
  id: string;
  site: string;
  hosts: string[];
  label: string;
  description: string;
  css: string;
}

// The content script marks the YouTube home page on <html>, because the mobile
// site has no home specific element to select on.
export const HOME_ATTR = "data-curbox-home";

const hide = (selectors: string[]) => `${selectors.join(",\n")} { display: none !important; }`;

const note = (selectors: string[], text: string) => `${selectors.join(",\n")} {
  display: block;
  content: "${text}";
  padding: 120px 24px;
  text-align: center;
  font: 400 16px/1.5 "Inter", "Roboto", system-ui, sans-serif;
  color: var(--yt-spec-text-secondary, #8a8a8a);
}`;

const YOUTUBE = ["youtube.com"];

export const HIDER_RULES: HiderRule[] = [
  {
    id: "youtube-home-feed",
    site: "YouTube",
    hosts: YOUTUBE,
    label: "Home feed",
    description: "Hide the endless grid on the home page. Search still works.",
    css: [
      hide([
        'ytd-browse[page-subtype="home"] ytd-rich-grid-renderer',
        `html[${HOME_ATTR}] ytm-browse ytm-rich-grid-renderer`,
        `html[${HOME_ATTR}] ytm-browse ytm-feed-filter-chip-bar-renderer`,
        `html[${HOME_ATTR}] ytm-browse ytm-section-list-renderer`,
      ]),
      note(
        ['ytd-browse[page-subtype="home"]::before', `html[${HOME_ATTR}] ytm-browse::before`],
        "I tucked your feed away. Search for what you came for.",
      ),
    ].join("\n"),
  },
  {
    id: "youtube-recommendations",
    site: "YouTube",
    hosts: YOUTUBE,
    label: "Video recommendations",
    description: "Hide suggested videos next to and after the one you watch.",
    css: hide([
      "ytd-watch-flexy #secondary #related",
      "ytd-watch-next-secondary-results-renderer",
      ".html5-endscreen",
      ".ytp-ce-element",
      ".ytp-autonav-endscreen-countdown-overlay",
      'ytm-item-section-renderer[section-identifier="related-items"]',
      "ytm-single-column-watch-next-results-renderer ytm-video-with-context-renderer",
    ]),
  },
  {
    id: "youtube-comments",
    site: "YouTube",
    hosts: YOUTUBE,
    label: "Comments",
    description: "Hide comments under videos and on Shorts.",
    css: hide([
      "ytd-comments#comments",
      "ytd-reel-video-renderer #comments-button",
      'ytd-engagement-panel-section-list-renderer[target-id="engagement-panel-comments-section"]',
      "ytm-comment-section-renderer",
      'ytm-item-section-renderer[section-identifier="comments-entry-point"]',
      "ytm-comments-entry-point-header-renderer",
    ]),
  },
  {
    id: "youtube-shorts",
    site: "YouTube",
    hosts: YOUTUBE,
    label: "Shorts",
    description: "Hide Shorts shelves and the Shorts tab.",
    css: hide([
      "ytd-reel-shelf-renderer",
      "ytd-rich-shelf-renderer[is-shorts]",
      'ytd-guide-entry-renderer:has(a[title="Shorts"])',
      'ytd-mini-guide-entry-renderer[aria-label="Shorts"]',
      "ytm-reel-shelf-renderer",
      "ytm-shorts-lockup-view-model",
      "ytm-pivot-bar-item-renderer:has(.pivot-shorts)",
    ]),
  },
  {
    id: "youtube-live-chat",
    site: "YouTube",
    hosts: YOUTUBE,
    label: "Live chat",
    description: "Hide the fast moving chat beside live streams.",
    css: hide(["ytd-live-chat-frame#chat", "ytm-live-chat-renderer"]),
  },
  {
    id: "youtube-notification-count",
    site: "YouTube",
    hosts: YOUTUBE,
    label: "Notification count",
    description: "Hide the red number on the bell.",
    css: hide([
      "ytd-notification-topbar-button-renderer .yt-spec-icon-badge-shape__badge",
      "ytd-notification-topbar-button-renderer #notification-count",
      "ytm-notification-topbar-button-renderer .notification-count",
    ]),
  },
];

export function rulesForSite(domain: string): HiderRule[] {
  return HIDER_RULES.filter((rule) => rule.hosts.some((host) => domainMatches(domain, host)));
}
