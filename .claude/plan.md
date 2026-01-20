# Tennis Court Availability Notifier

## Overview
A notification service with API and dashboard that monitors tennis court availability on Courtside Tower Hamlets and alerts users via Telegram, WhatsApp, or Email when slots become available. Designed for 5-10 users.

## Target Website
- **Platform**: Courtside Tower Hamlets (tennistowerhamlets.com)
- **7 Venues**: Bethnal Green Gardens, King Edward Memorial Park, Poplar Rec Ground, Ropemakers Field, St Johns Park, Victoria Park, Wapping Gardens
- **URL Pattern**: `/book/courts/{venue-slug}/{YYYY-MM-DD}`

## Architecture

```
┌─────────────────┐     ┌──────────────────┐     ┌─────────────────┐
│   Cron Job      │────▶│   Scraper        │────▶│   SQLite DB     │
│   (every 10min) │     │   (Playwright)   │     │                 │
└─────────────────┘     └──────────────────┘     └────────┬────────┘
                                                          │
                    ┌─────────────────────────────────────┼─────────────────────────────────────┐
                    │                                     │                                     │
                    ▼                                     ▼                                     ▼
          ┌─────────────────┐               ┌─────────────────┐               ┌─────────────────┐
          │   Dashboard     │               │   REST API      │               │   Notifiers     │
          │   (Next.js)     │               │   (Next.js)     │               │ Telegram/WA/Email│
          └─────────────────┘               └─────────────────┘               └─────────────────┘
```

## Tech Stack
- **Framework**: Next.js 14 (App Router) - unified API + Dashboard + Scraper
- **Database**: SQLite with Drizzle ORM (simple, file-based, no server)
- **Scraping**: Simple HTTP fetch + Cheerio (no Playwright needed!)
  - Website is server-rendered PHP, data is in the HTML
  - No JavaScript rendering required
  - Much lighter and faster than headless browser
- **Scheduling**: Vercel Cron or node-cron
- **Auth**: Magic links via Resend (simple, passwordless)
- **Notifications**:
  - **Telegram**: Telegram Bot API (free, easy)
  - **WhatsApp**: Twilio (optional, for users who prefer it)
  - **Email**: Resend ($0 for first 3k emails/month)
- **Deployment**: Railway ($5/month) or Fly.io

## Database Schema (SQLite + Drizzle)

```typescript
// schema.ts
import { sqliteTable, text, integer } from 'drizzle-orm/sqlite-core';

export const users = sqliteTable('users', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  email: text('email').notNull().unique(),
  createdAt: text('created_at').default(sql`CURRENT_TIMESTAMP`),
});

export const venues = sqliteTable('venues', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  slug: text('slug').notNull().unique(),
  name: text('name').notNull(),
});

export const slots = sqliteTable('slots', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  venueId: integer('venue_id').references(() => venues.id),
  date: text('date').notNull(),
  time: text('time').notNull(),
  court: text('court').notNull(),
  status: text('status').notNull(), // 'available', 'booked', 'closed'
  price: text('price'),
  updatedAt: text('updated_at').default(sql`CURRENT_TIMESTAMP`),
});

export const watches = sqliteTable('watches', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  userId: integer('user_id').references(() => users.id),
  venueId: integer('venue_id').references(() => venues.id), // null = all venues
  preferredTimes: text('preferred_times'), // JSON: ["17:00","18:00"] or null for any
  weekdaysOnly: integer('weekdays_only').default(0),
  weekendsOnly: integer('weekends_only').default(0),
  active: integer('active').default(1),
});

export const notificationChannels = sqliteTable('notification_channels', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  userId: integer('user_id').references(() => users.id),
  type: text('type').notNull(), // 'telegram', 'whatsapp', 'email'
  destination: text('destination').notNull(), // chat_id, phone, or email
  active: integer('active').default(1),
});

export const notificationLog = sqliteTable('notification_log', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  userId: integer('user_id').references(() => users.id),
  channelId: integer('channel_id').references(() => notificationChannels.id),
  slotKey: text('slot_key').notNull(), // "venue:date:time:court"
  sentAt: text('sent_at').default(sql`CURRENT_TIMESTAMP`),
});
```

## File Structure

