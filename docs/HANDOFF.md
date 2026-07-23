# SESSION HANDOFF — 10s court monitor re-architecture

> Working doc, committed under `docs/`. Keep this current so a cold session can pick up.
> Last updated: 2026-07-22.
> Companion doc: `docs/REARCHITECTURE-PLAN.md` (full plan + phase table + cutover status).

> **⚠️ Architecture changed after 2026-07-16 — read this first.** The three-clock
> design below (feed head-poll + *watch-targeted reconcile* + daily sweep) was
> reworked on 2026-07-17..19. The **watch-targeted reconcile clock
> (`reconcileWatchedVenueDays`, the bounded round-robin) is RETIRED from the live
> tick.** Its bandwidth scaled with watched-taken venue-days; the fixed-cost sweep
> now covers the same ground. It survives only as a read-only diagnostic
> (`scripts/reconcile-*.ts`). The live ingest tick is now **feed head-poll →
> confirm-on-notify → ClubSpark → periodic full sweep**, and **every writer runs
> `persist: true`** — the Phase-3 cutover gate is now DB state + deploy, not a code
> flag. Wherever this doc still says "Clock 2b" / "persist defaults FALSE", trust the
> code (`src/lib/ingest/reconcile.ts` header + `src/app/api/cron/scrape/route.ts`).

