import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // Coverage is scoped to the library core (ingestion clocks, notifiers,
    // differ, parsers) — the logic these tests actually exercise. Next.js route
    // handlers and one-off scripts are excluded so the number stays meaningful.
    coverage: {
      provider: "v8",
      reporter: ["text-summary", "text", "json-summary", "html", "lcov"],
      reportsDirectory: "./coverage",
      include: ["src/lib/**/*.ts"],
      exclude: [
        "**/*.test.ts",
        "src/test/**",
        "**/*.d.ts",
        // NextAuth wiring — declarative provider/adapter/callback config plus the
        // sign-in email template. It's framework glue exercised end-to-end by the
        // auth flow, not unit-testable logic, so it's excluded to keep the number
        // meaningful (the same rationale as excluding the Next.js route handlers).
        "src/lib/auth.ts",
      ],
    },
  },
});
