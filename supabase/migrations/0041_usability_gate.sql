-- 0041_usability_gate.sql — FIX 3: extend the wellness_scans is_usable
-- pattern (0033_wellness_quality.sql) to journal entries and product
-- records, so a noise/low-content row (a one-word journal entry, a product
-- check with an unreadable label) doesn't get read as reliable input by the
-- assistant/advice routes with the same weight as a genuine entry.

alter table wellness_journal add column is_usable boolean not null default true;
alter table wellness_products add column is_usable boolean not null default true;

-- Upgrade search_journal_hybrid (0040) to also return is_usable now that the
-- column exists, so callers (lib/aiTools.ts search_journal) can filter noise
-- out of recall results. Postgres won't let `create or replace` change a
-- function's OUT-parameter row type, so drop first (hit live 2026-07-17).
drop function if exists search_journal_hybrid(text, vector, integer);

create function search_journal_hybrid(q text, query_embedding vector(768), match_count int default 8)
returns table (
  id bigint, entry_text text, entry_at timestamptz, category text, tags text[],
  is_usable boolean, similarity double precision
)
language sql stable security invoker as $$
  with fts as (
    select id, ts_rank(search_tsv, websearch_to_tsquery('english', q)) as rank
    from wellness_journal
    where user_id = auth.uid() and search_tsv @@ websearch_to_tsquery('english', q)
    order by rank desc
    limit match_count
  ),
  vect as (
    select id, 1 - (embedding <=> query_embedding) as similarity
    from wellness_journal
    where user_id = auth.uid() and embedding is not null
    order by embedding <=> query_embedding
    limit match_count
  ),
  combined as (
    select id from fts
    union
    select id from vect
  )
  select wj.id, wj.entry_text, wj.entry_at, wj.category, wj.tags, wj.is_usable,
    coalesce((select v.similarity from vect v where v.id = wj.id), 0) as similarity
  from wellness_journal wj
  join combined c on c.id = wj.id
  order by wj.entry_at desc
  limit match_count * 2;
$$;
