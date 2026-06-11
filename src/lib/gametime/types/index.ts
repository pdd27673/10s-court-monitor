export type Sport =
  | 'ufc' | 'mma' | 'boxing'
  | 'f1' | 'motogp' | 'indycar' | 'nascar' | 'motorsport'
  | 'football' | 'soccer' | 'champions-league'
  | 'tennis'
  | 'basketball' | 'nba'
  | 'nfl'
  | 'cricket'
  | 'rugby' | 'rugby-union' | 'rugby-league'
  | 'golf'
  | 'athletics' | 'cycling' | 'snooker' | 'darts' | 'other';

export type EventStatus = 'live' | 'upcoming' | 'final' | 'delayed' | 'cancelled' | 'postponed' | 'suspended';

export type BroadcasterType = 'tv' | 'streaming' | 'radio' | 'ppv';

export interface Broadcaster {
  id: string;
  name: string;
  shortName?: string;
  logo?: string;
  type: BroadcasterType;
  country?: string;
  color?: string;
  isFree?: boolean;
}

export interface Participant {
  id?: string;
  name: string;
  shortName?: string;
  team?: string;
  nationality?: string;
  rank?: number;
  logo?: string;
  isHome?: boolean;
}

export interface RegionAvailability {
  region: string;
  country: string;
  broadcasters: string[];
  streamingPlatforms: string[];
  isGeolocked?: boolean;
}

export interface EventArtwork {
  thumbnail?: string;
  banner?: string;
  sportIcon?: string;
  leagueLogo?: string;
  team1Logo?: string;
  team2Logo?: string;
}

export type SessionType =
  | 'practice' | 'qualifying' | 'sprint' | 'race'
  | 'main-card' | 'prelims' | 'early-prelims'
  | 'match' | 'final' | 'semi-final' | 'quarter-final'
  | 'group-stage' | 'knockout' | 'league'
  | 'test' | 'odi' | 't20' | 'other';

export type ImportanceLevel = 'high' | 'medium' | 'low';
export type ConfidenceLevel = 'high' | 'medium' | 'low';

export interface SportEvent {
  id: string;
  source: string;
  sourcePriority: number;
  sport: Sport;
  league: string;
  competition: string;
  eventTitle: string;
  participants: Participant[];
  stage?: string;
  startTimeUtc: string;
  endTimeUtc?: string;
  status: EventStatus;
  isLive: boolean;
  venue?: string;
  country?: string;
  broadcasters: Broadcaster[];
  streamingPlatforms: string[];
  tvChannels: string[];
  regionAvailability: RegionAvailability[];
  artwork?: EventArtwork;
  deeplink?: string;
  lastUpdated: string;
  confidence: ConfidenceLevel;
  tags: string[];
  relatedEventIds?: string[];
  seriesId?: string;
  sessionType?: SessionType;
  isFeatured?: boolean;
  importance?: ImportanceLevel;
}

export interface FilterState {
  sports: Sport[];
  competitions: string[];
  broadcasters: string[];
  regions: string[];
  platforms: string[];
  timeRange: 'live' | '1h' | '3h' | 'today' | 'week' | 'all';
  streamingOnly: boolean;
  freeOnly: boolean;
  showLiveOnly: boolean;
  search: string;
}

export const DEFAULT_FILTERS: FilterState = {
  sports: [],
  competitions: [],
  broadcasters: [],
  regions: [],
  platforms: [],
  timeRange: 'all',
  streamingOnly: false,
  freeOnly: false,
  showLiveOnly: false,
  search: '',
};

export interface UserPreferences {
  timezone: string;
  use24h: boolean;
  favoriteSports: Sport[];
  favoriteTeams: string[];
  favoriteLeagues: string[];
  favoriteAthletes: string[];
  savedEventIds: string[];
  remindedEventIds: string[];
  theme: 'dark' | 'light';
  spoilerSafe: boolean;
  denseMode: boolean;
}

export const DEFAULT_PREFS: UserPreferences = {
  timezone: '',
  use24h: false,
  favoriteSports: [],
  favoriteTeams: [],
  favoriteLeagues: [],
  favoriteAthletes: [],
  savedEventIds: [],
  remindedEventIds: [],
  theme: 'dark',
  spoilerSafe: false,
  denseMode: false,
};

export interface DataProvider {
  id: string;
  name: string;
  priority: number;
  type: 'free' | 'freemium' | 'paid';
  description: string;
  docs?: string;
  requiresKey: boolean;
}

export interface FetchParams {
  sport?: Sport;
  startDate?: string;
  endDate?: string;
  region?: string;
  league?: string;
}

export interface ProviderHealth {
  id: string;
  name: string;
  status: 'ok' | 'degraded' | 'down';
  lastCheck: string;
  lastSuccess?: string;
  eventCount?: number;
  error?: string;
}

export const SPORTS_LIST: { id: Sport; label: string; emoji: string }[] = [
  { id: 'football', label: 'Football', emoji: '⚽' },
  { id: 'f1', label: 'Formula 1', emoji: '🏎️' },
  { id: 'ufc', label: 'UFC / MMA', emoji: '🥊' },
  { id: 'boxing', label: 'Boxing', emoji: '🥊' },
  { id: 'tennis', label: 'Tennis', emoji: '🎾' },
  { id: 'basketball', label: 'Basketball', emoji: '🏀' },
  { id: 'nfl', label: 'NFL', emoji: '🏈' },
  { id: 'cricket', label: 'Cricket', emoji: '🏏' },
  { id: 'rugby', label: 'Rugby', emoji: '🏉' },
  { id: 'golf', label: 'Golf', emoji: '⛳' },
  { id: 'motorsport', label: 'Motorsport', emoji: '🏁' },
  { id: 'cycling', label: 'Cycling', emoji: '🚴' },
  { id: 'athletics', label: 'Athletics', emoji: '🏃' },
  { id: 'snooker', label: 'Snooker', emoji: '🎱' },
  { id: 'darts', label: 'Darts', emoji: '🎯' },
];
