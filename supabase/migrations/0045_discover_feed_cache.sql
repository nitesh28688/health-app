-- Migration 0045: Wellness Discover Feed Cache

create table public.wellness_discover_feed_cache (
    user_id uuid references auth.users not null primary key,
    items jsonb not null default '[]'::jsonb,
    updated_at timestamptz not null default now()
);

alter table public.wellness_discover_feed_cache enable row level security;

create policy "Users can view their own feed cache"
    on public.wellness_discover_feed_cache for select
    using (auth.uid() = user_id);

create policy "Users can insert their own feed cache"
    on public.wellness_discover_feed_cache for insert
    with check (auth.uid() = user_id);

create policy "Users can update their own feed cache"
    on public.wellness_discover_feed_cache for update
    using (auth.uid() = user_id);
