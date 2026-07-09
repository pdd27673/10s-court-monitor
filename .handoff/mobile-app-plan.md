# Plan: Time for Tennis — Expo/React Native app (reliable push)

Status-annotated plan. `[x]` done, `[~]` partial, `[ ]` not started.
See `HANDOFF.md` for exact branch/commit state.

## Context

`10s-court-monitor` is a multi-user Next.js 16 + Drizzle/SQLite backend + web app
with magic-link auth (NextAuth JWT + Resend), watches/channels CRUD, two scrapers
(Courtside + ClubSpark), and a pluggable notifier fan-out. The goal is a phone app
whose core value is **reliable push** ("get pinged the second a court frees up") —
iOS web push is too unreliable, so we go native via **Expo**. The app is a thin
client over existing REST APIs. The booker (`10s-worker`) stays private.

Guiding principle: use well-engineered off-the-shelf parts; don't rewrite wheels.

## Architecture

```
Expo app (expo-notifications) --registers--> device push token
   --Bearer JWT--> Next.js REST API --> stores token as a
                                        notification_channel (type "expo-push")
scraper --> differ --> notifyUsers() fan-out
   --> expo-server-sdk --> Expo Push API --> APNs/FCM --> device buzzes
```

Push is a **third notification-channel type** next to telegram/email, reusing the
whole watch-match + dedup pipeline (`notification_log`) unchanged.

## Phase 1 — Backend bridge (`10s-court-monitor`) — DONE

- [x] **Expo push channel** — `expo-server-sdk` sender, wired into the fan-out;
  `DeviceNotRegistered` deactivates dead channels. Sends `data.type =
  "slot-available"`.
- [x] **Mobile auth** — `/api/auth/mobile/start` + `/verify`, jose 60-day bearer
  tokens, `getAuthedUserId` (cookie OR bearer) on all user routes. Web cookie
  flow untouched (backwards-compatible).
- [x] **Open signup** — NextAuth auto-provisions users with `isAllowed=1`;
  `isAllowed` stays a ban switch.
- [x] **Scraper-health alarm** — flags 0-slot silent parser breakage via
  Healthchecks.io + admin email.
- [x] **Deep-link delivery** — `/m/auth` https bridge → `10smobile://auth`.
- [~] **Universal Links** — NOT built. Needs Apple Team ID + an
  `apple-app-site-association` file + `ios.associatedDomains`. Optional; the
  scheme bridge works today.

Verified: tsc clean, vitest 31/31, next build green.

## Phase 2 — Expo app (`10s-mobile`) — DONE (not yet device-tested)

- [x] Expo Router nav, TanStack Query, expo-secure-store, expo-notifications.
- [x] Screens map 1:1 to APIs: login → courts (`/api/venues`, `/api/availability`)
  → alerts (`/api/watches`) → settings (`/api/channels`, `/api/user/me`).
- [x] Push registration + **tap/foreground routing** (`use-notifications.ts`).
- [x] API base = `https://timefor10s.com`; `eas.json` profiles present.
- [x] Reused the Expo template theming instead of adding NativeWind.
- [ ] **EAS dev build + on-device push/auth test** — needs Apple account + phone.

## Shared API contract — DONE

**Decision (latest rec):** keep the two repos separate; the only real coupling is
the API contract, so share it as a **published types package**, not a monorepo.

- [x] `@pdd27673/10s-contract` — source of truth in
  `10s-court-monitor/packages/contract`; backend routes AND the app import from it.
- [x] Published to **GitHub Packages** via a `contract-v*` tag
  (`publish-contract.yml`). `v0.1.0` published.
- [x] App consumes `^0.1.0`; `.npmrc` scopes `@pdd27673` to GitHub Packages.
- [ ] EAS `NODE_AUTH_TOKEN` secret so cloud builds can install it.

Why not a monorepo: Expo/Metro + Next in one workspace is fiddly; the two ship on
different pipelines (Railway vs EAS); the app is a thin REST client. Revisit only
if atomic "API + app in one PR" changes or shared zod validation become frequent —
then npm workspaces with `apps/web`, `apps/mobile`, `packages/api-contract`.

## Phase 3 — Monetization (later, when validated)

- [ ] **RevenueCat** (off-the-shelf) for App Store/Play subs + entitlements.
  Freemium: free = 1 venue; Pro £2.99–3.99/mo = all venues + instant push.
  Gate server-side off a `users.plan` flag from RevenueCat webhooks.

## Off-the-shelf parts

| Need | Part | Cost |
|---|---|---|
| Push delivery | Expo Push + `expo-server-sdk` | Free |
| Token storage | expo-secure-store | Free |
| Nav/build/OTA | Expo + Expo Router | Free |
| Data fetching | TanStack Query | Free |
| Shared types | GitHub Packages (`@pdd27673/10s-contract`) | Free |
| Health alarm | Healthchecks.io | Free tier |
| Email | Resend (existing) | Existing |
| Subscriptions (Ph3) | RevenueCat | Free < ~$2.5k/mo |
| App Store | Apple Developer | £79/yr |
| Auth | reuse NextAuth + jose (in-repo) | £0 |

## Remaining critical path

1. Confirm `contract-v0.1.0` published; add EAS `NODE_AUTH_TOKEN` secret.
2. EAS dev build → on-device push + auth end-to-end test.
3. Merge `feat/mobile-impl` → `main` (both repos) to deploy the backend so
   `timefor10s.com` serves the app.
4. Optional: Universal Links (needs Apple Team ID); doc consolidation to
   `timefor10s.com`.
