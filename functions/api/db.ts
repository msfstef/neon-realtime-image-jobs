import { attachDatabasePool } from "@neon/functions";
import pg from "pg";

import { env } from "./env.js";

// One pool per isolate; keep `max` small because each isolate has its own.
export const pool = new pg.Pool({ connectionString: env.databaseUrl, max: 5 });
attachDatabasePool(pool);

export async function transaction<T>(work: (client: pg.PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query("begin");
    const result = await work(client);
    await client.query("commit");
    return result;
  } catch (error) {
    await client.query("rollback").catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}
