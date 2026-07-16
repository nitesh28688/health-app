-- 0036_wellness_journal.sql — Wellness journal / "Timecapsule": time-stamped
-- personal entries (treatments, skincare events, habits, moods) the AI can
-- comment on at save time and recall later ("when did I last do laser?").

create table wellness_journal (
  id          bigint generated always as identity primary key,
  user_id     uuid not null references profiles(id) on delete cascade,
  entry_text  text not null,
  entry_at    timestamptz not null default now(),
  -- AI-extracted at save time (one Gemini call): category + tags make recall
  -- reliable even when the question's wording doesn't match the entry's.
  category    text check (category in ('treatment','skincare','hair','mood','habit','health','other')),
  tags        text[] not null default '{}',
  ai_comment  text,
  created_at  timestamptz not null default now(),
  -- Full-text search over the entry plus its extracted tags — pure Postgres,
  -- no embeddings/vector store needed at this scale.
  search_tsv  tsvector generated always as (
    to_tsvector('english', coalesce(entry_text, '') || ' ' || coalesce(array_to_string(tags, ' '), ''))
  ) stored
);

create index idx_wellness_journal_user on wellness_journal (user_id, entry_at desc);
create index idx_wellness_journal_tsv on wellness_journal using gin (search_tsv);

alter table wellness_journal enable row level security;
create policy wellness_journal_all on wellness_journal for all
  using (user_id = auth.uid()) with check (user_id = auth.uid());

-- Ranked FTS with a websearch-style query, scoped to the caller. Falls back to
-- ilike when the tsquery matches nothing (short/partial words like "lasr" typo
-- or "hifu" that stemming may not help with).
create or replace function search_journal(q text)
returns setof wellness_journal
language sql stable security invoker as $$
  with fts as (
    select *, ts_rank(search_tsv, websearch_to_tsquery('english', q)) as rank
    from wellness_journal
    where user_id = auth.uid()
      and search_tsv @@ websearch_to_tsquery('english', q)
    order by rank desc, entry_at desc
    limit 20
  )
  select id, user_id, entry_text, entry_at, category, tags, ai_comment, created_at, search_tsv
  from fts
  union all
  select * from (
    select id, user_id, entry_text, entry_at, category, tags, ai_comment, created_at, search_tsv
    from wellness_journal
    where user_id = auth.uid()
      and not exists (select 1 from fts)
      and (entry_text ilike '%' || q || '%' or array_to_string(tags, ' ') ilike '%' || q || '%')
    order by entry_at desc
    limit 20
  ) fallback;
$$;

-- Widen the ai_suggestions kind cap for the per-entry AI comment.
-- Full list rebuilt from 0032_physio.sql (the LAST migration to touch this
-- constraint — see the Phase 60 lesson in STRUCTURE.md).
alter table ai_suggestions
  drop constraint if exists ai_suggestions_kind_check;
alter table ai_suggestions
  add constraint ai_suggestions_kind_check
  check (kind in (
    'daily_tip', 'daily_tip_calls', 'meal_idea', 'workout_tip', 'food_estimate',
    'assistant_turn', 'workout_suggest', 'form_check', 'skin_scan', 'eye_scan', 'hair_scan',
    'wellness_insight', 'physio_plan', 'journal_comment'
  ));
