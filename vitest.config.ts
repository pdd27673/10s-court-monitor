import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // Coverage is scoped to the library core (ingestion clocks, notifiers,
    // differ, parsers) — the logic these tests actually exercise. Next.js route
    // handlers and one-off scripts are excluded so the number stays meaningful.
    coverage: {
      provider: "v8",
      reporter: ["text-summary", "text", "json-summary", "html"],
      reportsDirectory: "./coverage",
      include: ["src/lib/**/*.ts"],
      exclude: ["**/*.test.ts", "src/test/**", "**/*.d.ts"],
    },
  },
});
