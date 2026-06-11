import type { SportEvent, FetchParams, ProviderHealth } from '../types';
import { MockProvider } from './mock-provider';
import { TheSportsDBProvider } from './thesportsdb';
import type { IDataProvider } from './base';
import { deduplicateEvents, sortEvents } from '../normalizers';

export { MockProvider, TheSportsDBProvider };
export type { IDataProvider };

const mockProvider = new MockProvider();
const tsdbProvider = new TheSportsDBProvider();

// Ordered by priority (lower = higher priority for watch data enrichment)
export const PROVIDERS: IDataProvider[] = [
  mockProvider,
  tsdbProvider,
];

export const PROVIDER_REGISTRY: Record<string, IDataProvider> = {
  mock: mockProvider,
  thesportsdb: tsdbProvider,
};

export async function fetchAllEvents(params: FetchParams = {}): Promise<SportEvent[]> {
  // In demo mode we just use mock data for instant load
  // If NEXT_PUBLIC_USE_LIVE_DATA=true, also fetch from TheSportsDB
  const useLiveData = process.env.NEXT_PUBLIC_USE_LIVE_DATA === 'true';

  const sources: IDataProvider[] = useLiveData
    ? [mockProvider, tsdbProvider]
    : [mockProvider];

  const allResults = await Promise.allSettled(
    sources.map(p => p.fetchEvents(params))
  );

  const events: SportEvent[] = [];
  for (const result of allResults) {
    if (result.status === 'fulfilled') {
      events.push(...result.value);
    }
  }

  return sortEvents(deduplicateEvents(events));
}

export async function checkProviderHealth(): Promise<ProviderHealth[]> {
  const checks = await Promise.allSettled(
    PROVIDERS.map(async p => {
      const result = await p.healthCheck?.() ?? { ok: true };
      return {
        id: p.id,
        name: p.name,
        status: (result.ok ? 'ok' : 'down') as ProviderHealth['status'],
        lastCheck: new Date().toISOString(),
        error: 'error' in result ? result.error : undefined,
      };
    })
  );

  return checks.map((c, i) =>
    c.status === 'fulfilled'
      ? c.value
      : {
          id: PROVIDERS[i].id,
          name: PROVIDERS[i].name,
          status: 'down' as const,
          lastCheck: new Date().toISOString(),
          error: String(c.reason),
        }
  );
}
