/**
 * Ingestion worker — the Phase-5 second Railway service.
 *
 * A single long-running Node process that drives `runFeedIngest` on a fixed timer,
 * replacing the external cron that POSTed `/api/cron/scrape`. Run it with
 * `npm run worker` (start command of the worker Railway service). MUST run as a
 * SINGLE instance: a second instance would double-poll and could double-notify
 * (per-channel dedup in `notification_log` softens that, but don't rely on it).
 *
 * The web/API service keeps serving the dashboard + REST API and no longer needs
 * the cron; the HTTP route stays only as a manual/fallback trigger.
 *
 * Runs under `tsx` (see package.json), so it and `./run` use relative imports and
 * stay Next-runtime-free.
 */
import "dotenv/config";
import { runFeedIngest } from "./run";

// Tick cadence = the OpenActive head-poll interval (Clock 1 runs every tick; the
// heavier clocks self-throttle via feed_state). Default 30s per the design's
// freshness-vs-politeness target.
const TICK_SECONDS = Math.max(5, parseInt(process.env.WORKER_TICK_SECONDS || "30", 10));

let ticking = false; // in-process single-flight guard
let stopping = false;

/** One guarded tick. Skips if the previous tick is still in flight (a long sweep
 * must not stack). `runFeedIngest` swallows its own errors; the try/catch is a
 * belt-and-braces guard so the loop can never die on a surprise throw. */
async function tick(): Promise<void> {
  if (ticking) {
    console.log("worker: previous tick still running — skipping this interval");
    return;
  }
  ticking = true;
  const startedAt = Date.now();
  try {
    await runFeedIngest();
  } catch (error) {
    console.error("worker: tick failed (loop continues):", error);
  } finally {
    ticking = false;
    console.log(`worker: tick finished in ${((Date.now() - startedAt) / 1000).toFixed(1)}s`);
  }
}

async function main(): Promise<void> {
  console.log(`worker: starting — tick every ${TICK_SECONDS}s`);

  const timerRef: { current?: NodeJS.Timeout } = {};

  // Graceful shutdown: stop scheduling, let any in-flight tick drain, then exit.
  // Railway sends SIGTERM on redeploy/stop. Registered BEFORE the first tick so a
  // SIGTERM during the initial (possibly multi-minute) backfill still drains
  // gracefully instead of hard-killing the process.
  const shutdown = (signal: string): void => {
    if (stopping) return;
    stopping = true;
    console.log(`worker: ${signal} received — draining in-flight tick then exiting`);
    if (timerRef.current) clearInterval(timerRef.current);
    const drain = setInterval(() => {
      if (!ticking) {
        clearInterval(drain);
        console.log("worker: drained, goodbye");
        process.exit(0);
      }
    }, 200);
    // Hard cap so a wedged tick can't block the shutdown forever.
    setTimeout(() => {
      console.warn("worker: drain timed out — forcing exit");
      process.exit(0);
    }, 30_000).unref();
  };
  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("SIGINT", () => shutdown("SIGINT"));

  // Run once immediately so a deploy starts ingesting without waiting a full interval.
  await tick();
  if (stopping) return; // a shutdown signal arrived during the first tick

  timerRef.current = setInterval(() => {
    if (!stopping) void tick();
  }, TICK_SECONDS * 1000);
}

main().catch((error) => {
  console.error("worker: fatal on startup:", error);
  process.exit(1);
});
