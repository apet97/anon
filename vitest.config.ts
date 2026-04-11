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
      // Thresholds sit ~2–3pt below the 2026-04-12 measured baseline
      // (stmts 88.7, branches 78.7, funcs 92.5, lines 89.1).
      // Channel + thread error paths are the main uncovered branches.
      thresholds: {
        lines: 86,
        branches: 76,
        functions: 90,
        statements: 86,
      },
    },
    // We deliberately avoid setupFiles that read process.env — each test
    // that needs env vars should set them explicitly to keep isolation clear.
  },
});
