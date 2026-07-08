# Plan: Turn the monitor into an Expo/React Native app (reliable push)

## Context

`10s-court-monitor` is already a multi-user Next.js 16 + Drizzle/SQLite backend with
magic-link auth (NextAuth JWT + Resend), watches/channels CRUD, two working scrapers
(Courtside + ClubSpark), and a pluggable notifier fan-out. It notifies via Telegram/email
today. The goal is a phone app whose core value is **reliable push** ("get pinged the
second a court frees up") — iOS web push is too unreliable for that, so we go native via
**Expo (React Native)**. The backend is ~80% ready; the app is a thin client over existing
REST APIs. The booker (`10s-worker`) stays private and is out of scope.

**Guiding principle (from you):** use off-the-shelf, well-engineered parts wherever one can
be plugged in; don't rewrite wheels; weigh cost/benefit. Applied throughout below.

## Architecture

```
Expo app (expo-notifications) --registers--> device push token
   --Bearer JWT--> existing Next.js REST API --> stores token as a
                                                 notification_channel (type "expo-push")

scraper (unchanged) --> differ --> notifyUsers() fan-out
   --NEW branch--> expo-server-sdk --> Expo Push API --> APNs/FCM --> device buzzes
```

Push slots in as a **third notification-channel type** next to telegram/email, so the
entire watch-matching + dedup pipeline (`notification_log`) is reused unchanged.

---

## Phase 1 — Backend bridge (in `10s-court-monitor`, buildable now)

### 1a. Expo push channel (off-the-shelf sender)
- Add dep **`expo-server-sdk`** (official, handles batching, receipts, and the critical
  `DeviceNotRegistered` case) instead of hand-rolling the Expo Push HTTP API.
- New `src/lib/notifiers/expo-push.ts`: `sendExpoPush(token, {title, body, data})` +
  `formatSlotChangesForExpoPush(changes)` (title/body), modeled on
  `src/lib/notifiers/telegram.ts:7`.
- Wire into the send-switch at `src/lib/notifiers/index.ts:132-148` — add
  `else if (channel.type === "expo-push")`. On `DeviceNotRegistered`, deactivate the
  channel (set `active=0`) so dead devices stop being retried.
- Allow the new type in the two whitelists: `src/app/api/channels/route.ts:75` and
  `src/app/api/channels/[id]/route.ts:86` (add `"expo-push"`, validate it looks like an
  `ExponentPushToken[...]`).
- **No migration needed** — reuses `notification_channels.type` + `.destination`
  (destination = the Expo push token). Dedup logic (`index.ts:106-159`) is type-agnostic.

### 1b. Mobile auth — magic-link → deep-link → bearer token
Recommendation: **keep NextAuth as the source of truth and add a thin bearer path** rather
than adopting a new auth SaaS. Rationale (cost/benefit): the backend already invests in
NextAuth + the `isAllowed` allowlist + admin approval + `jose`; bolting on a managed
provider (Clerk/Supabase) means re-plumbing *existing* working auth and running two systems
— that is *more* rewrite, not less. The bridge below is ~2 endpoints + 1 helper and reuses
parts already in the repo. (See "Open decision" — if you'd rather outsource auth wholesale,
Clerk has a first-class Expo SDK and we'd pivot 1b.)

Reuse: `verificationTokens` table (`src/lib/schema.ts:141`), the atomic
`createVerificationToken`/`useVerificationToken` adapter helpers (`src/lib/auth.ts:72-103`),
`jose` (already a dep), `AUTH_SECRET`.

- `POST /api/auth/mobile/start` `{ email }` → (with open signup from 1c) provision/find the
  user, create a verification token, email a link. Email delivery reuses Resend.
- `POST /api/auth/mobile/verify` `{ email, token }` → atomically consume the token, check
  the user is allowed, mint a **long-lived jose-signed JWT** (e.g. 60 days) → return
  `{ token, user }`. App stores it in **`expo-secure-store`**.
- New shared helper `getAuthedUserId(request)` in `src/lib/utils/fetch-helpers.ts`: try
  `auth()` (cookie, unchanged for web) → else verify `Authorization: Bearer <jwt>` via jose.
  Swap the ~7 user routes (`watches`, `watches/[id]`, `channels`, `channels/[id]`,
  `user/me`) from `await auth()` to this helper. **Backwards-compatible** — web cookie flow
  is untouched.
- Deep-link delivery: the email link is an **https universal link** to the existing web
  domain (`/m/auth?token=...`) that opens the app; host the `apple-app-site-association`
  file on the Next app (it's already a web server). Fallback web page with an "Open in app"
  button covers cases where the app isn't installed. (Universal links are more reliable in
  email than raw `myapp://` schemes.)

### 1c. Open signup (App Store requires it)
- Relax the invite-only gate: in `src/lib/auth.ts` allow `signIn` to auto-provision, and
  make the adapter `createUser` (`auth.ts:105`) actually create a user with `isAllowed=1`
  instead of throwing. Keep `isAllowed` as a **ban switch** (admins can set 0 to block).
- The existing waitlist (`registration_requests`, admin approval) becomes optional/legacy.

### 1d. Scraper-health — via off-the-shelf monitoring (protects the whole product)
The real failure mode is a scrape that returns HTTP 200 with **zero/implausible slots**
(silent parser breakage). Today that's invisible: `stats.venuesSuccess` counts a 0-slot run
as success (`src/app/api/cron/scrape/route.ts:76`), and alerts only fire on thrown errors.
Off-the-shelf approach (minimal custom code):
- **Healthchecks.io dead-man's-switch** (free; `10s-worker` already uses this pattern):
  ping success only when a run scraped `> 0` plausible slots for the always-populated
  venues; a missed ping alarms you. Add the ping at the existing hook point
  `src/app/api/cron/scrape/route.ts:82-92` (where `allSlots` + `stats` exist).
- **Sentry** (free tier) for exception/error tracking on both scrape and API routes.
- Only the per-venue "0 vs baseline" count check is custom (a few lines aggregating
  `allSlots` by venue); alert *delivery* is off-the-shelf. No new table for v1.

---

## Phase 2 — Expo app (new repo — must be added to this session first)

Off-the-shelf stack, minimal bespoke code:
- **Expo (managed) + Expo Router** — file-based nav, OTA updates, build tooling.
- **expo-notifications** — push registration + handling (the whole point).
- **expo-secure-store** — token storage.
- **TanStack Query** — data fetching/caching/refresh against existing REST endpoints
  (don't hand-roll fetch/state).
- **NativeWind** — Tailwind for RN (matches the web app's Tailwind), + a component kit
  (e.g. `gluestack`/`react-native-paper`) instead of hand-building UI primitives.
- Screens map 1:1 to existing APIs: login (magic link) → venue list (`GET /api/venues`) →
  availability (`GET /api/availability`) → watches CRUD (`/api/watches`) → notification
  settings (`/api/channels`, registers the push token) → account (`/api/user/me`).
- Ship iOS first via **TestFlight**, then App Store. Expo makes Android near-free later.

---

## Phase 3 — Monetization plumbing (later, when validated)
- **RevenueCat** (off-the-shelf; free under ~$2.5k/mo revenue) for App Store/Play
  subscriptions + entitlements — do NOT hand-roll billing. Freemium: free = 1 venue /
  standard checks; Pro (£2.99–3.99/mo) = all venues + instant push.
- Gate "all venues / instant" server-side off a `users.plan` flag set from RevenueCat
  webhooks.

---

## Off-the-shelf parts & cost summary

| Need | Part | Cost |
|---|---|---|
| Push delivery | Expo Push + `expo-server-sdk` | Free |
| Token storage | expo-secure-store | Free |
| App nav/build/OTA | Expo + Expo Router | Free |
| Data fetching | TanStack Query | Free |
| UI | NativeWind + component kit | Free |
| Health alarm | Healthchecks.io | Free tier |
| Error tracking | Sentry | Free tier |
| Email | Resend (already used) | Existing |
| Subscriptions (Ph3) | RevenueCat | Free < ~$2.5k/mo |
| App Store | Apple Developer | £79/yr |
| Auth | reuse NextAuth + jose (in-repo) | £0 (vs Clerk free < 10k MAU) |

---

## Verification
- **Push:** unit-test `formatSlotChangesForExpoPush`; end-to-end, register a real device
  token via `POST /api/channels {type:"expo-push"}`, run a scrape that frees a watched slot
  (or a manual `notifyUsers` call), confirm the device receives it and `notification_log`
  has the row. Test `DeviceNotRegistered` → channel deactivates.
- **Mobile auth:** `POST /api/auth/mobile/start` → capture emailed token →
  `/api/auth/mobile/verify` → call `GET /api/user/me` with the bearer JWT (200) and without
  (401). Confirm the web cookie flow still works (regression).
- **Open signup:** a brand-new email can request a link and log in without admin approval;
  setting `isAllowed=0` blocks them.
- **Health alarm:** simulate a 0-slot scrape → Healthchecks.io ping is withheld / alert fires.
- Run existing `npm test` (vitest) + `npm run build` (which also runs `db:migrate`).

## Open decision (confirm at approval)
**Auth: build the thin bridge (recommended) vs. adopt Clerk.** I recommend the in-repo
bridge because it reuses working auth and avoids running two systems — cheaper and less
rewrite here. If you'd rather fully outsource auth (and accept migrating web auth too),
say so and I'll swap Phase 1b for Clerk's Expo SDK.

## Sequencing note
Phase 1 is buildable now in `10s-court-monitor` on branch
`claude/iphone-app-viability-j61f5y`. Phase 2 needs the new Expo repo added to this session
before I can scaffold it.
