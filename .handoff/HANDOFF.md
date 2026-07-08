# Handoff — iPhone app (Time for Tennis)

Continuation notes for resuming the "turn the monitor into an Expo/React Native
app" work in a fresh session. Read this first.

_Last updated: 2026-07-08._

## TL;DR

- **Backend bridge (Phase 1): DONE and pushed** to this repo
  (`10s-court-monitor`) on branch `claude/iphone-app-viability-j61f5y`.
- **Mobile app (Phase 2 scaffold): DONE but NOT pushed** to `pdd27673/10s-mobile`
  — the push was blocked (see "Blocker"). The entire app is preserved here as a
  git bundle: `.handoff/10s-mobile.bundle`.
- **Plan** lives at `.handoff/mobile-app-plan.md`.

## Decisions already made (don't re-litigate)

- Only the **monitor** becomes an app; the **booker (`10s-worker`) stays private**.
- **Expo / React Native** (chosen for reliable native push; iOS web push is too flaky).
- **Auth: thin bridge on existing NextAuth** (not Clerk) — reuse working auth.
- **Open signup** (App Store needs it); `isAllowed` kept as a ban switch.
- **Off-the-shelf first**: reuse libraries/services over hand-rolling. In the app
  we reused the Expo template's theming instead of adding NativeWind.
- Mobile app lives in a **separate repo** (`pdd27673/10s-mobile`).

## What's built — backend (`10s-court-monitor`, this repo)

Branch `claude/iphone-app-viability-j61f5y`. Commits:

- `expo-push notification channel` — third channel type alongside telegram/email
  using `expo-server-sdk`; wired into `notifyUsers` fan-out; auto-deactivates
  dead devices (`DeviceNotRegistered`). Reuses the existing watch-match + dedup
  pipeline. Files: `src/lib/notifiers/expo-push.ts`, `notifiers/index.ts`,
  `api/channels/route.ts`, `api/channels/[id]/route.ts`.
- `mobile bearer auth + open signup` — `src/lib/mobile-token.ts` (jose,
  60-day tokens, `mobile` audience), `src/lib/mobile-auth.ts`
  (`getAuthedUserId` = cookie OR bearer), endpoints
  `POST /api/auth/mobile/start` + `/verify`, `src/lib/users.ts`
  (`findOrCreateAllowedUser`). All user API routes now accept cookie or bearer.
  NextAuth adapter `createUser` now provisions allowed users.
- `scraper-health alarm` — `src/lib/health.ts` flags "scraped targets but ~0
  slots" (silent parser breakage), pings Healthchecks.io + emails admin. Wired
  in `api/cron/scrape/route.ts`.
- `/m/auth deep-link bridge` — `src/app/m/auth/page.tsx` + `redirect.tsx`; the
  sign-in email links here (https), which opens the app via `10smobile://auth`.

Verified: `tsc` clean, `eslint` (only 2 pre-existing warnings), 31 vitest tests
pass, `next build` succeeds.

**Env vars to set for production** (see `.env.example`): `NEXT_PUBLIC_APP_URL`
(deep-link base), and optionally `EXPO_ACCESS_TOKEN`, `SCRAPE_HEALTHCHECK_URL`,
`ADMIN_EMAIL`, `SCRAPE_MIN_SLOTS_PER_TARGET`. `AUTH_SECRET` + Resend already exist.

## What's built — mobile app (in `.handoff/10s-mobile.bundle`)

Expo SDK 57, expo-router, TanStack Query, expo-notifications, expo-secure-store.
Branch `claude/iphone-app-viability-j61f5y`, commit `7c5dac3`.
Screens: login + check-email; authed tabs = courts (availability), alerts
(watch CRUD), settings (account/push/sign-out). Auth via SecureStore + magic-link
deep link. Push registers the Expo token as an `expo-push` channel.
Verified: `tsc` clean, `expo export` bundles (1218 modules). NOT yet run on a device.

### Restore the mobile app in a new session

```bash
# The repo (with full history + both branches) is in this bundle:
git clone .handoff/10s-mobile.bundle 10s-mobile
cd 10s-mobile
git checkout claude/iphone-app-viability-j61f5y
npm install
# then set the real remote and push once the repo is in session scope:
git remote set-url origin <10s-mobile git URL>
git push -u origin claude/iphone-app-viability-j61f5y
```

## Blocker (why the app isn't on GitHub yet)

Pushing to `pdd27673/10s-mobile` returned `403` from the git proxy because the
repo wasn't in the session's scope, and the `add_repo` MCP call that would add it
kept failing with "requires approval" (the approval channel was not delivering —
same issue that hit ExitPlanMode / AskUserQuestion this session). **To resume:**
add `pdd27673/10s-mobile` to the new session (approve the add-repo prompt), then
restore from the bundle and push.

## What's left (next steps, priority order)

1. **Push the mobile app** to `pdd27673/10s-mobile` (restore from bundle above).
2. **Point the app at the deployed backend**: set `expo.extra.apiUrl` in
   `app.json` (or `EXPO_PUBLIC_API_URL`).
3. **EAS dev build for push testing** — `eas build:configure` (writes the push
   `projectId` into `app.json` → `extra.eas.projectId`), then
   `eas build --profile development` and test push on a real device (Expo Go
   can't receive push for a custom project). Consider adding `eas.json` profiles.
4. **End-to-end auth test** on device: start → email → deep link → verify → API.
5. **(Optional) Universal Links** — add backend domain to `ios.associatedDomains`
   + host `apple-app-site-association`, to skip the bridge page.
6. **Phase 3 — monetization** (later): RevenueCat freemium (free = 1 venue;
   Pro £2.99–3.99/mo = all venues + instant push). Gate server-side off a
   `users.plan` flag from RevenueCat webhooks.

## Once resolved

Delete this `.handoff/` folder once `10s-mobile` is pushed — it's temporary
staging, not part of the backend.
