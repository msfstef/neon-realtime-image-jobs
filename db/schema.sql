-- One row per uploaded image. The function advances `stage`/`progress` as it
-- works; browsers watch these rows through Neon Realtime live queries.
create table if not exists image_jobs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references neon_auth."user" (id) on delete cascade,
  filename text not null,
  content_type text not null,
  size_bytes integer not null,

  status text not null default 'queued'
    check (status in ('queued', 'processing', 'completed', 'failed')),
  stage text not null default 'queued',
  progress smallint not null default 0 check (progress between 0 and 100),
  message text,
  error text,

  -- Object storage pointers (bucket `images`).
  original_key text,
  thumb_key text,
  display_key text,

  -- Image facts extracted by sharp.
  width integer,
  height integer,
  format text,
  dominant_color text,

  -- AI Gateway classification. `classification` keeps the full structured
  -- answer; the promoted columns are what the UI and aggregates read.
  category text,
  confidence real,
  caption text,
  tags text[],
  classification jsonb,
  model text,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  started_at timestamptz,
  completed_at timestamptz
);

create index if not exists image_jobs_user_created_idx
  on image_jobs (user_id, created_at desc);

-- Append-only activity log written at every stage transition.
create table if not exists image_job_events (
  id bigint generated always as identity primary key,
  job_id uuid not null references image_jobs (id) on delete cascade,
  user_id uuid not null references neon_auth."user" (id) on delete cascade,
  stage text not null,
  progress smallint not null,
  message text not null,
  created_at timestamptz not null default now()
);

create index if not exists image_job_events_user_id_idx
  on image_job_events (user_id, id desc);

-- Realtime needs full before-images to maintain live query results.
alter table image_jobs replica identity full;
alter table image_job_events replica identity full;
