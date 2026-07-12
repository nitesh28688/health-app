-- 0031_terms_acceptance.sql — track ToS/Privacy Policy acceptance per user
alter table profiles
  add column if not exists terms_accepted_at timestamptz,
  add column if not exists terms_version text;
