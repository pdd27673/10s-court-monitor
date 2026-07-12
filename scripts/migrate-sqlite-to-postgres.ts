#!/usr/bin/env tsx
/**
 * One-off data migration: SQLite -> Postgres (Phase 0).
 *
 * Copies the durable user-owned tables from the old better-sqlite3 database into
 * the new Railway Postgres. Ephemeral tables (slots, scrape_targets,
 * notification_log) are intentionally skipped — they are rebuilt from the
 * scrapers/feeds on the next ingest cycle.
 *
 * Preserves primary keys so foreign-key references stay intact, then resets each
 * identity sequence to MAX(id)+1 so future inserts don't collide.
 *
 * Prereqs:
 *   1. Postgres schema already created (npm run db:migrate against DATABASE_URL).
 *   2. DATABASE_URL points at the target Postgres.
 *   3. The source SQLite file is present (default: data/tennis.db).
 *
 * Usage:
 *   DATABASE_URL=postgres://... tsx scripts/migrate-sqlite-to-postgres.ts [path/to/tennis.db]
 *   --dry-run    read + report counts without writing.
 *   --truncate   TRUNCATE the target tables (RESTART IDENTITY CASCADE) before
 *                inserting — use for a clean re-seed from a fresh source.
 */

import Database from "better-sqlite3";
import { Pool } from "pg";
import path from "path";
import "dotenv/config";

const SQLITE_PATH =
  process.argv.find((a) => a.endsWith(".db")) ??
  path.join(process.cwd(), "data", "tennis.db");
const DRY_RUN = process.argv.includes("--dry-run");
const TRUNCATE = process.argv.includes("--truncate");

// Durable tables to copy, in FK-dependency order (parents before children).
// Each entry: sqlite table name + the columns to carry over (snake_case, shared
// by both schemas). `idColumn` drives the sequence reset; null = no identity.
const TABLES: { name: string; columns: string[]; idColumn: string | null }[] = [
  {
    name: "users",
    columns: [
      "id",
      "email",
      "name",
      "email_verified",
      "image",
      "is_allowed",
      "is_admin",
      "created_at",
    ],
    idColumn: "id",
  },
  {
    name: "venues",
    columns: ["id", "slug", "name"],
    idColumn: "id",
  },
  {
    name: "watches",
    columns: [
      "id",
      "user_id",
      "venue_id",
      "day_times",
      "weekday_times",
      "weekend_times",
      "active",
    ],
    idColumn: "id",
  },
  {
    name: "notification_channels",
    columns: ["id", "user_id", "type", "destination", "active"],
    idColumn: "id",
  },
  {
    name: "registration_requests",
    columns: [
      "id",
      "email",
      "name",
      "reason",
      "status",
      "created_at",
      "reviewed_at",
      "reviewed_by",
    ],
    idColumn: "id",
  },
  {
    name: "verification_tokens",
    columns: ["identifier", "token", "expires"],
    idColumn: null,
  },
];

async function main() {
  if (!process.env.DATABASE_URL) {
    throw new Error("DATABASE_URL is not set — point it at the target Postgres.");
  }

  console.log("=".repeat(60));
  console.log("SQLITE -> POSTGRES DATA MIGRATION" + (DRY_RUN ? " (dry run)" : ""));
  console.log("=".repeat(60));
  console.log(`Source SQLite: ${SQLITE_PATH}`);
  console.log(`Target Postgres: ${process.env.DATABASE_URL.replace(/:[^:@/]+@/, ":***@")}\n`);

  const sqlite = new Database(SQLITE_PATH, { readonly: true });
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: /\bsslmode=require\b/.test(process.env.DATABASE_URL)
      ? { rejectUnauthorized: false }
      : undefined,
  });
  const pg = await pool.connect();

  try {
    if (TRUNCATE && !DRY_RUN) {
      // Reset every durable + ephemeral table so the re-seed is clean. CASCADE
      // covers FK children; RESTART IDENTITY rewinds the sequences.
      const allTables = [
        "notification_log",
        "notification_channels",
        "watches",
        "slots",
        "scrape_targets",
        "registration_requests",
        "verification_tokens",
        "venues",
        "users",
      ];
      await pg.query(
        `TRUNCATE TABLE ${allTables.map((t) => `"${t}"`).join(", ")} RESTART IDENTITY CASCADE`
      );
      console.log(`⚠️  Truncated ${allTables.length} tables (RESTART IDENTITY CASCADE)\n`);
    } else if (TRUNCATE && DRY_RUN) {
      console.log("(dry run: would TRUNCATE all tables before insert)\n");
    }

    for (const table of TABLES) {
      const rows = sqlite
        .prepare(`SELECT ${table.columns.join(", ")} FROM ${table.name}`)
        .all() as Record<string, unknown>[];

      if (rows.length === 0) {
        console.log(`• ${table.name}: 0 rows, skipping`);
        continue;
      }

      if (DRY_RUN) {
        console.log(`• ${table.name}: ${rows.length} rows (would insert)`);
        continue;
      }

      const colList = table.columns.map((c) => `"${c}"`).join(", ");
      let inserted = 0;
      for (const row of rows) {
        const values = table.columns.map((c) => row[c]);
        const placeholders = table.columns.map((_, i) => `$${i + 1}`).join(", ");
        const res = await pg.query(
          `INSERT INTO "${table.name}" (${colList}) VALUES (${placeholders})
           ON CONFLICT DO NOTHING`,
          values
        );
        inserted += res.rowCount ?? 0;
      }
      console.log(
        `• ${table.name}: ${inserted}/${rows.length} inserted` +
          (inserted < rows.length ? " (rest already present)" : "")
      );

      // Reset the identity sequence so future auto-generated IDs don't collide
      // with the preserved ones.
      if (table.idColumn) {
        await pg.query(
          `SELECT setval(
             pg_get_serial_sequence($1, $2),
             (SELECT COALESCE(MAX(${table.idColumn}), 0) FROM "${table.name}"),
             true
           )`,
          [table.name, table.idColumn]
        );
      }
    }

    console.log("\n✅ Data migration complete.");
    if (!DRY_RUN) {
      console.log(
        "Note: slots / scrape_targets / notification_log were skipped — they " +
          "rebuild from the next ingest cycle."
      );
    }
  } catch (error) {
    console.error("\n❌ Migration failed:", error);
    process.exitCode = 1;
  } finally {
    pg.release();
    await pool.end();
    sqlite.close();
  }
}

main();
