import { createRealtime, rawSql } from "@neon/realtime/server";

import type { CategoryStatRow, JobEventRow, JobRow, StatusStatRow } from "../../shared/types.js";
import { env } from "./env.js";

// Seals queries into short-lived encrypted capabilities. Sealing is local
// crypto with the server-only secret; the browser never sees the secret, only
// the capability for the exact query (with the caller's user id baked in).
const realtime = createRealtime({
  secret: env.realtimeSecret,
  db: env.realtimeDatabase,
});

// Every live query is scoped to the verified user. Realtime has no RLS yet, so
// this WHERE clause is the access control.
const liveQueries = {
  // No ORDER BY/LIMIT: the protocol has no positional row-move delta, so an
  // ordered query is re-sent as a full reset on change. Unordered, each stage
  // transition arrives as a single-row upsert; the browser sorts.
  jobs: (userId: string) =>
    rawSql<JobRow>(
      `select id, filename, size_bytes, status, stage, progress, message, error,
              thumb_key, width, height, format, dominant_color,
              category, confidence, caption, tags, model,
              created_at, started_at, completed_at
         from image_jobs
        where user_id = $1`,
      [userId],
    ),

  // A join with ORDER BY/LIMIT: the activity feed shows the latest 40 events
  // with their job's filename. Correct, but each change resets the result.
  events: (userId: string) =>
    rawSql<JobEventRow>(
      `select e.id, e.job_id, j.filename, e.stage, e.progress, e.message, e.created_at
         from image_job_events e
         join image_jobs j on j.id = e.job_id
        where e.user_id = $1
        order by e.id desc
        limit 40`,
      [userId],
    ),

  // Aggregates are maintained incrementally as well.
  categories: (userId: string) =>
    rawSql<CategoryStatRow>(
      `select category, count(*)::int as count
         from image_jobs
        where user_id = $1 and status = 'completed' and category is not null
        group by category`,
      [userId],
    ),

  statuses: (userId: string) =>
    rawSql<StatusStatRow>(
      `select status, count(*)::int as count
         from image_jobs
        where user_id = $1
        group by status`,
      [userId],
    ),
};

export type LiveQueryName = keyof typeof liveQueries;

export function isLiveQueryName(name: string): name is LiveQueryName {
  return Object.hasOwn(liveQueries, name);
}

export async function sealLiveQuery(name: LiveQueryName, userId: string) {
  return realtime.seal({ query: liveQueries[name](userId) });
}

export async function sealAllLiveQueries(userId: string) {
  const [jobs, events, categories, statuses] = await Promise.all([
    sealLiveQuery("jobs", userId),
    sealLiveQuery("events", userId),
    sealLiveQuery("categories", userId),
    sealLiveQuery("statuses", userId),
  ]);
  return { websocketUrl: env.realtimeUrl, queries: { jobs, events, categories, statuses } };
}
