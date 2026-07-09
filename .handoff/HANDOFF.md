# Handoff — Time for Tennis mobile app

Continuation notes for resuming the "turn the monitor into an Expo/React Native
app" work in a fresh session. Read this first, then `mobile-app-plan.md`.

_Last updated: 2026-07-09._

## TL;DR

- **All active work lives on the `feat/mobile-impl` branch in BOTH repos.**
  Never commit this work straight to `main`.
  - `pdd27673/10s-court-monitor` @ `feat/mobile-impl` — backend + web + shared contract
  - `pdd27673/10s-mobile` @ `feat/mobile-impl` — the Expo app
- The **shared API contract** is a published package: `@pdd27673/10s-contract`
  (GitHub Packages), source of truth in `10s-court-monitor/packages/contract`.
- **Not merged to `main` / not deployed yet.** `main` still lacks the Phase-1
  mobile backend, so production `timefor10s.com` cannot serve the app until
  `feat/mobile-impl` is merged and deployed (see "Blockers").

## The codebases

| Repo | What it is | Relevance |
|---|---|---|
| `10s-court-monitor` | Next.js 16 + Drizzle/SQLite backend **and** web app. Serves `timefor10s.com` (custom domain on Railway) and all `/api/*`. Hosts `packages/contract`. | Primary — backend bridge + web |
| `10s-mobile` | Expo SDK 57 / React Native app (expo-router, TanStack Query, expo-notifications, expo-secure-store). Thin REST client. | The phone app |
| `10s-worker` | The private booking bot. **Out of scope — stays private.** | Do not touch |
| `tennis-booker` | Older/related project. Not part of this effort. | Ignore |

Backend hosts: public `https://timefor10s.com`; Railway origin
`https://10s-court-monitor-production.up.railway.app`. Both serve the same
Next.js app, so `/api/*` is available on `timefor10s.com`.

## Decisions already made (don't re-litigate)

- Only the **monitor** becomes an app; the **booker (`10s-worker`) stays private**.
- **Expo / React Native** (chosen for reliable native push; iOS web push too flaky).
- **Auth: thin bearer bridge on existing NextAuth** (not Clerk) — reuse working auth.
- **Open signup** (App Store needs it); `isAllowed` kept as a ban switch.
- **Separate repos, NOT a monorepo.** The only real coupling is the API contract,
  so it's shared as a published types package instead of merging repos.
- **Shared types via GitHub Packages**, source of truth in the backend repo
  (`packages/contract`), consumed by both the backend routes and the app.
- **All work on `feat/mobile-impl` branches**, never pushed straight to `main`.

## What's built and where

### `10s-court-monitor` @ `feat/mobile-impl` (tip `6dc5e75`)
`main` + the shared contract (`a9f1c72`) + 4 Phase-1 backend commits rebased on top:
- `expo-push` notification channel — third channel type alongside telegram/email
  via `expo-server-sdk`; wired into `notifyUsers` fan-out with `data.type =
  "slot-available"`; auto-deactivates dead devices (`DeviceNotRegistered`).
  Files: `src/lib/notifiers/expo-push.ts`, `notifiers/index.ts`, `channels` routes.
- Mobile bearer auth + open signup — `src/lib/mobile-token.ts` (jose, 60-day
  tokens), `src/lib/mobile-auth.ts` (`getAuthedUserId` = cookie OR bearer),
  `POST /api/auth/mobile/start` + `/verify`, `src/lib/users.ts`. All user API
  routes accept cookie or bearer. NextAuth `createUser` provisions allowed users.
- Scraper-health alarm — `src/lib/health.ts` flags "scraped but ~0 slots"
  (silent parser breakage), pings Healthchecks.io + emails admin.
- `/m/auth` deep-link bridge — `src/app/m/auth/page.tsx` + `redirect.tsx`; the
  sign-in email links here (https), which opens the app via `10smobile://auth`.

The route files that both the contract commit and Phase-1 touched
(`watches`, `channels`, `user/me`) were merged so they use **both**
`getAuthedUserId` (bearer) **and** the contract types.

Verified on this branch: `tsc --noEmit` clean, `vitest` 31/31 pass (incl.
expo-push, mobile-token, health), `next build` green (all mobile routes compile).

