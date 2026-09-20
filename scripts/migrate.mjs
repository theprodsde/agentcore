/**
 * Applies versioned SQL migrations from ./drizzle using drizzle-orm's bundled
 * migrator. Used by the Docker CMD so the production image does not need
 * drizzle-kit (a devDependency) or registry access at startup.
 *
 * Usage: node scripts/migrate.mjs
 */
import "dotenv/config";
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";

const url = process.env.DATABASE_URL;
if (!url) {
  console.error("DATABASE_URL environment variable is required");
  process.exit(1);
}

const client = postgres(url, { max: 1, connect_timeout: 10 });
try {
  await migrate(drizzle(client), { migrationsFolder: "drizzle" });
  console.log("Migrations applied");
} catch (err) {
  console.error("Migration failed:", err);
  process.exitCode = 1;
} finally {
  await client.end();
}
