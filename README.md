# Tennis Court Notifier

[![CI](https://github.com/pdd27673/10s-court-monitor/actions/workflows/ci.yml/badge.svg)](https://github.com/pdd27673/10s-court-monitor/actions/workflows/ci.yml)
[![codecov](https://codecov.io/gh/pdd27673/10s-court-monitor/branch/main/graph/badge.svg)](https://codecov.io/gh/pdd27673/10s-court-monitor)

A notification service that monitors tennis court availability across London venues (Courtside and ClubSpark platforms) and alerts users via Telegram or Email when slots become available.

## Table of Contents

- [Quick Start](#quick-start)
- [Environment Variables](#environment-variables)
- [Database Setup](#database-setup)
- [Adding Users](#adding-users)
- [Managing Watches](#managing-watches)
- [Notification Channels](#notification-channels)
- [Running the Scraper](#running-the-scraper)
- [Cron Job Setup](#cron-job-setup)
- [Deployment](#deployment)
- [API Reference](#api-reference)
- [Troubleshooting](#troubleshooting)

---

## Quick Start

```bash
# Install dependencies
npm install

# Copy environment file and configure
cp .env.example .env

# Generate database migrations
npm run db:generate

# Run migrations
npm run db:migrate

# Seed the database (creates test user)
npm run db:seed

# Start development server
npm run dev
```

The app will be available at http://localhost:3000

---

## Environment Variables

Create a `.env` file based on `.env.example`:

```bash
# Database (SQLite - file path)
DATABASE_URL=file:./data/tennis.db

# Cron job protection (generate a random string)
CRON_SECRET=your-random-secret-here

# Telegram Bot (get from @BotFather on Telegram)
TELEGRAM_BOT_TOKEN=123456:ABC-xxxxx

# Email via Resend (HTTP API - works on Railway/cloud)
# Sign up at https://resend.com (free: 3000 emails/month)
RESEND_API_KEY=re_xxxxxxxxxxxx
EMAIL_FROM=Time for Tennis <hello@timefor10s.com>

# Auth secret (generate a random string)
AUTH_SECRET=your-random-secret-here

# App URL (for links in notifications)
NEXT_PUBLIC_APP_URL=http://localhost:3000
```

### Setting up Resend

1. Sign up at [resend.com](https://resend.com) (free tier: 3000 emails/month)
2. Create an API key in the dashboard
3. Copy the API key to `RESEND_API_KEY`
4. Optionally verify a domain to customize the sender address in `EMAIL_FROM`

### Setting up Telegram Bot

1. Open Telegram and message [@BotFather](https://t.me/BotFather)
2. Send `/newbot` and follow prompts
3. Copy the token to `TELEGRAM_BOT_TOKEN`
4. **Set up the webhook** (see [Telegram Webhook Setup](#telegram-webhook-setup) below)
5. To get your chat ID, message your bot (e.g., [@MvgMonitorBot](https://t.me/MvgMonitorBot)) - it will automatically respond with your Chat ID

---

## Telegram Webhook Setup

The Telegram bot requires a webhook to be configured so it can receive messages from users and respond with their Chat ID.

### Quick Setup

After deploying your app, run:

```bash
npx tsx scripts/setup-telegram-webhook.ts
```

**Requirements:**
- `TELEGRAM_BOT_TOKEN` must be set in environment
- `NEXT_PUBLIC_APP_URL` or `AUTH_URL` must be set to your deployed app URL
- The webhook endpoint must be publicly accessible

### What It Does

The setup script:
1. Checks if the webhook is already configured correctly
2. Only updates the webhook if the URL has changed or isn't set
3. Verifies the configuration and shows any errors

### When to Run It

You **only need to run it:**
- Once after initial deployment
- If you change your app URL (`NEXT_PUBLIC_APP_URL`)
- If you need to reset/update the webhook

The webhook persists on Telegram's servers, so you don't need to run it every time you deploy.

### Testing

1. Message your bot: [@MvgMonitorBot](https://t.me/MvgMonitorBot)
2. Send any message (e.g., "Hello")
3. The bot will respond with your Chat ID and a link to the dashboard
4. Use that Chat ID when creating a Telegram notification channel

### Troubleshooting

**Bot not responding:**
- Run the webhook setup script: `npx tsx scripts/setup-telegram-webhook.ts`
- Check webhook status: `curl https://api.telegram.org/bot$TELEGRAM_BOT_TOKEN/getWebhookInfo`
- Verify your app URL is accessible: `curl https://your-app.railway.app/api/telegram/webhook`
- Check deployment logs for errors

**Webhook errors:**
- Ensure `NEXT_PUBLIC_APP_URL` matches your actual deployment URL
- Verify the `/api/telegram/webhook` endpoint is deployed
- Check that `TELEGRAM_BOT_TOKEN` is correct

---

## Database Setup

The app uses SQLite with Drizzle ORM. The database file is stored at `data/tennis.db`.

```bash
# Generate migrations from schema changes
npm run db:generate

# Apply migrations
npm run db:migrate

# Seed with test data
npm run db:seed

# Open Drizzle Studio (database GUI)
npm run db:studio
```

### Database Schema

- **users** - User accounts (email)
- **venues** - Tennis court venues (10 London locations across Tower Hamlets, Waltham Forest, and Newham)
- **slots** - Court availability (time, court, status, price)
- **watches** - User alert preferences (venue, times, weekday filters)
- **notification_channels** - Where to send alerts (telegram, email)
- **notification_log** - Sent notification history (prevents duplicates)

---

## Adding Users

### Option 1: Using the seed script

Edit `scripts/seed.ts` and run:

```bash
npx tsx scripts/seed.ts
```

### Option 2: Direct database insertion

```typescript
// Using Drizzle
import { db } from "./src/lib/db";
import { users } from "./src/lib/schema";

await db.insert(users).values({
  email: "user@example.com"
});
```

### Option 3: SQL via sqlite3

```bash
sqlite3 data/tennis.db

INSERT INTO users (email) VALUES ('user@example.com');
```

### Option 4: Via API (if authenticated)

```bash
# POST to create user (requires auth implementation)
curl -X POST http://localhost:3000/api/users \
  -H "Content-Type: application/json" \
  -d '{"email": "user@example.com"}'
```

---

## Managing Watches

A "watch" defines what slots a user wants to be notified about.

### Creating a Watch

```typescript
import { db } from "./src/lib/db";
import { watches } from "./src/lib/schema";

await db.insert(watches).values({
  userId: 1,                                    // User ID
  venueId: null,                                // null = all venues, or specific venue ID
  preferredTimes: JSON.stringify(["5pm", "6pm", "7pm", "8pm"]),  // Preferred times (am/pm format)
  weekdaysOnly: 1,                              // 1 = only weekdays
  weekendsOnly: 0,                              // 1 = only weekends
  active: 1                                     // 1 = active, 0 = paused
});
```

### Watch Options

| Field | Description |
|-------|-------------|
| `userId` | The user to notify |
| `venueId` | `null` for all venues, or specific venue ID (1-7) |
| `preferredTimes` | JSON array of times like `["5pm", "6pm"]` or `null` for any time |
| `weekdaysOnly` | `1` to only notify on Mon-Fri |
| `weekendsOnly` | `1` to only notify on Sat-Sun |
| `active` | `1` to enable, `0` to pause |

### Venue IDs

| ID | Venue |
|----|-------|
| 1 | Bethnal Green Gardens |
| 2 | King Edward Memorial Park |
| 3 | Poplar Rec Ground |
| 4 | Ropemakers Field |
| 5 | St Johns Park |
| 6 | Victoria Park |
| 7 | Wapping Gardens |

---

## Notification Channels

### Adding Email Channel

```typescript
await db.insert(notificationChannels).values({
  userId: 1,
  type: "email",
  destination: "user@example.com",
  active: 1
});
```

### Adding Telegram Channel

```typescript
await db.insert(notificationChannels).values({
  userId: 1,
  type: "telegram",
  destination: "123456789",  // Telegram chat ID
  active: 1
});
```

### Testing Notifications

```bash
# Test email
npx tsx -e "
import { sendEmailNotification } from './src/lib/notifiers/email';
await sendEmailNotification('your@email.com', 'Test', '<p>Test notification</p>');
"

# Test telegram
npx tsx -e "
import { sendTelegramNotification } from './src/lib/notifiers/telegram';
await sendTelegramNotification('YOUR_CHAT_ID', 'Test notification');
"
```

---

## Running Ingestion

### Manual Trigger (Development)

```bash
# Trigger a full ingest cycle via API (GET works in dev mode)
curl http://localhost:3000/api/cron/scrape

# Read-only previews of the individual clocks (write nothing):
npx tsx scripts/poll-slots-preview.ts      # Clock 1 feed head-poll
npx tsx scripts/reconcile-run-preview.ts   # Clock 2 watch-targeted reconcile
npx tsx scripts/sweep-preview.ts           # Clock 3 daily full sweep
```

### What Ingestion Does

The Courtside path is **feed-primary** (official OpenActive RPDE change-feed), with
a scoped HTML scrape kept only as a correctness backstop. One cron tick runs three
clocks (see `docs/REARCHITECTURE-PLAN.md`):

1. **Clock 1 — feed head-poll:** apply RPDE deltas to the `slots` table (no HTML)
2. **Clock 2 — watch-targeted reconcile:** scrape a bounded round-robin of the
   watched venue-days the feed shows as taken (site wins on any disagreement)
3. **Clock 3 — daily full sweep:** scrape every active Courtside venue-day as the
   dashboard floor + feed-drop safety net

All three detect newly available slots (was booked/closed -> now available) and
notify users whose watches match.

---

## Cron Job Setup

### Local Development (node-cron)

Add to your start script or run separately:

```typescript
import cron from 'node-cron';

// Every 10 minutes between 7am-10pm
cron.schedule('*/10 7-22 * * *', async () => {
  await fetch('http://localhost:3000/api/cron/scrape', {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${process.env.CRON_SECRET}` }
  });
});
```

### Railway Deployment

Add to `railway.json`:

```json
{
  "build": { "builder": "NIXPACKS" },
  "deploy": {
    "startCommand": "npm start"
  },
  "cron": {
    "scrape": {
      "schedule": "*/10 7-22 * * *",
      "command": "curl -X POST -H 'Authorization: Bearer $CRON_SECRET' $RAILWAY_STATIC_URL/api/cron/scrape"
    }
  }
}
```

### Vercel Cron

Create `vercel.json`:

```json
{
  "crons": [
    {
      "path": "/api/cron/scrape",
      "schedule": "*/10 7-22 * * *"
    }
  ]
}
```

### External Cron Services

Use services like [cron-job.org](https://cron-job.org) or [EasyCron](https://www.easycron.com):

```
URL: https://your-app.railway.app/api/cron/scrape
Method: POST
Header: Authorization: Bearer YOUR_CRON_SECRET
Schedule: */10 7-22 * * *
```

---

## Deployment

### Railway (Recommended)

1. Create a Railway account at [railway.app](https://railway.app)

2. Connect your GitHub repo or use Railway CLI:
   ```bash
   npm i -g @railway/cli
   railway login
   railway init
   ```

3. Add a persistent volume for SQLite:
   ```bash
   railway volume add --mount /app/data
   ```

4. Set environment variables in Railway dashboard:
   - `DATABASE_URL=file:./data/tennis.db`
   - `CRON_SECRET=your-secret`
   - `TELEGRAM_BOT_TOKEN=your-token`
   - `RESEND_API_KEY=your-resend-api-key`
   - `EMAIL_FROM=Time for Tennis <hello@timefor10s.com>` (must be verified domain)
   - `AUTH_SECRET=your-auth-secret`
   - `AUTH_URL=https://your-app.railway.app`
   - `NEXT_PUBLIC_APP_URL=https://your-app.railway.app`

5. Deploy:
   ```bash
   railway up
   ```

6. **Set up Telegram webhook** (after deployment):
   ```bash
   npx tsx scripts/setup-telegram-webhook.ts
   ```
   See [Telegram Webhook Setup](#telegram-webhook-setup) for details.

### Vercel

1. Install Vercel CLI:
   ```bash
   npm i -g vercel
   ```

2. Deploy:
   ```bash
   vercel
   ```

3. Set environment variables in Vercel dashboard

**Note**: Vercel's serverless environment has limitations with SQLite. Consider using Turso or another managed SQLite solution for production.

### Fly.io

1. Install flyctl and authenticate

2. Create `fly.toml`:
   ```toml
   app = "tennis-notifier"

   [build]
     builder = "heroku/buildpacks:20"

   [env]
     NODE_ENV = "production"

   [mounts]
     source = "data"
     destination = "/app/data"
   ```

3. Create volume and deploy:
   ```bash
   fly volumes create data --size 1
   fly deploy
   ```

---

## API Reference

### GET /api/venues

List all venues.

```bash
curl http://localhost:3000/api/venues
```

### GET /api/availability

Get availability for a venue and date.

```bash
curl "http://localhost:3000/api/availability?venue=victoria-park&date=2025-01-21"
```

### GET /api/watches

List watches (requires user context).

### POST /api/watches

Create a watch.

```bash
curl -X POST http://localhost:3000/api/watches \
  -H "Content-Type: application/json" \
  -d '{
    "userId": 1,
    "venueId": null,
    "preferredTimes": ["6pm", "7pm"],
    "weekdaysOnly": true
  }'
```

### GET /api/channels

List notification channels.

### POST /api/channels

Add a notification channel.

### POST /api/cron/scrape

Trigger a scrape job. Protected by `CRON_SECRET` in production.

```bash
curl -X POST http://localhost:3000/api/cron/scrape \
  -H "Authorization: Bearer YOUR_CRON_SECRET"
```

---

## Troubleshooting

### Scraper returns no slots

1. Check if the website structure changed
2. Test manually: `curl https://tennistowerhamlets.com/book/courts/victoria-park/2025-01-21`
3. Run test script: `npx tsx scripts/test-scraper.ts`

### Notifications not sending

1. Check env vars are set correctly
2. Test notification channels individually (see Testing Notifications section)
3. Check notification log for duplicates (same slot won't notify twice)

### Database locked errors

SQLite uses WAL mode for better concurrency, but heavy writes can still cause locks:

1. Ensure only one scraper process runs at a time
2. Check for long-running transactions
3. Consider using Turso for production

### Email not sending

1. Check `RESEND_API_KEY` is set correctly
2. Verify your Resend account is active
3. Check the Resend dashboard for delivery logs

### Telegram bot not responding

1. **Set up the webhook** (see [Telegram Webhook Setup](#telegram-webhook-setup) section)
2. Verify token with: `curl https://api.telegram.org/bot<TOKEN>/getMe`
3. Check webhook status: `curl https://api.telegram.org/bot<TOKEN>/getWebhookInfo`
4. Run webhook setup script: `npx tsx scripts/setup-telegram-webhook.ts`
5. Message the bot to get your Chat ID (it will respond automatically)
6. Ensure you've started a conversation with the bot
7. Check deployment logs for webhook errors

---

## Project Structure

```
packages/
└── contract/                 # @pdd27673/10s-contract (GitHub Packages)
    └── src/index.ts          # Shared REST response/request types
src/
├── app/
│   ├── page.tsx              # Landing page
│   ├── dashboard/
│   │   └── page.tsx          # Availability dashboard
│   └── api/
│       ├── availability/     # GET availability
│       ├── venues/           # GET venues
│       ├── watches/          # CRUD watches
│       ├── channels/         # CRUD channels
│       └── cron/scrape/      # Scrape trigger
├── lib/
│   ├── db.ts                 # Drizzle client
│   ├── schema.ts             # Database schema
│   ├── constants.ts          # Venue list
│   ├── ingest/               # Feed-primary ingestion (OpenActive + 3 clocks)
│   │   ├── openactive/       # RPDE client, parsers, facility/slot ingest, poll
│   │   └── reconcile.ts      # Clock 2 reconcile + Clock 3 full sweep
│   ├── scrapers/             # Courtside/ClubSpark HTML fetchers (reconcile backstop)
│   ├── differ.ts             # SlotChange type + ensureVenuesExist
│   └── notifiers/
│       ├── index.ts          # Notification orchestrator
│       ├── email.ts          # Email via Resend HTTP API
│       └── telegram.ts       # Telegram Bot API
├── scripts/
│   ├── setup-telegram-webhook.ts  # Telegram webhook setup
│   └── *-preview.ts               # Read-only ingest clock previews
└── data/
    └── tennis.db             # Legacy SQLite (prod runs on Railway Postgres)
```

### Shared contract (`packages/contract`)

API response shapes live in `@pdd27673/10s-contract`. Route handlers import from
it so the backend is type-checked against the same contract it publishes.
`10s-mobile` consumes the package (local `file:` link, or a published version
from GitHub Packages).

Publish a new version:

```bash
git tag contract-v0.1.1
git push origin contract-v0.1.1
```

---

## License

MIT