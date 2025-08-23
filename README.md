# 10s Court Monitor

A comprehensive court booking monitoring system that tracks availability at tennis venues and sends notifications when preferred courts become available.

## Architecture

This is a monorepo containing:

- **`apps/web`** - Next.js 14 web application with user management and preferences
- **`apps/scraper`** - Node.js service for automated court availability scraping
- **Railway deployment** - PostgreSQL database and dual-service hosting

## Features

- 🎾 **Multi-venue Support** - ClubSpark and Courtside platforms
- 👤 **User Authentication** - Clerk integration with email whitelisting
- ⚙️ **Preference Management** - Customizable venue, time, and price preferences  
- 📧 **Email Notifications** - Resend integration for court availability alerts
- 📱 **SMS Notifications** - Telnyx integration for urgent alerts
- 📊 **Admin Dashboard** - System health monitoring and user management
- 🔄 **Automated Scraping** - Every 10 minutes via cron jobs
- 🏗️ **Railway Deployment** - Scalable cloud infrastructure

## Quick Start

### Prerequisites

- Node.js 18+
- Railway account
- Clerk account (for auth)
- Resend account (for emails)
- Telnyx account (for SMS, optional)

### Local Development

1. **Clone and install:**
   ```bash
   git clone <repo-url>
   cd 10s
   npm install
   ```

2. **Set up environment variables:**
   ```bash
   cp .env.example .env.local
   # Fill in your API keys
   ```

3. **Start development servers:**
   ```bash
   # Start web app
   npm run dev --workspace=web
   
   # Start scraper service
   npm run dev --workspace=scraper
   ```

### Railway Deployment

1. **Create Railway project:**
   - Connect your GitHub repository
   - Add PostgreSQL service
   - Configure environment variables

2. **Required Environment Variables:**
   ```
   DATABASE_URL=<from Railway PostgreSQL service>
   CLERK_SECRET_KEY=<your-clerk-secret>
   NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY=<your-clerk-public-key>
   RESEND_API_KEY=<your-resend-key>
   TELNYX_API_KEY=<your-telnyx-key>
   WEBHOOK_SECRET=<your-clerk-webhook-secret>
   ```

3. **Deploy:**
   ```bash
   railway up
   ```

## Project Structure

```
10s/
├── apps/
│   ├── web/               # Next.js 14 web application
│   │   ├── src/
│   │   │   ├── app/       # App Router pages
│   │   │   ├── components/ # Reusable UI components
│   │   │   └── lib/       # Database, auth, utilities
│   │   └── package.json
│   └── scraper/           # Node.js scraping service
│       ├── src/
│       │   ├── scrapers/  # Venue-specific scrapers
│       │   ├── services/  # Core business logic
│       │   └── main.js    # Entry point
│       └── package.json
├── packages/              # Shared utilities (future)
├── railway.toml           # Railway deployment config
└── package.json           # Monorepo workspace config
```

## Development Workflow

1. **Task Management** - Using Task Master AI for project tracking
2. **Code Quality** - ESLint, Prettier, TypeScript
3. **Database** - Drizzle ORM with PostgreSQL
4. **Testing** - Jest for unit tests, Playwright for E2E
5. **Deployment** - Automated via Railway

## Contributing

1. Check the Task Master task list for current priorities
2. Create feature branches from `main`
3. Follow the established patterns and conventions
4. Update tests and documentation
5. Submit PR for review

## License

MIT