## TL;DR — where we are
Migrating from brittle HTML scraping → official OpenActive/ClubSpark feeds, SQLite → Postgres, on Railway.
- **Phase 0 (SQLite→Postgres): DONE, live in prod.** Prod runs on Railway Postgres.
- **Phase 1 (additive schema groundwork): DONE, migration applied to prod DB.** (code on `rearchitecture` branch, not yet deployed)
- **Phase 2 (OpenActive adapter): DONE (built + validated).** Client, parsers+tests, facility ingest, slot ingest, parity gate, cron wiring.
- **Phase 3 — feed head-poll (Clock 1): DONE, WIRED, persist:true.** `pollSlots({persist:true})` delta-poller in `ingest/openactive/ingest.ts` — resumes from `feed_state` cursor (first run backfills page 1), applies RPDE deltas to `slots`, detects booked/closed→available via `isNewlyAvailable`, returns `SlotChange[]`. Now emits an `unresolvedBy` breakdown (foreign / unmapped-court / no-time / bad-data) so national-feed noise ≠ a seeding gap. Preview: `scripts/poll-slots-preview.ts`.
- **Phase 3 — confirm-on-notify (replaced watch-targeted reconcile): DONE, WIRED.** `confirmFeedChanges()` in `reconcile.ts` — for each *watched, Courtside* feed flip, scrapes that venue-day and **drops false-positives** (feed says available, site says booked) before notifying; site-wins upsert also corrects the dashboard, and any bonus false-negatives found on those venue-days are folded in. Cost is **per real watched transition**, not per watcher. Fails SAFE: a scrape error / over-budget venue-day passes through unsuppressed (with the proxy off, Courtside 404s → degrades to direct-notify). Toggle `CONFIRM_ON_NOTIFY=off`; budget cap `CONFIRM_MAX_VENUE_DAYS`.
- **Phase 3 — periodic full sweep (Clock 3): DONE, WIRED, persist:true.** `fullSweep()` in `reconcile.ts` — scrapes every active Courtside venue-day (window × venues, ~56/run), site-wins upsert, notifies on transitions. Now the **only** false-negative discovery mechanism (fixed cost, independent of watcher count). Throttled `SWEEP_INTERVAL_HOURS` (**default now 2h**, was 24). Preview: `scripts/sweep-preview.ts`.
- **Phase 3 — watch-targeted reconcile (`reconcileWatchedVenueDays`): RETIRED from the tick.** Still in `reconcile.ts` + tested + `scripts/reconcile-run-preview.ts`, but **not called by cron/admin**. Its bandwidth scaled with watched-taken venue-days (~3× the blind scrape in the budget finding below); the fixed-cost sweep replaced it. `RECONCILE_MAX_PAGES` (default 40) is now diagnostic-only; `RECONCILE_INTERVAL_MIN` is gone.
- **Phase 3 cron wiring: DONE (feed-only), persist:true.** `src/app/api/cron/scrape/route.ts` `runFeedIngest()` runs unconditionally: facility refresh (throttled `FACILITY_REFRESH_HOURS`) → Clock 1 every tick → confirm-on-notify on its flips → ClubSpark (throttled `CLUBSPARK_INTERVAL_MIN`) → full sweep (throttled `SWEEP_INTERVAL_HOURS`), each failure-isolated, unions transitions → one `notifyUsers`. Per-clock throttles use `feed_state` source=`clock`. `api/admin/scrape` is the manual unthrottled trigger (facility → poll → confirm → clubspark → sweep). Cutover gate = DB state + deploy (all writers persist:true).
- **Blind path RETIRED (2026-07-16).** Deleted `scraper.ts`, `scrape-scheduler.ts`, the `scrape_targets` table (migration `0002_exotic_sleepwalker.sql` = `DROP TABLE scrape_targets CASCADE`), `differ.storeAndDiff`/`getAvailability`, and `scripts/test-scraper.ts`. `ScrapeStats` moved scraper.ts → `notifiers/email.ts` (kept for the admin failure/summary alerts, now dormant). **Kept** `scrapers/courtside.ts` + `cheerio` (reconcile fetcher) and `scrapers/{index,clubspark,types}.ts` (now used by Phase 4). No `FEED_INGEST_ENABLED` flag — this branch/service is feed-only by design; prod on `main` still runs the old scraper. **Cutover (prod-ops):** provision Postgres for the parallel Railway service + deploy (staging is still on SQLite today).
- **Phase 4 (ClubSpark/Newham into ingest): DONE (2026-07-17).** `pollClubSpark()` in `src/lib/ingest/clubspark/ingest.ts` — reuses the tested `scrapeClubSpark` fetch (proxy-free when unconfigured), resolves/enriches the venue (`source_type='clubspark'`, `external_id`), creates `courts` by name (`external_id='clubspark:<venueId>:<name>'`), site-wins upserts the full-day snapshot into feed-owned `slots`, and returns booked/closed/coaching→available transitions for `notifyUsers`. Wired as a throttled clock (`CLUBSPARK_INTERVAL_MIN`, default 5) in `api/cron/scrape` + the `api/admin/scrape` manual trigger; unions into the single `notifyUsers`. `persist` defaults FALSE (same cutover gate). **No reconcile clock for ClubSpark** — `GetVenueSessions` is first-party authoritative (not an RPDE change-feed with the ~5% staleness problem), so the Courtside HTML reconcile keeps excluding `source_type='clubspark'`. 9 DB-backed tests (`ingest/clubspark/ingest.db.test.ts`). Preview: `scripts/clubspark-poll-preview.ts`. **Scope now:** feed ingest covers **Courtside (Tower Hamlets) + ClubSpark (Newham)**. (Historical note: this bullet originally said `persist` defaults FALSE — the cron/admin callers now pass `persist:true`; availability lands on deploy, gated only by DB state.)

