import { defineConfig } from "wxt";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  modules: ["@wxt-dev/module-react"],
  srcDir: "src",
  vite: () => ({
    plugins: [tailwindcss()],
  }),
  manifest: {
    name: "Curbox",
    description: "A calm companion that helps you stay conscious of your time online.",
    homepage_url: "https://curbox.app/privacy",
    permissions: ["storage", "tabs", "alarms", "idle", "favicon", "scripting"],
    host_permissions: ["<all_urls>"],
    web_accessible_resources: [
      {
        resources: ["fonts/*"],
        matches: ["<all_urls>"],
      },
    ],
  },
});
