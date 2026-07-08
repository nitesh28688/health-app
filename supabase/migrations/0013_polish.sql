-- 0013_polish.sql — guarantee username uniqueness is case-insensitive

create unique index if not exists idx_profiles_username_lower on profiles (lower(username));

create or replace function username_available(u text)
returns boolean language sql stable security definer set search_path = public as $$
  select not exists (select 1 from profiles where lower(username) = lower(u));
$$;