## ⚠️ FEED RELIABILITY FINDING (2026-07-12) — read before Phase 3
Audited the feed vs the **live booking site** (ground truth) over 7 venues × 8 days ≈ **1,380 court-hours** (`scripts/feed-vs-site-audit.ts`, two runs). Live site scraped with the production `scrapeCourtside` parser; joined by (venue, date, hour, court#, tennis-only).
- **Raw agreement ~99.6%.** Sounds great but it's dominated by booked slots (both agree "taken"). Misleading denominator.
- **Miss rate on AVAILABILITY (the metric that matters): ~5% (5 of ~97 genuinely-bookable court-hours).** For a "notify me when a court frees up" product, the feed hides roughly **1 in 20 free courts**.
- Errors go **both ways**, all traceable to feed **staleness** (records 48–116h / 2–5 days old that the operator never re-emitted): mostly false-negatives (site AVAIL, feed=taken → missed alert), occasionally a false-positive (site taken, feed=AVAIL → wasted alert). Run-to-run the small counts are noisy (FP was 0 in one run, 1 in the next).
- **0 coverage gaps** — feed & site cover the exact same court-hours; per-venue court counts match 1:1 across all 7 venues. So the join is sound; the disagreements are genuine data, not mapping bugs.
- Correcting an earlier note: the parity disagreements were NOT "scraper stale / feed fresher" — verified live, it's the **feed** that's stale. e.g. victoria-park 07-14 10am court4: site=AVAIL(£5), feed record 116h old saying taken.
- Root cause is upstream (operator's feed doesn't reliably re-emit on cancellation), so polling harder does NOT fix it.
- **Implication for Phase 3:** the feed is NOT a safe wholesale replacement — feed-only would miss ~5% of the exact events the product exists to catch. **RECOMMENDATION: keep a lightweight periodic scrape as a reconciliation cross-check** (feed drives sub-minute freshness + geo/courts/multi-venue discovery; a slower scrape backstops the feed's stale misses). Do NOT delete `scrapers/courtside.ts` in Phase 3. Decision pending with user.

## Branching (CHANGED 2026-07-12)
All re-architecture work now lives on ONE branch **`rearchitecture`** (not branch-per-phase). It stacks phase0(merged)+phase1+phase2 commits; tip = `ec50a82`. The old `feat/phase1-schema` / `feat/phase2-openactive` branches are superseded (kept locally, ignore them). Push: `git push main rearchitecture` then PR → main.

## ⚠️ Environment gotchas (critical for a cold session)
- **The harness blocks any Bash command containing `git push`** — the human must run pushes themselves. Prepare commits/branches locally; hand the user the exact `git push` command.
- **The harness blocks prod-mutating commands** (Railway variable sets, `db:migrate`/seed against prod) unless the user has explicitly authorized in-chat that turn. When blocked, give the user the command to run.
- **Remote is named `main`** (not `origin`): `git push main <branch>`; remote branch = `main/main`. `git` warns "refname 'main' is ambiguous" — harmless.
- **`.env`** (gitignored) holds `DATABASE_URL` = the Railway Postgres **public** proxy URL (`tokaido.proxy.rlwy.net:34625`). The private URL (`postgres.railway.internal:5432`) is what the deployed service uses.
- **Railway CLI** is logged in + linked: project `lovely-nurturing`, env `production`, service `10s-court-monitor` (Postgres service is named `Postgres`). `railway ssh "<cmd>"` runs one-shot in the prod container. `railway logs` streams (no `timeout` on macOS — use `perl -e 'alarm 12; exec @ARGV' railway logs`).
- **No PostGIS** on the Railway Postgres image (stock PG 18.4) → we use plain `lat`/`lng` + btree index; PostGIS deferred.
- **jq is NOT installed**; use `python3 -c` for JSON. `curl` = `/usr/bin/curl`.
- Tests: `npm test` (vitest). Lint: `npm run lint` (must be 0 warnings — harness push-gate enforces it). Typecheck: `npx tsc --noEmit`.

## Git state (branches, all local unless noted)
- `main` (local) = remote `main/main` + **1 unpushed commit** `chore(lint)` (27bafb3). Remote main tip = `57a8e5f` (reconcile merge: staging UI + Postgres).
- **`rearchitecture`** ← CURRENT, the single ongoing branch. Off main, stacks: `3031faf` (P1 schema) → `56077d9` (P2 core) → `ec50a82` (P2 slots+parity+wiring). **Unpushed.**
- Superseded (ignore): `feat/phase1-schema`, `feat/phase2-openactive`.

### Push commands for the user (when ready)
```bash
git push main main:main                    # the lint fix (independent, optional)
git push main rearchitecture               # then PR/merge → deploy P1+P2
```

## Prod facts
- Site: https://timefor10s.com  · health: `/api/health` → should show `database:"connected"`.
- Prod DB already has **Phase 0 + Phase 1 schema applied** (0000 + 0001) and is seeded from a real prod SQLite snapshot (5 users, 10 venues, 13 watches, etc.).
- **Prod venues table has 10 rows** (not 6): the 6 in `constants.ts` + 3 bonus TH (`king-edward-memorial-park`, `poplar-rec-ground`, `wapping-gardens`) + `abbotts-park` (stale? no slots, not in feed/constants — lean-up candidate, confirm before deleting).
- Rollback net: old SQLite volume still mounted at `/app/data`; revert = `DATABASE_URL` → `file:./data/tennis.db` + redeploy pre-Postgres commit.
- Proxy (Webshare) demoted, not removed — the OpenActive feed (Clock 1) and ClubSpark are always direct; the proxy is now only the optional Courtside HTML fetcher for confirm-on-notify + the full sweep. Leave its vars unset to go direct (confirm/sweep 404 → fail safe); set them only if direct fetch hits 403/timeouts.

## Key decisions (locked)
- Feeds over scraping. Courtside/TH → OpenActive RPDE; Newham → ClubSpark JSON (no OpenActive court data).
- One Railway Postgres shared by (eventually) 2 services (web/API + worker). No Neon, no 2nd provider.
- **Coverage = all London-area, data-driven.** Feed is national; filter by Greater London bbox. Feed's current London footprint = the 7 TH venues (auto-discovered).
- Contract `@pdd27673/10s-contract` evolves additively (0.2.0) — not started yet.
- No PostGIS (see above).
- **No regressions** — verified at every phase (Phase 0 smoke, scraping still writing to Postgres: 3400+ fresh slots).

## What's DONE (with commits)
- **Phase 0** (merged to main via reconcile `57a8e5f`, PR #19 `cde5265`): schema pg-core, db.ts node-postgres, drizzle pg baseline `0000`, VACUUM/health fixes, `scripts/migrate-sqlite-to-postgres.ts` (--truncate/--dry-run), `scripts/reseed-from-prod.sh`.
- **Phase 1** (`3031faf` on `feat/phase1-schema`): additive migration `0001` — `courts`, `feed_state` tables; venues +operator/source_type/external_id/address/postcode/amenities(jsonb)/booking_url_template/active/lat/lng(+btree idx); slots +court_id/starts_at/ends_at/start_minute/remaining_uses/max_uses/booking_url (all nullable). `scripts/seed-venue-metadata.ts` (applied to prod: 6 venues enriched).
- **Phase 2 core** (`56077d9` on `feat/phase2-openactive`): `src/lib/ingest/openactive/{client,parse,parse.test,ingest}.ts`.
  - Feeds: `https://api.premiertennis.co.uk/openactive/feed/{facility-uses,individual-facility-use-slots}`.
  - FacilityUse → venue(+courts+geo+address+amenities); Slot → {courtExternalId (`facilityUse` field), startDate, endDate, remainingUses, maximumUses, offers[base].price}.
  - `ingestFacilities({dryRun})` validated: 7 London venues / 18 courts, all match existing rows (0 dupes). Only enriches venues/courts + feed_state — does NOT touch `slots` (safe alongside scraper).

## What's DONE (Phase 2, commit `ec50a82` on `rearchitecture`)
- **Slot ingestion** — `ingestSlots()` in `src/lib/ingest/openactive/ingest.ts`: walks `individual-facility-use-slots`, `parseSlot`, resolves `courtExternalId`→`courts` row, upserts into `slots` (new cols + legacy date/time/court/status). **`persist` defaults FALSE** (scraper still owns `slots`; flip on at Phase 3). Persists `feed_state('openactive','individual-facility-use-slots')` only when persisting. Requires `courts` populated first (run `ingestFacilities()`).
- **Pure helpers** in `parse.ts`: `facilityIdFromRef`, `courtNumberFromName` (tolerates scraper `' -'` coaching marker), `localDate`, `hourLabel` (scraper-style `'5pm'` from wall-clock, no TZ conversion). +8 tests (27 total pass).
- **Parity gate** — `scripts/parity-openactive.ts` (read-only, `npx tsx scripts/parity-openactive.ts`). Walks BOTH feeds in memory (no DB `courts` dependency), diffs vs scraper `slots`. **Result: 99.8% (938/940), 0/0 feed-vs-scraper-only, 2 disagreements = freshness skew.** GREEN.
- **Cron wiring** — `maybeIngestFacilities()` in `src/app/api/cron/scrape/route.ts`: throttled (`FACILITY_REFRESH_HOURS`, default 6h via `feed_state.last_polled_at`), failure-isolated, refreshes venues+courts, never touches `slots`. `ingestSlots` NOT wired to write yet.

## Current ingest architecture (as-built, 2026-07-19)
The live tick (`runFeedIngest` in `api/cron/scrape/route.ts`), all writers `persist:true`:
1. `ensureVenuesExist` + `maybeIngestFacilities` (throttled `FACILITY_REFRESH_HOURS`, default 6h) — seed venues, refresh geo/courts. Populating `courts` is the prereq for slot→court resolution.
2. **Clock 1 — feed head-poll**, every tick. `pollSlots` applies RPDE deltas, notifies on booked/closed→available. Deletes limitation unchanged: RPDE `deleted` items carry only an id and `slots` isn't keyed by feed slot id → counted, not applied; the sweep + age-cleanup handle drift.
3. **confirm-on-notify** on Clock 1's watched Courtside flips — `confirmFeedChanges` scrapes those venue-days, drops false-positives, folds in bonus false-negatives. Per-transition cost; `CONFIRM_ON_NOTIFY=off` to disable; `CONFIRM_MAX_VENUE_DAYS` caps it. Fails safe (proxy off → 404 → direct-notify).
4. **ClubSpark (Newham)** — `pollClubSpark`, throttled `CLUBSPARK_INTERVAL_MIN` (default 5). First-party snapshot, no reconcile needed.
5. **Full sweep (Clock 3)** — `fullSweep`, throttled `SWEEP_INTERVAL_HOURS` (default **2h**). Fixed-cost, the only false-negative discovery mechanism + dashboard floor.
6. Union all transitions → one `notifyUsers`; `runCleanup` (retention + VACUUM).

`api/admin/scrape` = the same pipeline, unthrottled, admin-only manual trigger.
**Retired-not-deleted:** `reconcileWatchedVenueDays` + `computePendingSet` + `selectReconcileTargets` stay in `reconcile.ts` (tested, `scripts/reconcile-*.ts`) as read-only diagnostics; not on the tick. The "bounded round-robin budget finding" above is history now — the fixed-cost sweep sidesteps it entirely.

## What's NEXT
**Staging cutover: DONE (2026-07-23).** The feed-primary service is live on staging Postgres and has been ingesting for a while — feed head-poll + ClubSpark writing `slots`, notifications on transitions. ⚠️ **No proxy configured in staging**, so the Courtside HTML path (confirm-on-notify + the full sweep) 404s and fails safe → in staging those are effectively no-ops, which means the **~5% feed-false-negative backstop is currently absent there** and confirm-on-notify can't suppress false-positives. Feed + ClubSpark availability still land fine. To close that gap on staging: set the four `WEBSHARE_*` vars, or verify direct Courtside fetch holds from the staging IP. **Prod cutover still pending** — see the plan's "Cutover status" for the one extra prod step (truncate scraper-owned `slots` first so `"Court N"` doesn't collide with `"Tennis court N"`).

**Phase 5 — split the worker service: CODE DONE (2026-07-22), deploy is ops.**
- **`src/lib/ingest/run.ts`** — the ingest tick body (`runFeedIngest`) extracted from the cron route into one shared module. Relative imports + Next-runtime-free so it runs under both Next and `tsx`. Also **throttled `runCleanup`** behind a new `cleanup` clock (`CLEANUP_INTERVAL_HOURS`, default 6h) — a per-tick `VACUUM` would thrash the DB now that the worker ticks every ~30s.
- **`src/lib/ingest/worker.ts`** — the standalone single-instance loop: immediate first tick, then `setInterval` every `WORKER_TICK_SECONDS` (default 30, min 5), in-process single-flight guard (a long sweep never stacks), graceful SIGTERM/SIGINT drain → exit 0. Local: `npm run worker`.
- **cron route** thinned to call the shared `runFeedIngest`; stays as a manual/fallback HTTP trigger (secret + single-flight kept). Admin route unchanged.
- **`railway.worker.json`** — ready-to-use config for the 2nd service: no healthcheck, no `db:migrate` (web owns migrations), and **`startCommand` execs tsx directly**. ⚠️ **Signal finding (verified):** `npm run worker` does NOT forward SIGTERM (worker gets SIGKILL'd mid-tick, exit 143); `exec ./node_modules/.bin/tsx …` drains cleanly (exit 0). Do not start the worker via `npm`.
- **Ops remaining (needs user):** create the 2nd Railway service in the same project/env, point its config at `railway.worker.json`, reference the shared `DATABASE_URL`, deploy — then **disable the external cron** hitting `/api/cron/scrape` so ingest doesn't run twice. Gates all green (134 tests, typecheck, lint, `next build`); worker harness smoke-tested (startup/tick/failure-isolation/graceful-shutdown).
**Phase 6 — normalize time end-to-end** (`slots`/`watches` → `HH:MM`/`starts_at`); fix `matchesWatch` (`src/lib/notifiers/index.ts` — currently string-equality on "7pm" labels).
**Phase 7 — contract 0.2.0 + website wiring + map** (lat/lng markers, bbox query) + expanded venue list.

**Also tracked:** `abbotts-park` stale row (delete after confirming empty). `.runbook.md` committed secrets (rotate + remove).

## How to run things
```bash
npm run dev                                   # local dev (hits prod Postgres via .env)
npm test                                       # vitest
npx tsc --noEmit && npm run lint               # gates
npm run db:generate                            # generate migration from schema.ts
npm run db:migrate                             # apply to DATABASE_URL (prod — user-authorized)
npm run db:seed-venues                         # venue metadata seed
npm run db:migrate-data -- --truncate <sqlite> # reseed Postgres from a sqlite snapshot
./scripts/reseed-from-prod.sh                  # pull live prod sqlite → reseed (cutover helper)
# dry-run facility ingest:
npx tsx -e "import 'dotenv/config'; import {ingestFacilities} from './src/lib/ingest/openactive/ingest'; ingestFacilities({dryRun:true}).then(s=>console.log(s))"
npx tsx scripts/parity-openactive.ts            # feed vs scraper-DB parity (read-only, ~2min)
npx tsx scripts/feed-vs-site-audit.ts [days]    # feed vs LIVE booking site reliability (read-only, ~4min) — the feed-health meter
npx tsx scripts/poll-slots-preview.ts           # Clock 1 pollSlots read-only preview (needs courts populated; else resolves 0)
npx tsx scripts/reconcile-preview.ts            # DIAGNOSTIC — retired reconcile budget sizer (pending venue-days / run)
npx tsx scripts/reconcile-run-preview.ts        # DIAGNOSTIC — retired reconcile read-only preview (scrapes; writes nothing; not on the tick)
npx tsx scripts/sweep-preview.ts                # Clock 3 full-sweep read-only preview (scrapes all courtside venue-days)
npx tsx scripts/clubspark-poll-preview.ts       # Phase 4 ClubSpark/Newham read-only poll preview (skips unseeded venues)
```
