import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
    coverage: {
      provider: "v8",
      reporter: ["text", "lcov"],
      include: ["src/**/*.ts"],
      exclude: ["src/main.ts", "**/*.d.ts"],
    },
    // We deliberately avoid setupFiles that read process.env — each test
    // that needs env vars should set them explicitly to keep isolation clear.
  },
});
