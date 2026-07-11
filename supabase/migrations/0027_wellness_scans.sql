-- 0027_wellness_scans.sql — Wellness Scans table & Updated suggestions kinds

-- Create wellness_scans table referencing auth.users(id)
create table wellness_scans (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  scan_type text not null check (scan_type in ('skin', 'eye')),
  taken_at date not null default current_date,
  photo_url text not null,
  is_usable boolean not null default true,
  observations jsonb not null, -- Array: [{ area: string, note: string }]
  recommendations jsonb not null, -- Array: [{ ingredient: string, why: string, how_to_use: string }]
  created_at timestamptz not null default now()
);

create index idx_wellness_scans_user on wellness_scans (user_id, scan_type, taken_at desc);

alter table wellness_scans enable row level security;

create policy wellness_scans_all on wellness_scans for all 
  using (user_id = auth.uid()) 
  with check (user_id = auth.uid());

-- Update ai_suggestions_kind_check constraint (10 values)
alter table ai_suggestions
  drop constraint if exists ai_suggestions_kind_check;

alter table ai_suggestions
  add constraint ai_suggestions_kind_check
  check (kind in ('daily_tip', 'daily_tip_calls', 'meal_idea', 'workout_tip', 'food_estimate', 'assistant_turn', 'workout_suggest', 'form_check', 'skin_scan', 'eye_scan'));
