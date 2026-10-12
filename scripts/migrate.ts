// Applies db/schema.sql (idempotent) to the branch in .env.local.
import { readFile } from "node:fs/promises";

import { config as loadEnv } from "dotenv";
import pg from "pg";

loadEnv({ path: ".env.local", quiet: true });

const connectionString = process.env.DATABASE_URL_UNPOOLED;
if (!connectionString) throw new Error("Missing DATABASE_URL_UNPOOLED. Run `neon env pull` first.");

const schema = await readFile(new URL("../db/schema.sql", import.meta.url), "utf8");
const client = new pg.Client({ connectionString });
await client.connect();
try {
  await client.query(schema);
  console.log("Schema is up to date.");
} finally {
  await client.end();
}
