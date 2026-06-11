export interface LeagueMeta {
  id: string;
  name: string;
  shortName?: string;
  sport: string;
  logo?: string;
  country?: string;
  region?: string;
}

export const LEAGUES: LeagueMeta[] = [
  { id: 'premier-league', name: 'Premier League', shortName: 'PL', sport: 'football', country: 'England' },
  { id: 'champions-league', name: 'UEFA Champions League', shortName: 'UCL', sport: 'football', region: 'Europe' },
  { id: 'europa-league', name: 'UEFA Europa League', shortName: 'UEL', sport: 'football', region: 'Europe' },
  { id: 'la-liga', name: 'La Liga', sport: 'football', country: 'Spain' },
  { id: 'bundesliga', name: 'Bundesliga', sport: 'football', country: 'Germany' },
  { id: 'serie-a', name: 'Serie A', sport: 'football', country: 'Italy' },
  { id: 'ligue-1', name: 'Ligue 1', sport: 'football', country: 'France' },
  { id: 'world-cup', name: 'FIFA World Cup', sport: 'football', region: 'Global' },

  { id: 'f1-world-championship', name: 'Formula 1 World Championship', shortName: 'F1', sport: 'f1', region: 'Global' },
  { id: 'motogp-world-championship', name: 'MotoGP World Championship', shortName: 'MotoGP', sport: 'motorsport', region: 'Global' },
  { id: 'indycar-series', name: 'NTT IndyCar Series', shortName: 'IndyCar', sport: 'motorsport', country: 'US' },

  { id: 'ufc', name: 'Ultimate Fighting Championship', shortName: 'UFC', sport: 'ufc', region: 'Global' },
  { id: 'bellator', name: 'Bellator MMA', shortName: 'Bellator', sport: 'mma', region: 'Global' },

  { id: 'wbc', name: 'World Boxing Council', shortName: 'WBC', sport: 'boxing', region: 'Global' },
  { id: 'ibf', name: 'International Boxing Federation', shortName: 'IBF', sport: 'boxing', region: 'Global' },

  { id: 'wimbledon', name: 'The Championships, Wimbledon', shortName: 'Wimbledon', sport: 'tennis', country: 'England' },
  { id: 'us-open-tennis', name: 'US Open', shortName: 'US Open', sport: 'tennis', country: 'US' },
  { id: 'roland-garros', name: 'Roland-Garros', shortName: 'RG', sport: 'tennis', country: 'France' },
  { id: 'australian-open', name: 'Australian Open', shortName: 'AO', sport: 'tennis', country: 'Australia' },
  { id: 'atp-tour', name: 'ATP Tour', sport: 'tennis', region: 'Global' },
  { id: 'wta-tour', name: 'WTA Tour', sport: 'tennis', region: 'Global' },

  { id: 'nba', name: 'NBA', sport: 'basketball', country: 'US' },
  { id: 'euroleague', name: 'EuroLeague Basketball', sport: 'basketball', region: 'Europe' },

  { id: 'nfl', name: 'NFL', sport: 'nfl', country: 'US' },

  { id: 'cricket-ashes', name: 'The Ashes', sport: 'cricket', region: 'Global' },
  { id: 'cricket-icc', name: 'ICC Cricket', sport: 'cricket', region: 'Global' },
  { id: 'ipl', name: 'Indian Premier League', shortName: 'IPL', sport: 'cricket', country: 'India' },

  { id: 'six-nations', name: 'Six Nations Championship', shortName: '6N', sport: 'rugby', region: 'Europe' },
  { id: 'rugby-world-cup', name: 'Rugby World Cup', sport: 'rugby', region: 'Global' },
  { id: 'premiership-rugby', name: 'Gallagher Premiership', sport: 'rugby', country: 'England' },
  { id: 'super-rugby', name: 'Super Rugby', sport: 'rugby', region: 'Global' },

  { id: 'the-masters', name: 'The Masters', sport: 'golf', country: 'US' },
  { id: 'the-open', name: 'The Open Championship', shortName: "The Open", sport: 'golf', country: 'England' },
  { id: 'pga-tour', name: 'PGA Tour', sport: 'golf', country: 'US' },
  { id: 'ryder-cup', name: 'Ryder Cup', sport: 'golf', region: 'Global' },
];

export const getLeague = (id: string): LeagueMeta | undefined =>
  LEAGUES.find(l => l.id === id);
