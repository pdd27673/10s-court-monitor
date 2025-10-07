import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import * as schema from './schema/index';

// Export all schema
export * from './schema/index';

// Export types
export * from './types';

// Export typed db creation function
export function createDb(connectionString: string) {
  const pool = new Pool({ connectionString });
  return drizzle(pool, { schema });
}

// Export type for db instance
export type Database = ReturnType<typeof createDb>;
