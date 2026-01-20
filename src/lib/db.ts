import { drizzle } from "drizzle-orm/better-sqlite3";
import Database from "better-sqlite3";
import * as schema from "./schema";

const sqlite = new Database("data/tennis.db");
sqlite.pragma("journal_mode = WAL"); // Better concurrent read performance

export const db = drizzle(sqlite, { schema });
