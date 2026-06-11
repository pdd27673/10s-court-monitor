import type { SportEvent, DataProvider, FetchParams } from '../types';

export interface IDataProvider extends DataProvider {
  fetchEvents(params: FetchParams): Promise<SportEvent[]>;
  healthCheck?(): Promise<{ ok: boolean; latencyMs?: number; error?: string }>;
}

export abstract class BaseProvider implements IDataProvider {
  abstract id: string;
  abstract name: string;
  abstract priority: number;
  abstract type: 'free' | 'freemium' | 'paid';
  abstract description: string;
  abstract requiresKey: boolean;
  docs?: string;

  abstract fetchEvents(params: FetchParams): Promise<SportEvent[]>;

  async healthCheck(): Promise<{ ok: boolean; latencyMs?: number; error?: string }> {
    const start = Date.now();
    try {
      await this.fetchEvents({});
      return { ok: true, latencyMs: Date.now() - start };
    } catch (error) {
      return { ok: false, error: String(error) };
    }
  }
}
