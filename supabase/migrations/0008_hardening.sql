-- 0008_hardening.sql — structural privacy for friend-facing profile reads + shared-foods index

-- Friend-facing profile card: ONLY these columns, enforced by the database.
-- (RLS on profiles still allows friends to select the base row; Sonnet must use
-- this view for anything friend-facing. security_invoker keeps RLS applied.)
create or replace view public_profiles
with (security_invoker = true) as
  select id, username, display_name, created_at
  from profiles;

-- Speeds the friends-feed recipe scan and any "shared with me" listing:
-- shared foods are a tiny fraction of the table, so a partial index is near-free.
create index idx_foods_shared on foods (owner_id, created_at desc) where shared;
