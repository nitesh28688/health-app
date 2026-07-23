-- Migration 0044: Wellness Discover & Protocols

create table public.wellness_protocols (
    id uuid primary key default gen_random_uuid(),
    user_id uuid references auth.users not null,
    title text not null,
    description text,
    duration_days int not null default 30,
    start_date date not null default current_date,
    status text not null default 'active', -- active, completed, abandoned
    tasks jsonb not null default '[]'::jsonb, -- [{ "id": "uuid", "name": "Task", "time": "am/pm/any" }]
    created_at timestamptz not null default now()
);

create table public.wellness_protocol_logs (
    protocol_id uuid references public.wellness_protocols on delete cascade not null,
    user_id uuid references auth.users not null,
    log_date date not null,
    completed_task_ids jsonb not null default '[]'::jsonb,
    primary key (protocol_id, log_date)
);

alter table public.wellness_protocols enable row level security;
alter table public.wellness_protocol_logs enable row level security;

create policy "Users can view their own protocols"
    on public.wellness_protocols for select
    using (auth.uid() = user_id);

create policy "Users can insert their own protocols"
    on public.wellness_protocols for insert
    with check (auth.uid() = user_id);

create policy "Users can update their own protocols"
    on public.wellness_protocols for update
    using (auth.uid() = user_id);

create policy "Users can delete their own protocols"
    on public.wellness_protocols for delete
    using (auth.uid() = user_id);

create policy "Users can view their own protocol logs"
    on public.wellness_protocol_logs for select
    using (auth.uid() = user_id);

create policy "Users can insert their own protocol logs"
    on public.wellness_protocol_logs for insert
    with check (auth.uid() = user_id);

create policy "Users can update their own protocol logs"
    on public.wellness_protocol_logs for update
    using (auth.uid() = user_id);

create policy "Users can delete their own protocol logs"
    on public.wellness_protocol_logs for delete
    using (auth.uid() = user_id);
