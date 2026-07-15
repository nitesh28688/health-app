-- 0034_womens_health.sql — cycle tracking always-on for women (Trends card,
-- no more opt-in toggle), structured symptom tags, PCOS/PCOD condition flags

alter table profiles drop column track_cycle;
alter table profiles add column conditions text[] not null default '{}';
-- allowed values enforced in app code (womensHealth.ts), not a check constraint,
-- so we can add conditions later without a migration

alter table cycle_logs add column symptom_tags text[] not null default '{}';
