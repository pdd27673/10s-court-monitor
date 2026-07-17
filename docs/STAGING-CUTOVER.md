# Staging cutover runbook — feed-primary ingestion (Phases 0–4)

> Cut the **`rearchitecture`** branch over to a **staging** Railway environment on
> **Postgres**, feed-primary (blind scraper retired). **Staging only — not prod.**
> Companion: `docs/REARCHITECTURE-PLAN.md`, `docs/HANDOFF.md`.

## Why staging is the *clean* case

A fresh staging Postgres starts with an **empty `slots` table**, so the one hard
part of a prod cutover doesn't apply here: there are no scraper-written
`"Tennis court N"` rows to collide with the feed's `"Court N"` rows under the
`(venue,date,time,court)` unique key. The first ingest is a pure **backfill**, and
by the transition rule (`isNewlyAvailable` — a null prior status never fires) it
**notifies nothing**. Real notifications only start on the *second* tick onward, on
genuine booked→available flips.

**Do NOT import `slots` from a prod snapshot.** If you want realistic watches to
exercise notifications, import only the user tables (below) and leave
`slots`/`feed_state`/`notification_log` empty for the feed to own.

The cron path already runs every clock with `persist: true`
(`runFeedIngest` in `src/app/api/cron/scrape/route.ts`) — the cutover gate is now
**DB state + deploy**, not a code flag.

---

## 0. Preconditions (local)

```bash
git checkout rearchitecture
npx tsc --noEmit && npm run lint && npm test && npm run build   # all green
git push main rearchitecture        # remote is named 'main' (not origin); run yourself
```

## 1. Provision a staging Postgres (Railway)

Use a **separate Railway environment** (e.g. `staging`) in the same project so it
never touches prod data.

```bash
railway environment staging          # create/select the staging environment
# In that environment: add a Postgres service (dashboard → New → Database → Postgres),
# or:
railway add --database postgres
```

## 2. Point the staging web service at the branch + DB

- Set the staging service's **source branch = `rearchitecture`**.
- Reference the DB (private URL) into the service:

```bash
# Railway reference variable (dashboard is easiest):
DATABASE_URL = ${{Postgres.DATABASE_URL}}
```

## 3. Set env vars on the staging service

**Required**

```bash
railway variables --set DATABASE_URL='${{Postgres.DATABASE_URL}}' \
  --set CRON_SECRET='<staging-cron-secret>' \
  --set AUTH_SECRET='<staging-random>' \
  --set NEXT_PUBLIC_APP_URL='https://<staging-host>' \
  --set AUTH_URL='https://<staging-host>' \
  --set NODE_ENV='production'
```

**Notifications** — set real creds only if you want staging to actually send.
Otherwise leave unset (senders no-op without creds) and rely on the cron logs /
DB rows to verify transitions.

```bash
# Telegram: TELEGRAM_BOT_TOKEN, TELEGRAM_WEBHOOK_SECRET
# Email (Resend): RESEND_API_KEY, EMAIL_FROM   (or Gmail: GMAIL_USER, GMAIL_APP_PASSWORD)
# ADMIN_EMAIL for admin alerts
```

**Proxy (Webshare)** — only the Courtside HTML reconcile fetcher (Clock 2b/3) can
use it; the OpenActive feed (Clock 1) and ClubSpark (Newham) are always direct.
Leave **unset** to go direct and confirm the block/timeout rate is acceptable on
staging; set the four vars only if direct fetch gets 403/timeouts.

```bash
# WEBSHARE_PROXY_HOST, WEBSHARE_PROXY_PORT, WEBSHARE_USERNAME, WEBSHARE_PASSWORD
```

**Clock tuning** — all optional; defaults are sane. Override on staging to make a
verification run cheaper/faster if you like:

| Var | Default | Meaning |
|---|---|---|
| `SCRAPE_DAYS` | 8 | window (days) all clocks cover |
| `FACILITY_REFRESH_HOURS` | 6 | venue/court metadata refresh cadence |
| `CLUBSPARK_INTERVAL_MIN` | 5 | Newham JSON poll cadence |
| `RECONCILE_INTERVAL_MIN` | 15 | Clock 2b cadence (= notify-miss SLA) |
| `RECONCILE_MAX_PAGES` | 40 | Clock 2b HTML budget/run |
| `SWEEP_INTERVAL_HOURS` | 24 | Clock 3 daily full sweep |
| `CLEANUP_DAYS` | 7 | slot/log retention |

## 4. Deploy

```bash
railway up            # or push-to-deploy if the service tracks the branch
```

