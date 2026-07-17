# SESSION HANDOFF — 10s court monitor re-architecture

> **Local, uncommitted working doc** (in gitignored `docs/`). Keep this current so a
> cold session / Cursor can pick up. Last updated: 2026-07-16.
> Companion docs: `docs/REARCHITECTURE-PLAN.md` (full plan + phase table),
> `docs/OPENACTIVE-FEED-DISCOVERY.md`. Memory: `~/.claude/projects/-Users-p-Documents-Coding-10s-court-monitor-local/memory/`.

## TL;DR — where we are
Migrating from brittle HTML scraping → official OpenActive/ClubSpark feeds, SQLite → Postgres, on Railway.
- **Phase 0 (SQLite→Postgres): DONE, live in prod.** Prod runs on Railway Postgres.
- **Phase 1 (additive schema groundwork): DONE, migration applied to prod DB.** (code on `rearchitecture` branch, not yet deployed)
- **Phase 2 (OpenActive adapter): DONE (built + validated).** Client, parsers+tests, facility ingest, slot ingest, parity gate, cron wiring.
- **Phase 3 Clock 1 (feed head-poll): CODE DONE (built + green, UNWIRED).** `pollSlots()` delta-poller + transition→notify. Not yet wired to cron; awaiting prod `courts` population + cutover (Edit 3).
- **Phase 3 Clock 2b (watch-targeted reconcile — fetch/upsert/notify): CODE DONE.** `reconcileWatchedVenueDays()` in `src/lib/ingest/reconcile.ts` — **bounded round-robin** (design decision resolved with user 2026-07-16: fixed `RECONCILE_MAX_PAGES`/run, rotate least-recently-checked pending venue-days via `feed_state` source=`reconcile`). Site-wins upsert into feed-owned rows with canonical court labels; returns `SlotChange[]` for `notifyUsers`. `persist` defaults FALSE (same cutover gate as Clock 1). Preview: `scripts/reconcile-run-preview.ts`.
- **Phase 3 Clock 3 (daily full sweep): CODE DONE.** `fullSweep()` in `reconcile.ts` — scrapes every active Courtside venue-day (window × venues, ~56/run), site-wins upsert, notifies on transitions, re-baselines Clock 2 (stamps reconcile cursors). Shares the scrape/canonicalise/upsert inner loop with Clock 2b (`scrapeAndReconcileVenueDays`). `persist` defaults FALSE. Preview: `scripts/sweep-preview.ts`.
- **Phase 3 cron wiring: DONE (feed-only).** `src/app/api/cron/scrape/route.ts` runs `runFeedIngest()` unconditionally — Clock 1 every tick + Clock 2b (throttled `RECONCILE_INTERVAL_MIN`, default 15) + Clock 3 (throttled `SWEEP_INTERVAL_HOURS`, default 24), each failure-isolated, unions transitions → one `notifyUsers` call. Per-clock throttles use `feed_state` source=`clock`. `api/admin/scrape` is the manual unthrottled trigger (facility+poll+sweep).
- **Blind path RETIRED (2026-07-16).** Deleted `scraper.ts`, `scrape-scheduler.ts`, the `scrape_targets` table (migration `0002_exotic_sleepwalker.sql` = `DROP TABLE scrape_targets CASCADE`), `differ.storeAndDiff`/`getAvailability`, and `scripts/test-scraper.ts`. `ScrapeStats` moved scraper.ts → `notifiers/email.ts` (kept for the admin failure/summary alerts, now dormant). **Kept** `scrapers/courtside.ts` + `cheerio` (reconcile fetcher) and `scrapers/{index,clubspark,types}.ts` (now used by Phase 4). No `FEED_INGEST_ENABLED` flag — this branch/service is feed-only by design; prod on `main` still runs the old scraper. **Cutover (prod-ops):** provision Postgres for the parallel Railway service + deploy (staging is still on SQLite today).
- **Phase 4 (ClubSpark/Newham into ingest): DONE (2026-07-17).** `pollClubSpark()` in `src/lib/ingest/clubspark/ingest.ts` — reuses the tested `scrapeClubSpark` fetch (proxy-free when unconfigured), resolves/enriches the venue (`source_type='clubspark'`, `external_id`), creates `courts` by name (`external_id='clubspark:<venueId>:<name>'`), site-wins upserts the full-day snapshot into feed-owned `slots`, and returns booked/closed/coaching→available transitions for `notifyUsers`. Wired as a throttled clock (`CLUBSPARK_INTERVAL_MIN`, default 5) in `api/cron/scrape` + the `api/admin/scrape` manual trigger; unions into the single `notifyUsers`. `persist` defaults FALSE (same cutover gate). **No reconcile clock for ClubSpark** — `GetVenueSessions` is first-party authoritative (not an RPDE change-feed with the ~5% staleness problem), so the Courtside HTML reconcile keeps excluding `source_type='clubspark'`. 9 DB-backed tests (`ingest/clubspark/ingest.db.test.ts`). Preview: `scripts/clubspark-poll-preview.ts`. **⚠️ Scope now:** feed ingest covers **Courtside (Tower Hamlets) + ClubSpark (Newham)**. The scope caveat is lifted — but availability only lands once `persist:true` at the staging/prod cutover.

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
- Proxy (Webshare) still active — removed in Phase 3.

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

