-- 0035_ai_personalization.sql — user-editable assistant tone/name

alter table profiles add column ai_tone text not null default 'balanced';
-- allowed values enforced in app code (aiTone.ts), not a check constraint,
-- same reasoning as profiles.conditions in 0034
alter table profiles add column ai_name text;
