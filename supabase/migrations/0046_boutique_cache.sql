-- Migration 0046: Add boutique matches to feed cache

alter table public.wellness_discover_feed_cache 
add column boutique_matches jsonb not null default '[]'::jsonb;
