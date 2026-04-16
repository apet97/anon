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
      // L-6: thresholds raised after the C-1/C-2/H-5 fixes landed.
      // 2026-04-16 measured baseline: stmts 92.41, branches 81.08,
      // functions 93.75, lines 92.96. Targets land just under the
      // measured floor so small future fluctuations don't trip CI.
      thresholds: {
        lines: 90,
        branches: 80,
        functions: 92,
        statements: 90,
      },
    },
    // We deliberately avoid setupFiles that read process.env — each test
    // that needs env vars should set them explicitly to keep isolation clear.
  },
});
