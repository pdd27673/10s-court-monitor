import { describe, it, expect } from "vitest";
import {
  createBlockLogger,
  safeLabel,
  OVERFLOW_KEY,
  LABEL_MAX_LENGTH,
} from "./block-log";

/** Drive the logger with a controllable clock and capture what it emits. */
function harness(opts: { windowMs?: number; maxKeys?: number } = {}) {
  const lines: string[] = [];
  let clock = 1_000_000;
  const logger = createBlockLogger({
    windowMs: opts.windowMs ?? 10 * 60_000,
    maxKeys: opts.maxKeys,
    log: (m) => lines.push(m),
    now: () => clock,
  });
  return {
    logger,
    lines,
    advance: (ms: number) => {
      clock += ms;
    },
  };
}

describe("safeLabel", () => {
  it("strips control characters that could forge log lines", () => {
    const injected = "/.env\n🚫 Blocked 0 suspicious request(s)";
    expect(safeLabel(injected)).not.toContain("\n");
    expect(safeLabel(injected)).toBe("/.env🚫 Blocked 0 suspicious request(s)");
  });

  it("strips NUL, carriage return and DEL", () => {
    expect(safeLabel("/a\u0000b\rc\u007fd")).toBe("/abcd");
  });

  it("truncates long labels", () => {
    const long = "/" + "a".repeat(500);
    expect(safeLabel(long)).toHaveLength(LABEL_MAX_LENGTH);
  });

  it("leaves an ordinary path untouched", () => {
    expect(safeLabel("/wp-admin/setup.php")).toBe("/wp-admin/setup.php");
  });
});

describe("createBlockLogger – windowing", () => {
  it("stays silent while the window is still open", () => {
    const { logger, lines, advance } = harness();

    for (let i = 0; i < 500; i++) logger.record("/.env");
    advance(9 * 60_000);
    logger.record("/.env");

    expect(lines).toHaveLength(0);
  });

  it("emits one summary once the window has elapsed", () => {
    const { logger, lines, advance } = harness();

    logger.record("/.env");
    logger.record("/.env");
    logger.record("/wp-admin");
    advance(10 * 60_000);
    logger.record("/.env");

    expect(lines).toHaveLength(1);
    // 3 before the advance + the one that triggered the flush.
    expect(lines[0]).toContain("Blocked 4 suspicious request(s)");
    expect(lines[0]).toContain("10m");
  });

  it("ranks the top offenders by count", () => {
    const { logger, lines, advance } = harness();

    for (let i = 0; i < 5; i++) logger.record("/.env");
    for (let i = 0; i < 3; i++) logger.record("/wp-admin");
    logger.record("/.git");
    advance(10 * 60_000);
    logger.record("/xmlrpc.php");

    expect(lines[0]).toContain("/.env×5");
    expect(lines[0]).toContain("/wp-admin×3");
    expect(lines[0].indexOf("/.env×5")).toBeLessThan(lines[0].indexOf("/wp-admin×3"));
  });

  it("resets counts after a flush so windows do not accumulate", () => {
    const { logger, lines, advance } = harness();

    for (let i = 0; i < 10; i++) logger.record("/.env");
    advance(10 * 60_000);
    logger.record("/.env"); // flushes 11

    logger.record("/.env");
    advance(10 * 60_000);
    logger.record("/.env"); // flushes 2, not 13

    expect(lines).toHaveLength(2);
    expect(lines[0]).toContain("Blocked 11 ");
    expect(lines[1]).toContain("Blocked 2 ");
  });
});

describe("createBlockLogger – bounded memory", () => {
  it("buckets new keys past the cap into an overflow key", () => {
    const { logger } = harness({ maxKeys: 5 });

    for (let i = 0; i < 100; i++) logger.record(`/scan-${i}`);

    // 5 distinct keys + the overflow bucket.
    expect(logger.size()).toBe(6);
  });

  it("keeps counting keys it already tracks after the cap is reached", () => {
    const { logger, lines, advance } = harness({ maxKeys: 2 });

    logger.record("/.env");
    logger.record("/wp-admin");
    for (let i = 0; i < 10; i++) logger.record("/.env"); // known key, still counted
    logger.record("/novel-path"); // new key past the cap → overflow

    advance(10 * 60_000);
    logger.record("/.env");

    expect(lines[0]).toContain("/.env×12");
    expect(lines[0]).toContain(`${OVERFLOW_KEY}×1`);
  });

  it("counts every request in the total even when keys overflow", () => {
    const { logger, lines, advance } = harness({ maxKeys: 3 });

    for (let i = 0; i < 250; i++) logger.record(`/scan-${i}`);
    advance(10 * 60_000);
    logger.record("/final");

    expect(lines[0]).toContain("Blocked 251 suspicious request(s)");
  });

  it("does not let distinct control-char variants evade the cap", () => {
    // Sanitising before keying means these all collapse to one key.
    const { logger } = harness({ maxKeys: 10 });

    for (let i = 0; i < 50; i++) logger.record(`/.env\u0000${"\r".repeat(i)}`);

    expect(logger.size()).toBe(1);
  });
});
