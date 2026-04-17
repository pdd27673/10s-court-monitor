import { defineConfig } from "drizzle-kit";
import path from "path";

const DB_PATH = process.env.DATABASE_PATH ?? path.resolve("data/tennis.db");

export default defineConfig({
  schema: "./src/lib/schema.ts",
  out: "./drizzle",
  dialect: "sqlite",
  dbCredentials: {
    url: DB_PATH,
  },
});
