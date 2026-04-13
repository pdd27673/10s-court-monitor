import { drizzle } from "drizzle-orm/better-sqlite3";
import Database from "better-sqlite3";
import * as schema from "./schema";

// During Next.js build, multiple workers evaluate modules simultaneously.
// Using the real DB file causes SQLITE_BUSY. Use in-memory DB instead —
// no route handlers actually run during build, so no real data is needed.
const isBuildPhase = process.env.NEXT_PHASE === "phase-production-build";
const sqlite = new Database(isBuildPhase ? ":memory:" : "data/tennis.db");
sqlite.pragma("journal_mode = WAL"); // Better concurrent read performance
sqlite.pragma("foreign_keys = ON"); // Enforce foreign key constraints

export const db = drizzle(sqlite, { schema });
