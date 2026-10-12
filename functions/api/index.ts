import { waitUntil } from "@neon/functions";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { HTTPException } from "hono/http-exception";

import { type AuthEnv, requireUser } from "./auth.js";
import { pool, transaction } from "./db.js";
import { env } from "./env.js";
import { isLiveQueryName, sealAllLiveQueries, sealLiveQuery } from "./live.js";
import { runJob } from "./pipeline.js";
import { deletePrefix, jobPrefix, signedGetUrl } from "./storage.js";

const MAX_UPLOAD_BYTES = 15 * 1024 * 1024;
const ACCEPTED_TYPES = new Set(["image/jpeg", "image/png", "image/webp", "image/gif", "image/avif", "image/tiff"]);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const app = new Hono<AuthEnv>();

app.use(
  "*",
  cors({
    origin: (origin) => (env.allowedOrigins.includes(origin) ? origin : null),
    allowHeaders: ["authorization", "content-type"],
    allowMethods: ["GET", "POST", "DELETE", "OPTIONS"],
    maxAge: 600,
  }),
);

app.get("/health", (c) => c.json({ ok: true }));

app.use("/api/*", requireUser);

// Sealed live queries for the signed-in user. The browser subscribes to these
// over the Realtime WebSocket; `/api/live/:name` renews one before it expires.
app.get("/api/live", async (c) => c.json(await sealAllLiveQueries(c.get("user").id)));

app.get("/api/live/:name", async (c) => {
  const name = c.req.param("name");
  if (!isLiveQueryName(name)) throw new HTTPException(404, { message: "Unknown live query" });
  return c.json(await sealLiveQuery(name, c.get("user").id));
});

// Accepts an image, records the job, and keeps processing after responding.
app.post("/api/jobs", async (c) => {
  const user = c.get("user");
  const form = await c.req.formData();
  const file = form.get("file");
  if (!(file instanceof File)) throw new HTTPException(400, { message: "Expected a `file` field" });
  if (!ACCEPTED_TYPES.has(file.type)) throw new HTTPException(415, { message: `Unsupported type ${file.type || "unknown"}` });
  if (file.size > MAX_UPLOAD_BYTES) throw new HTTPException(413, { message: "Images must be 15 MB or smaller" });

  const bytes = new Uint8Array(await file.arrayBuffer());
  const filename = file.name.slice(0, 200) || "upload";

  const job = await transaction(async (client) => {
    const { rows } = await client.query<{ id: string; txid: string }>(
      `insert into image_jobs (user_id, filename, content_type, size_bytes, message)
       values ($1, $2, $3, $4, 'Waiting for a worker')
       returning id, pg_current_xact_id()::text as txid`,
      [user.id, filename, file.type, file.size],
    );
    const inserted = rows[0]!;
    await client.query(
      `insert into image_job_events (job_id, user_id, stage, progress, message)
       values ($1, $2, 'queued', 0, $3)`,
      [inserted.id, user.id, `Received ${filename} (${Math.round(file.size / 1024)} KB)`],
    );
    return inserted;
  });

  // The response returns immediately; the runtime keeps the invocation alive
  // until the pipeline settles. Progress reaches the browser via Realtime.
  waitUntil(runJob({ id: job.id, userId: user.id, filename, contentType: file.type, bytes }));

  return c.json(job, 202);
});

// Short-lived signed URLs for a job's stored variants (the bucket is private).
app.get("/api/jobs/:id/images", async (c) => {
  const id = c.req.param("id");
  if (!UUID.test(id)) throw new HTTPException(404, { message: "Job not found" });
  const { rows } = await pool.query<{ thumb_key: string | null; display_key: string | null; original_key: string | null }>(
    `select thumb_key, display_key, original_key from image_jobs where id = $1 and user_id = $2`,
    [id, c.get("user").id],
  );
  const job = rows[0];
  if (!job) throw new HTTPException(404, { message: "Job not found" });
  const sign = (key: string | null) => (key ? signedGetUrl(key) : null);
  const [thumb, display, original] = await Promise.all([sign(job.thumb_key), sign(job.display_key), sign(job.original_key)]);
  c.header("cache-control", "private, max-age=600");
  return c.json({ thumb, display, original });
});

app.delete("/api/jobs/:id", async (c) => {
  const id = c.req.param("id");
  const user = c.get("user");
  if (!UUID.test(id)) throw new HTTPException(404, { message: "Job not found" });
  const { rows } = await pool.query<{ txid: string }>(
    `delete from image_jobs where id = $1 and user_id = $2 returning pg_current_xact_id()::text as txid`,
    [id, user.id],
  );
  if (!rows[0]) throw new HTTPException(404, { message: "Job not found" });
  await deletePrefix(jobPrefix(user.id, id));
  return c.json(rows[0]);
});

app.onError((error, c) => {
  if (error instanceof HTTPException) return c.json({ error: error.message }, error.status);
  console.error(error);
  return c.json({ error: "Internal error" }, 500);
});

export default app;
