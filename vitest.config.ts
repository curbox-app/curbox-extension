import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      // Point WXT's virtual module at an in-memory browser so modules that
      // touch extension APIs can run under plain vitest.
      "#imports": fileURLToPath(new URL("./src/test/imports-shim.ts", import.meta.url)),
    },
  },
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
  },
});
