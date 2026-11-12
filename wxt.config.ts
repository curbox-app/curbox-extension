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
      "**/*.zip",
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
    // data_collection_permissions is read from Firefox 140 and Firefox for
    // Android 142, the floor here. Curbox collects no data, so there is
    // nothing to declare.
    ...(browser === "firefox" && {
      browser_specific_settings: {
        gecko: {
          id: "curbox@curbox.app",
          strict_min_version: "140.0",
          data_collection_permissions: { required: ["none"] },
        },
        gecko_android: {
          strict_min_version: "142.0",
        },
      },
    }),
  }),
});