```
/
├── src/
│   ├── app/
│   │   ├── page.tsx                    # Landing page
│   │   ├── layout.tsx
│   │   ├── dashboard/
│   │   │   ├── page.tsx                # Availability overview
│   │   │   ├── watches/page.tsx        # Manage alerts
│   │   │   ├── channels/page.tsx       # Notification settings
│   │   │   └── history/page.tsx        # Notification history
│   │   ├── auth/
│   │   │   ├── login/page.tsx          # Magic link request
│   │   │   └── verify/page.tsx         # Magic link verification
│   │   └── api/
│   │       ├── auth/
│   │       │   ├── login/route.ts      # Send magic link
│   │       │   └── verify/route.ts     # Verify token
│   │       ├── venues/route.ts         # GET venues
│   │       ├── availability/route.ts   # GET availability
│   │       ├── watches/
│   │       │   ├── route.ts            # GET/POST watches
│   │       │   └── [id]/route.ts       # PUT/DELETE watch
│   │       ├── channels/
│   │       │   ├── route.ts            # GET/POST channels
│   │       │   └── [id]/route.ts       # PUT/DELETE channel
│   │       ├── cron/
│   │       │   └── scrape/route.ts     # Cron endpoint
│   │       └── telegram/
│   │           └── webhook/route.ts    # Telegram bot webhook
│   ├── lib/
│   │   ├── db.ts                       # Drizzle client
│   │   ├── schema.ts                   # Database schema
│   │   ├── scraper.ts                  # HTTP fetch + Cheerio parsing
│   │   ├── differ.ts                   # Slot change detection
│   │   ├── notifiers/
│   │   │   ├── telegram.ts
│   │   │   ├── whatsapp.ts
│   │   │   └── email.ts
│   │   └── auth.ts                     # Magic link logic
│   └── components/
│       ├── AvailabilityGrid.tsx
│       ├── WatchForm.tsx
│       ├── ChannelForm.tsx
│       └── Navbar.tsx
├── drizzle/
│   └── migrations/
├── data/
│   └── tennis.db                       # SQLite file
├── drizzle.config.ts
├── package.json
└── .env
```

## API Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/auth/login` | Send magic link email |
| GET | `/api/auth/verify?token=X` | Verify magic link |
| GET | `/api/venues` | List all venues |
| GET | `/api/availability?venue=X&date=Y` | Get availability |
| GET | `/api/watches` | List user's watches |
| POST | `/api/watches` | Create a watch |
| PUT | `/api/watches/:id` | Update a watch |
| DELETE | `/api/watches/:id` | Delete a watch |
| GET | `/api/channels` | List notification channels |
| POST | `/api/channels` | Add notification channel |
| DELETE | `/api/channels/:id` | Remove channel |
| POST | `/api/cron/scrape` | Trigger scrape (cron) |
| POST | `/api/telegram/webhook` | Telegram bot webhook |

## Notification Channels

### Telegram Bot (Recommended - Free)
1. Create bot via @BotFather on Telegram
2. Get bot token
3. Users start chat with bot, we capture their chat_id
4. Send messages via `https://api.telegram.org/bot<token>/sendMessage`

### WhatsApp (Twilio - Optional)
- $15 free credit to start
- Users need to join Twilio sandbox
- ~$0.005 per message after free tier

### Email (Resend - Free tier)
- 3,000 emails/month free
- Simple API, great deliverability
- Already used for magic link auth

## Dashboard Pages

### 1. Availability Overview (`/dashboard`)
- Grid showing all venues and their availability
- Filter by date, time, venue
- Visual indicators: green (available), red (booked), gray (closed)

### 2. Watch Alerts (`/dashboard/watches`)
- List of active watches
- Create new watch: pick venue(s), time preferences, days
- Toggle active/inactive
- Delete watches

### 3. Notification Channels (`/dashboard/channels`)
- Connect Telegram (link to bot)
- Add WhatsApp number (Twilio setup instructions)
- Email is auto-connected via account email
- Test notification button

### 4. History (`/dashboard/history`)
- List of sent notifications
- Filter by date, channel

## Implementation Phases

### Phase 1: Core Infrastructure
1. Set up Next.js project with TypeScript
2. Configure SQLite + Drizzle ORM
3. Create database schema and migrations
4. Build scraper with fetch + Cheerio (parse HTML tables)
5. Set up cron job for scraping

### Phase 2: API + Auth
1. Magic link authentication with Resend
2. REST API endpoints for venues, availability, watches
3. Session management (JWT in httpOnly cookie)