### `10s-mobile` @ `feat/mobile-impl` (tip `a15f158`)
Expo SDK 57 app. Screens: login + check-email; authed tabs = courts
(availability), alerts (watch CRUD), settings (account/push/sign-out). Auth via
SecureStore + magic-link deep link. Push registers the Expo token as an
`expo-push` channel; notification taps + foreground arrivals route/refresh the
Courts tab (`src/lib/use-notifications.ts`).
- API base = `https://timefor10s.com` (`app.json` → `extra.apiUrl`;
  override with `EXPO_PUBLIC_API_URL`).
- API types imported from `@pdd27673/10s-contract` (`src/lib/api.ts`) — no more
  hand-written/drifting types.
- `eas.json` build profiles present (development/preview/production).
- Contract dep = `"@pdd27673/10s-contract": "^0.1.0"` (published GitHub Packages
  version). `.npmrc` maps the `@pdd27673` scope to `npm.pkg.github.com` and reads
  `NODE_AUTH_TOKEN`.

### Shared contract — `@pdd27673/10s-contract`
- Source of truth: `10s-court-monitor/packages/contract/src/index.ts`
  (Venue, AvailabilitySlot, Watch, Channel, Me + response wrappers).
- Published to GitHub Packages by `.github/workflows/publish-contract.yml`,
  triggered by pushing a `contract-v*` tag. First version `0.1.0` published
  from tag `contract-v0.1.0`.
- Ships raw `.ts` (no build); fine because both sides use `import type`.

### Production env (set by the owner on Railway)
`AUTH_URL`, `NEXT_PUBLIC_APP_URL`, `NEXTAUTH_URL` = `https://timefor10s.com`.
`AUTH_SECRET` + Resend already existed. Optional: `EXPO_ACCESS_TOKEN`,
`SCRAPE_HEALTHCHECK_URL`, `ADMIN_EMAIL`, `SCRAPE_MIN_SLOTS_PER_TARGET`.

## Blockers / environment quirks

- **`main` has none of this.** `feat/mobile-impl` is not merged. Until it is
  merged and deployed, `timefor10s.com` returns 404 on `/api/auth/mobile/*` and
  rejects bearer tokens on watches/channels — the app is non-functional against
  prod. Merging `feat/mobile-impl` → `main` triggers the Railway deploy.
- **The web session's git proxy blocks tag pushes** (HTTP 403 on tag refs;
  branch pushes work). Publish new contract versions by pushing the
  `contract-v*` tag **from a local machine**, not from a web session.
- **No `read:packages` token in the web sandbox**, so the app's published
  contract dep can't be `npm install`-verified here. First real install is an
  EAS build or a local `NODE_AUTH_TOKEN=… npm install`.

## What's left (priority order)

1. **Confirm `contract-v0.1.0` published** (Actions → "Publish contract" run is
   green) and that `npm view @pdd27673/10s-contract` resolves with a token.
2. **EAS: add `NODE_AUTH_TOKEN` secret** (PAT with `read:packages`) so cloud
   builds can install the contract:
   `eas secret:create --name NODE_AUTH_TOKEN --value <token>`.
3. **EAS dev build for push testing** — `eas build:configure` (writes
   `extra.eas.projectId` into `app.json` → COMMIT it), then
   `eas build --profile development`; test push on a real device (Expo Go can't
   receive push for a custom project).
4. **End-to-end auth test on device**: start → email → deep link → verify → API.
5. **Merge `feat/mobile-impl` → `main` in both repos** (open PRs), which deploys
   the backend so `timefor10s.com` actually serves the app.
6. **(Optional) Universal Links** — needs the **Apple Team ID**: set
   `app.json` `ios.associatedDomains = ["applinks:timefor10s.com"]` and serve
   `/.well-known/apple-app-site-association` from the backend, to skip the
   `/m/auth` bridge page.
7. **(Optional) doc consolidation** — `.env.example` / `README` in
   `10s-court-monitor` still show `your-app.railway.app`; update to
   `https://timefor10s.com` (code already defaults to it in robots/sitemap).
8. **Phase 3 — monetization** (later): RevenueCat freemium (free = 1 venue;
   Pro £2.99–3.99/mo = all venues + instant push). Gate server-side off a
   `users.plan` flag from RevenueCat webhooks.

## Working agreements for the next session

- Branch off / commit to `feat/mobile-impl` in each repo. Do not push to `main`.
- Publish contract changes: bump `packages/contract`, push a `contract-v<x.y.z>`
  tag **locally**, then bump the app's `^` range if needed.
- Keep the contract the single source of truth — add a field to a route? add it
  to `packages/contract` first, then the route and the app consume it.
