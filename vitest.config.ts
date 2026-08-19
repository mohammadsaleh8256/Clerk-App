import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  test: {
    environment: "node",
    include: ["scripts/**/*.test.ts"],
    globals: false,
    testTimeout: 15000,
    hookTimeout: 30000,
  },
  resolve: {
    alias: {
      "@shared": path.resolve(__dirname, "src/shared"),
      "@server": path.resolve(__dirname, "src/server"),
    },
  },
});
