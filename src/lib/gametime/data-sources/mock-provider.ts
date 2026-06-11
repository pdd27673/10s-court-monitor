import type { SportEvent, FetchParams } from '../types';
import { BaseProvider } from './base';
import { MOCK_EVENTS } from '../mock-data/events';

export class MockProvider extends BaseProvider {
  id = 'mock';
  name = 'Demo Data';
  priority = 99;
  type = 'free' as const;
  description = 'Seeded demo data — works offline, no API key required';
  requiresKey = false;

  async fetchEvents(params: FetchParams): Promise<SportEvent[]> {
    let results = [...MOCK_EVENTS];

    if (params.sport) {
      results = results.filter(e => e.sport === params.sport);
    }
    if (params.league) {
      results = results.filter(e => e.league.toLowerCase().includes(params.league!.toLowerCase()));
    }
    if (params.startDate) {
      const start = new Date(params.startDate).getTime();
      results = results.filter(e => new Date(e.startTimeUtc).getTime() >= start);
    }
    if (params.endDate) {
      const end = new Date(params.endDate).getTime();
      results = results.filter(e => new Date(e.startTimeUtc).getTime() <= end);
    }

    return results;
  }

  async healthCheck() {
    return { ok: true, latencyMs: 0 };
  }
}
