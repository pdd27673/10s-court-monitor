# Archived one-off cutover scripts (Phase 0 SQLite → Postgres).
#
# These are not part of the Railway runtime. They previously pulled in
# `better-sqlite3` + a native compile toolchain on every deploy — that dep
# and the nixpacks python/gcc/gnumake packages have been removed.
#
# To run locally (only if you still have a SQLite dump to import):
#   npm install better-sqlite3 @types/better-sqlite3
#   npx tsx scripts/legacy/migrate-sqlite-to-postgres.ts
