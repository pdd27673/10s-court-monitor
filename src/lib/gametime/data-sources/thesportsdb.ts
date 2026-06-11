import type { SportEvent, FetchParams, Broadcaster } from '../types';
import { BaseProvider } from './base';

// TheSportsDB free API — no key required for basic queries
// Docs: https://www.thesportsdb.com/free_sports_api

const BASE_URL = 'https://www.thesportsdb.com/api/v1/json/3';

interface TSDBEvent {
  idEvent: string;
  strEvent: string;
  strLeague?: string;
  strSport?: string;
  strHomeTeam?: string;
  strAwayTeam?: string;
  strVenue?: string;
  strCountry?: string;
  strTimestamp?: string;
  dateEvent?: string;
  strTime?: string;
  strStatus?: string;
  strThumb?: string;
  strBanner?: string;
  strLeagueBadge?: string;
  strHomeTeamBadge?: string;
  strAwayTeamBadge?: string;
  strTVStation?: string;
}

function mapSport(tsdbSport: string): SportEvent['sport'] {
  const map: Record<string, SportEvent['sport']> = {
    Soccer: 'football',
    Football: 'nfl',
    'American Football': 'nfl',
    Basketball: 'basketball',
    Tennis: 'tennis',
    Cricket: 'cricket',
    'Rugby Union': 'rugby',
    'Rugby League': 'rugby-league',
    Golf: 'golf',
    'Mixed Martial Arts': 'ufc',
    Boxing: 'boxing',
    'Motor Sport': 'f1',
    Cycling: 'cycling',
    Athletics: 'athletics',
    Snooker: 'snooker',
    Darts: 'darts',
  };
  return map[tsdbSport] ?? 'other';
}

function parseStatus(status: string | undefined): SportEvent['status'] {
  if (!status) return 'upcoming';
  const s = status.toLowerCase();
  if (s === 'live' || s === 'inprogress') return 'live';
  if (s === 'finished' || s === 'ft' || s === 'aet') return 'final';
  if (s === 'postponed') return 'postponed';
  if (s === 'cancelled' || s === 'canceled') return 'cancelled';
  return 'upcoming';
}

function tsdbEventToSportEvent(e: TSDBEvent): SportEvent {
  let startTimeUtc = new Date().toISOString();
  if (e.strTimestamp) {
    startTimeUtc = new Date(e.strTimestamp).toISOString();
  } else if (e.dateEvent && e.strTime) {
    startTimeUtc = new Date(`${e.dateEvent}T${e.strTime}Z`).toISOString();
  }

  const broadcasters: Broadcaster[] = [];
  if (e.strTVStation) {
    broadcasters.push({
      id: e.strTVStation.toLowerCase().replace(/\s+/g, '-'),
      name: e.strTVStation,
      type: 'tv',
      isFree: false,
    });
  }

  const status = parseStatus(e.strStatus);

  return {
    id: `tsdb-${e.idEvent}`,
    source: 'thesportsdb',
    sourcePriority: 2,
    sport: mapSport(e.strSport ?? ''),
    league: e.strLeague ?? 'Unknown League',
    competition: e.strLeague ?? 'Unknown Competition',
    eventTitle: e.strEvent,
    participants: [
      ...(e.strHomeTeam ? [{ name: e.strHomeTeam, isHome: true, logo: e.strHomeTeamBadge }] : []),
      ...(e.strAwayTeam ? [{ name: e.strAwayTeam, isHome: false, logo: e.strAwayTeamBadge }] : []),
    ],
    startTimeUtc,
    status,
    isLive: status === 'live',
    venue: e.strVenue,
    country: e.strCountry,
    broadcasters,
    streamingPlatforms: [],
    tvChannels: e.strTVStation ? [e.strTVStation] : [],
    regionAvailability: [],
    artwork: {
      thumbnail: e.strThumb ?? undefined,
      banner: e.strBanner ?? undefined,
      leagueLogo: e.strLeagueBadge ?? undefined,
      team1Logo: e.strHomeTeamBadge ?? undefined,
      team2Logo: e.strAwayTeamBadge ?? undefined,
    },
    lastUpdated: new Date().toISOString(),
    confidence: e.strTVStation ? 'medium' : 'low',
    tags: [e.strSport?.toLowerCase() ?? 'sport'],
  };
}

export class TheSportsDBProvider extends BaseProvider {
  id = 'thesportsdb';
  name = 'TheSportsDB';
  priority = 2;
  type = 'free' as const;
  description = 'Free crowdsourced sports database with fixtures, artwork, and league data. No API key required for basic tier.';
  requiresKey = false;
  docs = 'https://www.thesportsdb.com/free_sports_api';

  private async get<T>(path: string): Promise<T> {
    const res = await fetch(`${BASE_URL}${path}`, {
      headers: { Accept: 'application/json' },
      next: { revalidate: 300 },
    } as RequestInit);
    if (!res.ok) throw new Error(`TheSportsDB request failed: ${res.status}`);
    return res.json() as Promise<T>;
  }

  async fetchEvents(params: FetchParams): Promise<SportEvent[]> {
    try {
      // Fetch events for next 7 days using league-based lookup
      // Free tier supports lookup by league next events
      const leagueIds = this.getLeagueIds(params.sport);
      const allEvents: TSDBEvent[] = [];

      for (const leagueId of leagueIds.slice(0, 3)) {
        const data = await this.get<{ events: TSDBEvent[] | null }>(
          `/eventsnextleague.php?id=${leagueId}`
        );
        if (data.events) allEvents.push(...data.events);
      }

      return allEvents.map(tsdbEventToSportEvent);
    } catch (error) {
      console.warn('TheSportsDB fetch failed, falling back to empty:', error);
      return [];
    }
  }

  private getLeagueIds(sport?: SportEvent['sport']): string[] {
    // TheSportsDB league IDs for major leagues
    const ids: Record<string, string[]> = {
      football: ['4328', '4335', '4334', '4331', '4332'],  // PL, La Liga, Bundesliga, Serie A, Ligue 1
      basketball: ['4387'],  // NBA
      nfl: ['4391'],         // NFL
      tennis: ['4960'],      // ATP
      cricket: ['4451'],     // IPL
      rugby: ['4521'],       // Premiership Rugby
      f1: ['4370'],          // Formula 1
    };
    if (sport && ids[sport]) return ids[sport];
    // Default to a broad set if no sport filter
    return ['4328', '4387', '4391', '4370'];
  }

  async healthCheck() {
    const start = Date.now();
    try {
      const data = await this.get<{ events: unknown[] | null }>('/eventsnextleague.php?id=4328');
      return {
        ok: !!data.events,
        latencyMs: Date.now() - start,
      };
    } catch (error) {
      return { ok: false, error: String(error) };
    }
  }
}