## What's NEXT (Phase 3, then 4–7)
**Phase 2 leftover (prod write — needs user authorization):** run `ingestFacilities()` once in prod to populate `courts`/geo (or just let the cron do it on next deploy — `maybeIngestFacilities` runs it automatically). Until then prod `courts` is empty, so `ingestSlots` would resolve nothing in prod.

**Phase 3 (REWORKED 2026-07-12 — feed-primary + reconcile, NOT feed-only):** because the feed hides ~5% of bookable slots (see reliability finding above), do NOT delete the scraper. Stand up **three clocks** (full rationale in `docs/REARCHITECTURE-PLAN.md` → "Feed reliability + hybrid ingestion"):
- **Clock 1 — feed head-poll (30s), 0 HTML:** ✅ CODE DONE (`ec50a82`+this commit). `pollSlots({persist})` in `ingest/openactive/ingest.ts`: resumes from saved `feed_state` cursor (first run backfills from page 1), applies RPDE deltas to `slots`, detects booked/closed→available via `isNewlyAvailable`, returns `SlotChange[]` for `notifyUsers`. `persist` defaults FALSE (read-only preview; `scripts/poll-slots-preview.ts`). Shares `slotRowValues`/`upsertSlotRow` with `ingestSlots`. Pure helpers `feedSlotStatus`/`isNewlyAvailable` in `parse.ts` (+tests, 29 total). **STILL TODO:** (a) **prereq — `courts` populated in prod** (run `ingestFacilities()` / let cron do it) so slot→court resolution works [preview resolves 0 until then]; (b) wire into cron + flip `persist:true` at cutover (Edit 3), which requires resetting `slots` to feed-owned rows first (feed writes "Court N", scraper wrote "Tennis court N" → different unique keys). **Deletes limitation:** RPDE `deleted` items carry only an id and `slots` isn't keyed by feed slot id, so deletes are counted not applied — Clock 3 sweep + age-cleanup handle drift.
- **Clock 2 — watch-targeted reconcile:** ✅ **CODE DONE (2a + 2b), UNWIRED.**
  - **2a DONE (`c77a025`):** `computePendingSet()` in `src/lib/ingest/reconcile.ts` — from active watches × window, the venue-days where a watched (venue,date,time) currently shows no available court in DB. Read-only budget sizer + `scripts/reconcile-preview.ts`. Pure `watchPreferredTimes`/`nextDates` (+tests).
  - **2b DONE (2026-07-16 — bounded round-robin, per user):** `reconcileWatchedVenueDays({persist,maxPages,windowDays})` in `src/lib/ingest/reconcile.ts`. Takes the pending set, **restricts to Courtside venues** (`source_type='courtside'` ∪ static config → so ClubSpark/Newham is excluded, Phase 4), picks a BOUNDED least-recently-checked subset (`selectReconcileTargets`, `RECONCILE_MAX_PAGES` default 40, cursors in `feed_state` source=`reconcile`, feed=`<slug>|<date>`), scrapes each via `scrapeCourtside`, canonicalises labels (`canonicalCourtLabel`: scraper "Tennis court N" → feed "Court N" + `courtId`), **site-wins** upserts into the feed-owned `slots` rows (preserves feed metadata cols on conflict), returns `SlotChange[]` for `notifyUsers`. Per-venue-day scrape errors isolated. `persist` defaults FALSE (same cutover gate as Clock 1). Pure helpers `canonicalCourtLabel`/`selectReconcileTargets` (+6 tests, 40 total). Preview: `scripts/reconcile-run-preview.ts`.
  - **⚠️ BUDGET FINDING (2026-07-12) — why 2b is bounded:** the preview against 12 live watches showed **79 venue-days/run ≈ 7,584 pages/day at 15-min cadence — 3× today's ~2,400 blind scrapes** (full-pending would be worse than the blind scrape it replaces). Two causes: (1) **half-migrated prod state** — `courts` EMPTY, `external_id` null on all venues, 4 watched venues with 0 slots + st-johns closed ⇒ ~40 of 79 pending are **phantom**; (2) **structural** — one all-venues watch × 10 venues × 8 days. Bounded round-robin makes cost independent of both: fixed `maxPages`/run, worst-case per-slot miss latency ≈ (pending venue-days / maxPages) × run-interval. **STILL TODO for 2b:** wire into cron (throttled like `maybeIngestFacilities`) + flip `persist:true` at cutover; the phantom-pending inflation self-resolves once the feed owns `slots` (missing rows stop counting as pending) and `courts` is populated in prod. **A trustworthy budget still can't be measured until post-cutover** — pre-cutover the preview exercises selection + scrape mechanics but surfaces 0 transitions (feed doesn't own `slots` yet, so every prior-status lookup is null).
- **Clock 3 — daily full sweep (24h):** scrape all 56 venue-days; dashboard floor + feed-drop net.
- **Retire only the blind path:** delete `scrape-scheduler.ts` + `scrape_targets` + `scraper.ts` (fixed per-venue-date cadence). **KEEP `scrapers/courtside.ts` + cheerio** (now the reconcile fetcher). Proxy → optional low-rate Clock 2/3 backstop (verify direct fetch vs the 502/timeout rate the audit hit). Add the 3 bonus venues to active tracking.
- **Budget:** ~400–750 HTML/day for all 7 venues vs ~2,400/day today (4 venues) — see `feed-vs-site-audit.ts` and `scrape-scheduler.ts` SCRAPE_INTERVALS.
**Phase 4:** move ClubSpark (`scrapers/clubspark.ts` `GetVenueSessions`) into `ingest/` as an interval poller (no proxy).
**Phase 5:** split worker service (2nd Railway service, `ingest/worker.ts`, shared DATABASE_URL; retire external cron).
**Phase 6:** normalize time end-to-end (`slots`/`watches` → `HH:MM`/`starts_at`); fix `matchesWatch` (`src/lib/notifiers/index.ts:66` — currently string-equality on "7pm" labels).
**Phase 7:** contract 0.2.0 + website wiring + map (lat/lng markers, bbox query) + expanded venue list.

**Also tracked:** lean-up pass (delete dead code) AFTER Phase 3 — see task list / plan. `abbotts-park` stale row. `.runbook.md` has committed secrets (rotate + remove).

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
npx tsx scripts/reconcile-preview.ts            # Clock 2 budget sizer (pending venue-days / run)
npx tsx scripts/reconcile-run-preview.ts        # Clock 2b bounded reconcile read-only preview (scrapes; writes nothing)
npx tsx scripts/sweep-preview.ts                # Clock 3 full-sweep read-only preview (scrapes all courtside venue-days)
npx tsx scripts/clubspark-poll-preview.ts       # Phase 4 ClubSpark/Newham read-only poll preview (skips unseeded venues)
```
