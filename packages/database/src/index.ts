import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import * as schema from './schema';

// Export all schema
export * from './schema';

// Export typed db creation function
export function createDb(connectionString: string) {
  const pool = new Pool({ connectionString });
  return drizzle(pool, { schema });
}

// Export type for db instance
export type Database = ReturnType<typeof createDb>;
