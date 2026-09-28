-- Adds reposts (v2 media_repost_count). Saves already have a column; v2 turned out to return
-- save_count, so it is now populated when present.
-- Run once in the Supabase SQL editor after 001_init.sql.

alter table post_metric_snapshots add column repost_count bigint;

-- create or replace can only append columns to a view, so repost_count goes last.
create or replace view post_latest_metrics with (security_invoker = true) as
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
  s.shares_disabled,
  s.repost_count
from posts p
left join lateral (
  select *
  from post_metric_snapshots ps
  where ps.post_id = p.id
  order by ps.fetched_at desc
  limit 1
) s on true;

revoke all on post_latest_metrics from anon, authenticated;
