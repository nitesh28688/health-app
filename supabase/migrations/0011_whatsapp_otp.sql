-- 0011_whatsapp_otp.sql — WhatsApp OTP login support

-- E.164 phone on profile (set by the user in Profile after first email login)
alter table profiles add column phone text unique
  check (phone ~ '^\+[1-9][0-9]{7,14}$');

-- OTP store: written/read ONLY by the server (service role). RLS on, no policies.
create table wa_otps (
  id         bigint generated always as identity primary key,
  phone      text not null,
  code_hash  text not null,           -- sha256(code + pepper)
  expires_at timestamptz not null,
  attempts   smallint not null default 0,
  created_at timestamptz not null default now()
);
create index idx_wa_otps_phone on wa_otps (phone, created_at desc);
alter table wa_otps enable row level security;  -- no policies = clients can't touch it
