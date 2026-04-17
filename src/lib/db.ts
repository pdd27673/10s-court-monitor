import { drizzle } from "drizzle-orm/better-sqlite3";
import Database from "better-sqlite3";
import path from "path";
import * as schema from "./schema";

// During Next.js build, multiple workers evaluate modules simultaneously.
// Using the real DB file causes SQLITE_BUSY. Use in-memory DB instead —
// no route handlers actually run during build, so no real data is needed.
const isBuildPhase = process.env.NEXT_PHASE === "phase-production-build";

// Use DATABASE_PATH env var if set, otherwise resolve relative to project root.
// path.resolve() anchors to process.cwd() which is /app in production —
// the same directory drizzle-kit migrate runs from, so they always use the same file.
const DB_PATH = process.env.DATABASE_PATH ?? path.resolve("data/tennis.db");

if (!isBuildPhase) {
  console.log(`[db] opening database at ${DB_PATH}`);
}

const sqlite = new Database(isBuildPhase ? ":memory:" : DB_PATH);
sqlite.pragma("journal_mode = WAL"); // Better concurrent read performance
sqlite.pragma("foreign_keys = ON"); // Enforce foreign key constraints

export const db = drizzle(sqlite, { schema });
