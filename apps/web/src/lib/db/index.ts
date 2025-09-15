import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import * as schema from './schema';

// Allow database to be undefined during build time
let db: ReturnType<typeof drizzle> | undefined;

if (process.env.DATABASE_URL) {
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
  });
  db = drizzle(pool, { schema });
} else if (process.env.NODE_ENV !== 'development' && typeof window === 'undefined') {
  // Only throw in production runtime, not during build
  console.warn('DATABASE_URL not found - database will be unavailable');
}

// Export a function that throws if db is not available
export function getDb() {
  if (!db) {
    throw new Error('DATABASE_URL environment variable is required');
  }
  return db;
}

// For backwards compatibility, export db but it might be undefined during build
export { db };

export * from './schema';
