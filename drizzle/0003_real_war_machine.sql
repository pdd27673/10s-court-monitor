ALTER TABLE "courts" ADD COLUMN "non_tennis" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
-- Retroactive backfill. Non-tennis courts were seeded freely before the ingest
-- guard landed, and the guard only stopped NEW ones — the existing rows still
-- resolved feed slots into `slots` and reached the dashboard. Flag them here so
-- the fix applies to data already in the table, not just to future ingests.
-- Keep this pattern in sync with NON_TENNIS_KEYWORDS in src/lib/non-tennis.ts.
UPDATE "courts" SET "non_tennis" = 1
  WHERE "name" ~* '(padel|paddle|cricket|netball|football|basketball|bowls|bowling)';--> statement-breakpoint
-- Purge availability already written for those courts (feed slots link via
-- court_id; scraper rows carry only the text label).
DELETE FROM "slots" WHERE "court_id" IN (SELECT "id" FROM "courts" WHERE "non_tennis" = 1);--> statement-breakpoint
DELETE FROM "slots" WHERE "court_id" IS NULL
  AND "court" ~* '(padel|paddle|cricket|netball|football|basketball|bowls|bowling)';
