# GameTime Grid

A premium sports schedule and EPG-style web app — **what's on today, when does it start in your local time, and where can you watch it?**

---

## Features

- **Live Now** rail with pulsing indicators
- **EPG timeline view** — scrollable horizontal guide  
- **Dashboard, Today, Week, Sport, Channels, Saved, Search** views
- **Automatic local timezone** detection + manual override
- **Broadcaster/channel info** per event (UK-first, globally extensible)
- **Conflict detection** for overlapping events
- **Highlight tags**: Title Fight, Final, Free to Air, Grand Prix
- **Dark/light theme**, dense/comfortable mode, spoiler-safe mode
- **Calendar export** (Google Calendar)
- **Keyboard shortcuts**: `/` for search, `Esc` to close
- **Mobile bottom nav**, pin favourite sports to sidebar

---

## Tech Stack

| Layer | Choice |
|---|---|
| Framework | Next.js 16 App Router |
| Language | TypeScript |
| Styling | Tailwind CSS v4 |
| State | React Context + useReducer |
| Data | Mock + TheSportsDB (free) |
| Deployment | GitHub Pages (Actions) |

---

## Data Sources

| # | Provider | Type | Key? | Coverage |
|---|---|---|---|---|
| 1 | **Mock data** | Free | No | Rich seeded events across all sports |
| 2 | **TheSportsDB** | Free | No | Fixtures, artwork, league data |
| 3 | **Gracenote/TMS** | Paid | Yes | Broadcaster-grade TV airings |
| 4 | **TV Media** | Paid | Yes | Sports TV schedule by sport/team |

**Why free-first?** TheSportsDB provides great fixture coverage and artwork. The gap in free sources is broadcaster/channel data — knowing which specific TV channel in which region carries an event requires commercial sources like Gracenote/TMS.

### What each provider supplies

**TheSportsDB (free):** fixtures, artwork, logos, venue, country, basic TV station

**Gracenote/TMS (paid upgrade):** sports event airings on TV lineups, channel/station, regional availability

**TV Media (paid upgrade):** sports schedule searchable by sport/team/league, UK/NA channels

---

## Normalization & Enrichment

Events merge via `src/lib/gametime/normalizers/`:

1. **Deduplication** — matched on `sport + startTime + title`
2. **Priority merge** — lower `sourcePriority` wins conflicts
3. **Broadcaster enrichment** — free event data + paid channel data
4. **Artwork** — prefer TheSportsDB (rich) over premium (often text-only)
5. **Watch status** — `available | partial | unavailable`

---

## Getting Started

```bash
npm install
npm run dev
```

No API keys needed — runs on bundled demo data.

### Enable live TheSportsDB data

```bash
NEXT_PUBLIC_USE_LIVE_DATA=true npm run dev
```

---

## GitHub Pages Deployment

The repo includes `.github/workflows/deploy.yml`.

**Setup:**
1. Create repo on GitHub
2. Go to Settings → Pages → Source → **GitHub Actions**
3. Push to `main` — workflow runs automatically

**Live URL:** `https://<username>.github.io/<repo-name>/`

---

## UK Broadcaster Mapping

| Sport | Free | Paid/Streaming |
|---|---|---|
| Formula 1 | Channel 4 (highlights) | Sky Sports F1 |
| Premier League | — | Sky Sports, TNT Sports, Amazon |
| Champions League | — | TNT Sports, discovery+ |
| Cricket | Channel 4 (selective) | Sky Sports Cricket |
| Wimbledon | BBC One/Two | Amazon Prime |
| UFC/Boxing | — | TNT Sports, DAZN |
| Golf majors | BBC Sport | Sky Sports Golf |
| Rugby Union | Channel 4 (selective) | TNT Sports |
| NFL London | Channel 4 | Peacock (US) |

---

## Adding a Provider

1. Create `src/lib/gametime/data-sources/my-provider.ts` extending `BaseProvider`
2. Implement `fetchEvents(params: FetchParams): Promise<SportEvent[]>`
3. Register in `src/lib/gametime/data-sources/index.ts`
4. Add key to `.env.example`
