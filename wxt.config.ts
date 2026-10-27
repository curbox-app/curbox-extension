import { defineConfig } from "wxt";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  modules: ["@wxt-dev/module-react"],
  srcDir: "src",
  vite: () => ({
    plugins: [tailwindcss()],
  }),
  // The sources zip goes to Mozilla for review, so it carries only what is
  // needed to rebuild the add-on, never local notes or reference material.
  zip: {
    excludeSources: [
      "CLAUDE.md",
      ".claude/**",
      ".mcp.json",
      "graphify-out/**",
      "android_docs/**",
      "layout/**",
      "docs/**",
      "stats.html",
      ".env*",
    ],
  },
  manifest: ({ browser }) => ({
    name: "Curbox",
    description: "A calm companion that helps you stay conscious of your time online.",
    homepage_url: "https://curbox.app",
    action: {
      default_title: "Curbox",
    },
    // favicon is a Chromium API; Firefox rejects it as an unknown permission.
    permissions: ["storage", "unlimitedStorage", "tabs", "alarms", "idle", "scripting", ...(browser === "firefox" ? [] : ["favicon"])],
    host_permissions: ["<all_urls>"],
    web_accessible_resources: [
      {
        resources: ["fonts/*"],
        matches: ["<all_urls>"],
      },
    ],
    // Tailwind v4's CSS needs Firefox 128. Curbox collects no data, and sync
    // is not connected in this build, so there is nothing to declare.
    ...(browser === "firefox" && {
      browser_specific_settings: {
        gecko: {
          id: "curbox@curbox.app",
          strict_min_version: "128.0",
          data_collection_permissions: { required: ["none"] },
        },
        gecko_android: {
          strict_min_version: "128.0",
        },
      },
    }),
  }),
});
