# neon-realtime-image-jobs

A small demo app for trying out **Neon Realtime** together with the rest of Neon's
backend services: Neon Auth, Postgres, Object Storage, the AI Gateway, and Functions.

Sign in, drop images, and watch a Neon Function process them live. The function
stores each upload in Neon Object Storage, decodes and resizes it with sharp,
classifies it with an LLM through the Neon AI Gateway, and writes every step to
Postgres. The browser never polls: it subscribes to **Neon Realtime live
queries** over those rows, so progress shows up in every open tab as each
transaction commits.

```
 Browser (Vite + React)                         Neon (one branch)
 ──────────────────────                         ─────────────────────────────────────────────
 Neon Auth sign-in ───────────────────────────► Neon Auth (Better Auth) ── JWT (EdDSA, 15 min)
 POST /api/jobs (image, Bearer JWT) ──────────► Function `api` (Hono)
                                                 ├─ insert image_jobs row → 202 {id, txid}
                                                 └─ waitUntil(runJob):
                                                      store original ──► Object Storage `images`
                                                      decode / resize ─► sharp (native, linux-arm64)
                                                      upload variants ─► Object Storage
                                                      classify ────────► AI Gateway (gpt-5-nano, streamed)
                                                      every step: UPDATE image_jobs + INSERT event (1 txn)
 GET /api/live ───────────────────────────────► seal() 4 live queries scoped to the JWT's user
 WebSocket (sealed capabilities) ◄────────────► Neon Realtime ◄── Postgres changes
   useLiveQuery(jobs | events | statuses | categories)
```

## What each Neon product does here

| Product | Where | How |
| --- | --- | --- |
| **Realtime** | `functions/api/live.ts`, `web/src/*` | The function seals per-user SQL queries with `NEON_REALTIME_SECRET` (`@neon/realtime/server`). The browser subscribes with one multiplexed `RealtimeClient` and `useLiveQuery` (`@neon/realtime-react`), and renews capabilities via `refreshQuery`. |
| **Functions** | `functions/api/` | A Hono app. It verifies JWTs, accepts uploads, runs the pipeline in `waitUntil`, seals live queries, and signs image URLs. |
| **Postgres** | `db/schema.sql` | `image_jobs` (state, storage pointers, results) and `image_job_events` (append-only log), both with `REPLICA IDENTITY FULL` for Realtime. |
| **Object Storage** | `functions/api/storage.ts` | A private `images` bucket with `users/<user>/jobs/<job>/{original,thumb.webp,display.webp}`. The browser gets 15-minute signed GET URLs. |
| **AI Gateway** | `functions/api/classify.ts` | `@neon/ai-sdk-provider` + AI SDK `streamText({ output: Output.object(...) })` on `gpt-5-nano` with minimal reasoning (about $0.00007 per image at list prices). Partial results are written to the row as they stream, so the caption and tags fill in live. Set `CLASSIFIER_MODEL` to change the model. |
| **Neon Auth** | `web/src/auth.ts`, `functions/api/auth.ts` | Email/password sign-in. The function verifies the JWT against `NEON_AUTH_JWKS_URL`. |

## Realtime design notes

- **Access control lives in the sealed query.** Realtime has no RLS yet. The function
  bakes the verified user id into each query (`where user_id = $1`) before sealing. The
  browser only ever holds an encrypted capability for that exact query, never the secret.
- **One transaction per stage.** `advance()` updates the job row and inserts the event in
  one transaction, so the jobs list, activity feed, and both aggregates update in the same
  Realtime batch.
- **Four live queries on one socket:**
  - `jobs`: a plain filter;
  - `events`: a join with `ORDER BY … LIMIT 40`;
  - `statuses` and `categories`: `GROUP BY` aggregates.
- **`jobs` is deliberately unordered.** The protocol has no positional "row moved" delta,
  so an ordered or limited query is re-sent as a full reset on every change. Unordered,
  each stage transition arrives as a single-row upsert and the client sorts. The header
  counts applied batches.
- **`awaitTxId`.** Upload and delete responses return `pg_current_xact_id()`. The uploader
  awaits that txid on the jobs subscription to know its row has arrived over Realtime.
- **Renewal.** Capabilities are short-lived. Each `useLiveQuery` has a `refreshQuery` that
  calls `GET /api/live/:name`, and data stays visible as `stale` while it reconnects.

## Running it

You need:

- Node.js 22+ and a Neon project in a region where Functions, Object Storage, and the
  AI Gateway are available.
- A Neon CLI with Realtime support (`neon deploy` for `realtime` in `neon.ts`,
  `neon env pull` for the `NEON_REALTIME_*` values, and `neon subscribe`). At the time of
  writing (Oct 2026) that is a preview build from
  [neondatabase/neon-pkgs#804](https://github.com/neondatabase/neon-pkgs/pull/804);
  use the released `neon` CLI once it includes these commands.
- A paid plan with AI Gateway credits for the classification step. Without them, jobs fail
  visibly at the Classify step with the gateway's error.

```bash
npm install
neon login
neon link --project-id <project-id> --branch <branch>   # pulls NEON_REALTIME_* into .env.local
neon deploy --yes --env .env.local   # auth, AI Gateway, Realtime, bucket, function (+ its env)
npm run db:migrate                   # creates tables + REPLICA IDENTITY FULL
npm run dev                          # http://localhost:5173 (open two tabs)
```

`--env .env.local` matters: `neon.ts` reads the Realtime values from it to forward them
to the function. `.env.example` lists every variable the app expects.

To watch the same rows from a terminal:
`neon subscribe "SELECT stage, progress, status FROM image_jobs"`.

## Layout

```
neon.ts                 backend declaration: auth, aiGateway, realtime, bucket, function
db/schema.sql           tables + replica identity
functions/api/          the Neon Function (Hono)
  index.ts              routes: /api/live, /api/jobs, /api/jobs/:id/images, DELETE /api/jobs/:id
  pipeline.ts           long-running job: storage → sharp → storage → AI Gateway → done
  live.ts               sealed live queries
  classify.ts           streamed structured classification
  auth.ts, storage.ts, db.ts, env.ts
shared/types.ts         row types shared by function and browser
web/                    Vite + React app
```

## Known gaps and trade-offs

The first two reflect Realtime's preview state at the time of writing (Oct 2026).

- **Realtime vars aren't injected into Functions.** Unlike Postgres, Auth, Storage, and
  the AI Gateway, `NEON_REALTIME_*` isn't injected, so `neon.ts` forwards it through the
  function's `env` at deploy time.
- **`neon.ts` is a plain object.** The published `@neon/config` doesn't know the
  `realtime` key yet, so `defineConfig` would reject it; the CLI validates the plain object.
- **Stuck jobs.** `waitUntil` work is capped at 15 minutes and is lost if the isolate is
  evicted. A job interrupted that way stays `processing`. A production version would add a
  scheduled Function Trigger that fails stale jobs, or hand work to a durable queue.
- **Origins aren't restricted.** Realtime currently accepts any origin (`allowed_origins: []`).
  Restrict it with `realtime: { allowedOrigins: ["https://your.app"] }`. The function's CORS
  allowlist is `ALLOWED_ORIGINS`.

## License

[MIT](LICENSE)