On deploy the start command runs **`npm run db:migrate && npm start`**, applying
migrations `0000 → 0001 → 0002` to the fresh staging Postgres automatically
(`0002` drops the retired `scrape_targets`). Healthcheck: `/api/health`.

```bash
curl -s https://<staging-host>/api/health | python3 -m json.tool
# expect: "database": "connected"
```

## 5. First ingest — the backfill (notifies nothing)

Trigger one cron tick (or let your external scheduler hit it):

```bash
curl -X POST https://<staging-host>/api/cron/scrape \
  -H "Authorization: Bearer <staging-cron-secret>"
```

What the first tick does, in order (`runFeedIngest`):
1. `ensureVenuesExist` — seeds the statically-configured venues.
2. `maybeIngestFacilities` — OpenActive facility feed → venues geo/address +
   `courts` (the ~7 Tower Hamlets venues, ~18 courts). **Prereq for slot→court
   resolution**, runs first.
3. **Clock 1** `pollSlots` — first run has no cursor → full backfill from page 1
   (~88 pages, ~1.6 MB, ~35s at the 0.4s/page pace). All prior statuses null →
   **0 transitions**.
4. **ClubSpark** `pollClubSpark` — Newham full-snapshot → seeds `slots` + creates
   Newham `courts` by name. Backfill → **0 transitions**.
5. **Clock 3** `fullSweep` — Courtside HTML sweep, site-wins, baselines Clock 2.
6. `runCleanup` — retention + `VACUUM`.

Because everything is a first-seen backfill, **no notifications fire** on this tick.

## 6. Verify

```bash
# health
curl -s https://<staging-host>/api/health | python3 -m json.tool

# data present for BOTH operators (point a local .env at the staging DATABASE_URL):
railway run --environment staging psql "$DATABASE_URL" -c "
  select v.source_type, count(distinct v.id) venues, count(distinct c.id) courts, count(s.id) slots
  from venues v left join courts c on c.venue_id=v.id left join slots s on s.venue_id=v.id
  group by v.source_type order by 1;"
# expect a 'courtside' row (Tower Hamlets) AND a 'clubspark' row (Newham) with slots > 0
```

- Hit `/api/availability` and `/api/venues` → Newham (ClubSpark) courts now appear
  alongside Tower Hamlets.
- **Second tick** should be cheap: Clock 1 resumes at the head (near-empty delta),
  ClubSpark re-polls, sweep/reconcile respect their throttles.
- **Notification smoke:** with a watch on a currently-taken slot, book→cancel a real
  court (or wait for a genuine flip); confirm a transition is logged and (if creds
  set) a Telegram/email fires within the clock interval.

### Optional — per-clock read-only previews (point local `.env` at staging DB)

```bash
npx tsx scripts/poll-slots-preview.ts        # Clock 1 (needs courts populated)
npx tsx scripts/clubspark-poll-preview.ts    # ClubSpark/Newham
npx tsx scripts/reconcile-preview.ts         # Clock 2 budget sizer
npx tsx scripts/sweep-preview.ts             # Clock 3
```

## 7. (Optional) realistic watches for notification testing

To exercise notifications with real users/watches, import **only** the user tables
from a prod snapshot — never `slots`:

```bash
./scripts/reseed-from-prod.sh        # pulls a live prod sqlite snapshot
# then import users/watches/channels only, leaving slots/feed_state empty:
npm run db:migrate-data -- --truncate <snapshot.db>
#   ^ review scripts/migrate-sqlite-to-postgres.ts; skip the slots/feed_state/
#     notification_log tables so the feed owns availability from scratch.
```

## Notes / gotchas

- **`abbotts-park`** (stale row: no slots, not in feed/constants) only exists if you
  seed staging from a prod dump. A clean fresh-Postgres staging won't have it. If it
  appears, delete it after confirming it's empty:
  `delete from venues where slug='abbotts-park' and not exists (select 1 from slots where venue_id=venues.id);`
- **Cron scheduler:** nothing in the repo schedules the cron — point your external
  scheduler (or a Railway cron service) at `POST /api/cron/scrape` with the
  `Authorization: Bearer $CRON_SECRET` header. The route has a single-flight guard.
- **Env gotcha (from HANDOFF):** the harness blocks `git push` and prod-mutating
  commands — run steps 0–7 yourself. This runbook is staging-scoped by design.
- **Prod later:** the same sequence applies, with the extra step of resetting the
  scraper-owned `slots` (truncate) *before* the first feed persist so `"Court N"`
  doesn't duplicate `"Tennis court N"`. Staging skips that because it starts empty.
