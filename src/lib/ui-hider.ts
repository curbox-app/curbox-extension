import { domainMatches } from "./url";

export interface HiderRule {
  id: string;
  site: string;
  hosts: string[];
  label: string;
  description: string;
  css: string;
  /** Runs twice a second while the rule is on, for what CSS alone cannot do. */
  run?: () => void;
}

// The content script mirrors the current path onto <html>, so rules can target
// one page on sites that navigate without reloading.
export const PATH_ATTR = "data-curbox-path";
const onPath = (path: string) => `html[${PATH_ATTR}="${path}"]`;

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
const X = ["x.com", "twitter.com"];

// X home tabs by position, so it works in every language: For you, Following,
// then any pinned lists.
const X_HOME_TABS = '[data-testid="primaryColumn"] [role="tablist"]';
const X_FOR_YOU = `${X_HOME_TABS} [role="presentation"]:first-child`;

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
        `${onPath("/")} ytm-browse ytm-rich-grid-renderer`,
        `${onPath("/")} ytm-browse ytm-feed-filter-chip-bar-renderer`,
        `${onPath("/")} ytm-browse ytm-section-list-renderer`,
      ]),
      note(
        ['ytd-browse[page-subtype="home"]::before', `${onPath("/")} ytm-browse::before`],
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
  {
    id: "x-for-you",
    site: "X",
    hosts: X,
    label: "For you tab",
    description: "Hide the For you feed and open Following instead.",
    css: [
      hide([`${onPath("/home")} ${X_FOR_YOU}`]),
      // Keep the feed out of sight until I have switched to Following.
      `${onPath("/home")} [data-testid="primaryColumn"]:has(${X_FOR_YOU} [role="tab"][aria-selected="true"]) section[role="region"] { visibility: hidden !important; }`,
    ].join("\n"),
    run: () => {
      if (location.pathname !== "/home") return;
      const tabs = document.querySelectorAll<HTMLElement>(`${X_HOME_TABS} [role="tab"]`);
      if (tabs.length > 1 && tabs[0].getAttribute("aria-selected") === "true") tabs[1].click();
    },
  },
];

export function rulesForSite(domain: string): HiderRule[] {
  return HIDER_RULES.filter((rule) => rule.hosts.some((host) => domainMatches(domain, host)));
}
