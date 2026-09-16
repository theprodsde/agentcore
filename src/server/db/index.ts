import "dotenv/config";
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import * as schema from "./schema";

const connectionString = process.env.DATABASE_URL;

if (!connectionString) {
  throw new Error("DATABASE_URL environment variable is required");
}

const client = postgres(connectionString, {
  max: 20,
  idle_timeout: 30,      // close idle connections after 30 s
  connect_timeout: 10,   // fail fast if Postgres is unreachable
  max_lifetime: 60 * 30, // recycle connections every 30 min
});
export const db = drizzle(client, { schema });

export * from "./schema";
