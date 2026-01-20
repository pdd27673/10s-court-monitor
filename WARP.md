# WARP.md

This file provides guidance to WARP (warp.dev) when working with code in this repository.

## Project Overview

Tennis Court Notifier - A Next.js application that monitors tennis court availability on Courtside Tower Hamlets and alerts users via Telegram or Email when slots become available.

## Commands

### Development
```bash
npm run dev          # Start development server (http://localhost:3000)
npm run build        # Build for production
npm start            # Run production build
npm run lint         # Run ESLint
```

### Database
```bash
npm run db:generate  # Generate migrations from schema changes
npm run db:migrate   # Apply migrations to database
npm run db:push      # Push schema changes directly (dev only)
npm run db:studio    # Open Drizzle Studio (database GUI)
npm run db:seed      # Seed database with test user and venues
```

### Scripts
```bash
npm run maintain     # Run maintenance tasks
npm run soak-test    # Run soak/load testing
npx tsx scripts/test-scraper.ts  # Test the scraper directly
```

### Manual Testing
```bash
# Test scraper via API
curl http://localhost:3000/api/cron/scrape

# Check health
curl http://localhost:3000/api/health

# Get availability
curl "http://localhost:3000/api/availability?venue=victoria-park&date=2025-01-21"
```

## Architecture

### Tech Stack
- **Frontend/Backend**: Next.js 16 (App Router, React 19)
- **Database**: SQLite with Drizzle ORM (WAL mode)
- **Web Scraping**: Cheerio (HTML parsing, no browser required)
- **Notifications**: Telegram Bot API, Gmail via Nodemailer
- **Deployment**: Railway (recommended) with persistent volume for SQLite

### Core Components

**Scraper Pipeline** (`src/lib/scraper.ts`)
- Fetches HTML from tennistowerhamlets.com for 7 venues × 7 days
- Parses availability tables using Cheerio selectors
- No browser/Playwright needed - simple HTTP + DOM parsing
- Returns structured slot data (venue, date, time, court, status, price)

**Change Detection** (`src/lib/differ.ts`)
- Compares scraped slots against database state
- Detects newly available slots (booked → available, closed → available)
- Triggers notifications only for status changes to "available"
- Prevents duplicate notifications via `notification_log` table

**Notification System** (`src/lib/notifiers/`)
- Matches slot changes against user watch preferences (venue, time, weekday filters)
- Supports multiple channels per user (Telegram, Email)
- Deduplication: won't notify same user+channel for same slot twice
- Format-specific message builders (Telegram markdown, HTML email)

**Watch System**
- Users define preferences: preferred times (["5pm", "6pm"]), venue filter, weekday/weekend only
- Each watch can monitor all venues or a specific venue
- Active/inactive toggle without deleting watch

### Database Schema

**Core Tables**
- `users` - User accounts (email only for now)
- `venues` - 7 Tower Hamlets tennis venues (slug, name)
- `slots` - Court availability (venue, date, time, court, status, price)
- `watches` - User alert preferences (filters for venue, times, weekdays)
- `notification_channels` - Telegram chat IDs or email addresses
- `notification_log` - Sent notification history (prevents duplicates)

**Key Relationships**
- User → many Watches → many NotificationChannels
- Venue → many Slots
- NotificationLog tracks (userId, channelId, slotKey, sentAt)

### API Routes

**Public**
- `GET /api/venues` - List all 7 venues
- `GET /api/availability?venue=<slug>&date=<YYYY-MM-DD>` - Get slots
- `GET /api/health` - Health check endpoint

**Protected (require authentication in production)**
- `GET /api/watches` - List user's watches
- `POST /api/watches` - Create watch
- `GET /api/channels` - List notification channels
- `POST /api/channels` - Add channel

**Cron Job**
- `POST /api/cron/scrape` - Trigger scraping job
  - Protected by `Authorization: Bearer <CRON_SECRET>` in production
  - GET allowed in development mode for easy testing
  - Scrapes all venues for next 7 days, detects changes, sends notifications

## Development Workflow

### First-Time Setup
```bash
npm install
cp .env.example .env
# Edit .env with your credentials
npm run db:migrate
npm run db:seed
npm run dev
```

### Adding Users
Edit `scripts/seed.ts` with real email/Telegram chat ID, then:
```bash
npx tsx scripts/seed.ts
```

Or use sqlite3 directly:
```bash
sqlite3 data/tennis.db
INSERT INTO users (email) VALUES ('user@example.com');
```

### Testing Scraper Changes
```bash
npx tsx scripts/test-scraper.ts  # Tests ropemakers-field for next 2 days
```

### Testing Notifications
```bash
# Test email
npx tsx -e "
import { sendEmail } from './src/lib/notifiers/email';
await sendEmail('your@email.com', 'Test', '<p>Test notification</p>');
"

# Test Telegram
npx tsx -e "
import { sendTelegramMessage } from './src/lib/notifiers/telegram';
await sendTelegramMessage('YOUR_CHAT_ID', 'Test notification');
"
```

## Deployment Notes

### Railway (Recommended)
- **Critical**: Add persistent volume mounted at `/app/data` for SQLite
- Set `DATABASE_URL=file:./data/tennis.db`
- Set all env vars in Railway dashboard
- Use Railway cron or external service (cron-job.org) to trigger `/api/cron/scrape` every 10 minutes

### Environment Variables
```
DATABASE_URL=file:./data/tennis.db
CRON_SECRET=<random-secret>
TELEGRAM_BOT_TOKEN=<from-@BotFather>
GMAIL_USER=<your-gmail>
GMAIL_APP_PASSWORD=<16-char-app-password>  # NOT regular password, use App Password
NEXT_PUBLIC_APP_URL=<your-deployment-url>
```

### Cron Setup
External cron service should POST to:
```
URL: https://your-app.railway.app/api/cron/scrape
Method: POST
Header: Authorization: Bearer <CRON_SECRET>
Schedule: */10 7-22 * * *  # Every 10 min, 7am-10pm
```

## Venue Information

The system monitors 7 Tower Hamlets venues (defined in `src/lib/constants.ts`):
1. Bethnal Green Gardens (bethnal-green-gardens)
2. King Edward Memorial Park (king-edward-memorial-park)
3. Poplar Rec Ground (poplar-rec-ground)
4. Ropemakers Field (ropemakers-field)
5. St Johns Park (st-johns-park)
6. Victoria Park (victoria-park)
7. Wapping Gardens (wapping-gardens)

Slug format matches tennistowerhamlets.com URL structure.

## Important Notes

- SQLite uses WAL mode for better concurrency, but avoid running multiple scrapers simultaneously
- The scraper only notifies on status changes TO "available" (not FROM available)
- Time format: slots use "5pm", "6pm" format; watches store JSON arrays of these times
- Notification deduplication: same slot won't notify same user+channel twice (via `notification_log`)
- Gmail requires App Password with 2FA enabled (not regular password)
- Telegram chat ID can be found via `https://api.telegram.org/bot<TOKEN>/getUpdates` after messaging the bot
