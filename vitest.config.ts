import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // The `.db.test.ts` suites boot a real Postgres in WASM (PGlite) and apply
    // every migration in `beforeAll`. That alone runs ~10s on a warm machine —
    // right at vitest's default hookTimeout — so under parallel load the hook
    // was timing out rather than failing on anything real. Give DB setup room.
    hookTimeout: 60_000,
    testTimeout: 30_000,
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
      // Enforced so the number can't quietly rot. Set just under the current
      // measurement (90.7 stmts / 93.3 lines / 82.0 branches / 88.0 funcs) —
      // close enough to catch a real regression, with enough slack that an
      // ordinary refactor doesn't fail CI on rounding.
      thresholds: {
        statements: 90,
        lines: 90,
        branches: 80,
        functions: 87,
      },
    },
  },
});
