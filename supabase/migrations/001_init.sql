-- Instagram post metrics: posts, point-in-time metric snapshots, and a HikerAPI call log.
-- Run once in the Supabase SQL editor (or `supabase db push`).

create table posts (
  id uuid primary key default gen_random_uuid(),
  shortcode text unique not null,
  media_pk text,
  owner_username text,
  owner_pk text,
  media_type int,
  product_type text,
  caption text,
  taken_at timestamptz,
  first_seen_at timestamptz not null default now(),
  last_fetched_at timestamptz
);

create table post_metric_snapshots (
  id uuid primary key default gen_random_uuid(),
  post_id uuid not null references posts(id) on delete cascade,
  fetched_at timestamptz not null default now(),
  source_endpoint text not null,          -- 'v2_by_url' | 'v1_by_url'
  like_count bigint,
  comment_count bigint,
  play_count bigint,
  ig_play_count bigint,
  fb_play_count bigint,
  reshare_count bigint,
  save_count bigint,                       -- always null for now
  likes_hidden boolean,
  shares_disabled boolean,
  raw_json jsonb not null
);
create index on post_metric_snapshots (post_id, fetched_at desc);

create table hiker_api_calls (
  id uuid primary key default gen_random_uuid(),
  called_at timestamptz not null default now(),
  endpoint text not null,
  shortcode text,
  http_status int,
  duration_ms int,
  error text
);
create index on hiker_api_calls (called_at desc);

-- Each post joined with its most recent snapshot (raw_json omitted). Backs GET /api/posts,
-- which needs to sort and paginate by latest views/likes in the database.
-- security_invoker makes the view obey the underlying tables' RLS instead of the owner's rights.
create view post_latest_metrics with (security_invoker = true) as
select
  p.*,
  s.id as snapshot_id,
  s.fetched_at,
  s.source_endpoint,
  s.like_count,
  s.comment_count,
  s.play_count,
  s.ig_play_count,
  s.fb_play_count,
  s.reshare_count,
  s.save_count,
  s.likes_hidden,
  s.shares_disabled
from posts p
left join lateral (
  select *
  from post_metric_snapshots ps
  where ps.post_id = p.id
  order by ps.fetched_at desc
  limit 1
) s on true;

-- RLS on, no policies: anon/authenticated roles get nothing. The server uses the service role,
-- which bypasses RLS.
alter table posts enable row level security;
alter table post_metric_snapshots enable row level security;
alter table hiker_api_calls enable row level security;

revoke all on post_latest_metrics from anon, authenticated;
