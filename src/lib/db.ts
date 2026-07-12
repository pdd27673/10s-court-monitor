import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import * as schema from "./schema";

// Postgres connection pool. The pool is lazy — it does not open a connection
// until the first query — so importing this module during `next build`
// (where no route handlers run) never touches the database.
const connectionString = process.env.DATABASE_URL;

const pool = new Pool({
  connectionString,
  // Railway's managed Postgres uses TLS. When connecting over the public proxy
  // URL, allow the self-signed chain; over the private network this is ignored.
  ssl:
    connectionString && /\bsslmode=require\b/.test(connectionString)
      ? { rejectUnauthorized: false }
      : undefined,
});

export const db = drizzle(pool, { schema });
