/**
 * In-process Postgres test harness (PGlite + drizzle).
 *
 * Spins up a real Postgres engine in WASM — no external server — and applies the
 * project's actual drizzle migrations, so DB-layer tests run against real SQL,
 * real constraints (the (venue,date,time,court) unique, FKs, identity PKs) and
 * real upsert/onConflict behaviour rather than hand-mocked query builders.
 *
 * Usage in a test file:
 *   vi.mock("../db", () => ({ db: dbProxy }));   // match the module-under-test's specifier
 *   beforeAll(initTestDb);
 *   beforeEach(truncateAll);
 *
 * `dbProxy` forwards every access to the current test db (rebuilt per file), so
 * the singleton the app imports always points at the live PGlite instance.
 */
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { sql } from "drizzle-orm";
import * as schema from "../lib/schema";

export type TestDb = ReturnType<typeof drizzle<typeof schema>>;

let current: TestDb | null = null;

/** Create a fresh in-memory Postgres and apply all migrations (0000→latest). */
export async function initTestDb(): Promise<TestDb> {
  const client = new PGlite();
  current = drizzle(client, { schema });
  await migrate(current, { migrationsFolder: "drizzle" });
  return current;
}

/** Wipe every table + reset identity sequences between tests (fast; keeps schema). */
export async function truncateAll(): Promise<void> {
  const db = testDb();
  await db.execute(sql`TRUNCATE TABLE
    slots, courts, venues, watches, users,
    notification_channels, notification_log, registration_requests,
    verification_tokens, feed_state
    RESTART IDENTITY CASCADE`);
}

export function testDb(): TestDb {
  if (!current) throw new Error("initTestDb() has not been called");
  return current;
}

/**
 * A stand-in for the app's `db` singleton that always forwards to the current
 * PGlite instance, binding methods so drizzle's builders keep their `this`.
 */
export const dbProxy = new Proxy({} as TestDb, {
  get(_target, prop) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const real = testDb() as any;
    const value = real[prop];
    return typeof value === "function" ? value.bind(real) : value;
  },
}) as TestDb;