### Phase 3: Notifications
1. Telegram bot setup + webhook
2. Email notifications via Resend
3. WhatsApp via Twilio (optional)
4. Diff engine + notification matching logic

### Phase 4: Dashboard
1. Landing page
2. Auth pages (login, verify)
3. Dashboard pages (overview, watches, channels, history)
4. Responsive design for mobile

## Configuration

```env
# Database
DATABASE_URL=file:./data/tennis.db

# Auth
JWT_SECRET=your-secret-key
RESEND_API_KEY=re_xxxxx

# Telegram
TELEGRAM_BOT_TOKEN=123456:ABC-xxxxx
TELEGRAM_WEBHOOK_SECRET=random-secret

# WhatsApp (optional)
TWILIO_ACCOUNT_SID=ACxxxxx
TWILIO_AUTH_TOKEN=xxxxx
TWILIO_WHATSAPP_FROM=whatsapp:+14155238886

# App
NEXT_PUBLIC_APP_URL=https://yourapp.railway.app
```

## Deployment (Railway)

1. Create Railway project
2. Add persistent volume for SQLite (`/app/data`)
3. Set environment variables
4. Deploy from GitHub
5. Configure cron job in `railway.json`:
```json
{
  "build": { "builder": "NIXPACKS" },
  "deploy": {
    "startCommand": "npm start",
    "healthcheckPath": "/api/health"
  },
  "cron": {
    "scrape": {
      "schedule": "*/10 7-22 * * *",
      "command": "curl -X POST $RAILWAY_STATIC_URL/api/cron/scrape"
    }
  }
}
```

**Estimated Cost**: ~$5/month on Railway (includes compute + volume)

## Scaling to 5-10 Users

SQLite handles 5-10 users easily:
- Read-heavy workload (availability checks)
- Writes are serialized but infrequent (scraper updates every 10 min)
- WAL mode for better concurrent reads

If needed later:
- Migrate to Turso (distributed SQLite) for free tier
- Or PostgreSQL on Railway for $5/month

## Scraper Implementation (fetch + Cheerio)

```typescript
// lib/scraper.ts
import * as cheerio from 'cheerio';

interface Slot {
  venue: string;
  date: string;
  time: string;
  court: string;
  status: 'available' | 'booked' | 'closed';
  price?: string;
}

export async function scrapeVenue(venueSlug: string, date: string): Promise<Slot[]> {
  const url = `https://tennistowerhamlets.com/book/courts/${venueSlug}/${date}`;

  const response = await fetch(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (compatible; TennisNotifier/1.0)',
      'Accept': 'text/html',
    },
  });

  const html = await response.text();
  const $ = cheerio.load(html);
  const slots: Slot[] = [];

  // Parse the availability table
  $('table tr').each((_, row) => {
    const time = $(row).find('th').text().trim(); // "8am", "9am", etc.
    if (!time) return;

    $(row).find('td > div').each((_, cell) => {
      const checkbox = $(cell).find('input[type="checkbox"]');
      const label = $(cell).find('div').text().trim(); // "Court 1£5" or "Court 1booked"

      // Parse court name and status
      const courtMatch = label.match(/^(Court \d+)(.*)/);
      if (!courtMatch) return;

      const court = courtMatch[1];
      const statusText = courtMatch[2];

      let status: 'available' | 'booked' | 'closed';
      let price: string | undefined;

      if (checkbox.attr('disabled')) {
        status = statusText.includes('booked') ? 'booked' : 'closed';
      } else {
        status = 'available';
        price = statusText; // "£5", "£2.50", etc.
      }

      slots.push({ venue: venueSlug, date, time, court, status, price });
    });
  });

  return slots;
}
```

## Verification Plan

1. **Scraper Test**: Run manually, verify data in SQLite
2. **API Test**: Use curl/Postman to test all endpoints
3. **Auth Test**: Complete magic link flow
4. **Telegram Test**: Send test notification to yourself
5. **Email Test**: Send test notification
6. **End-to-End**: Create watch, wait for real slot change, verify notification
7. **Dashboard Test**: Navigate all pages, create/edit/delete watches

## User Preferences
- **Scraping Frequency**: Every 10 minutes
- **Venues**: All 7 Tower Hamlets venues
- **Time Preferences** (default):
  - Weekdays: 5pm-9pm (after work)
  - Weekends: 11am-9pm
- **Notifications**: Telegram (primary), Email (backup), WhatsApp (optional)
