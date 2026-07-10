-- Offline write queue support: a client-generated idempotency key for the four
-- in-scope tables that had no existing natural unique constraint to dedupe on.
-- Nullable + unique is fine — Postgres allows any number of NULL rows under a
-- unique constraint, so pre-existing rows (and any write that doesn't go
-- through offlineWrite()) are unaffected. A retried queued write reuses the
-- same client_id; a second insert attempt hits 23505 (unique_violation),
-- which replayQueue.ts treats as "already succeeded" rather than an error.
--
-- body_metrics (PK user_id,log_date), cycle_logs (unique user_id,period_start),
-- and cheers (unique from_user,to_user,log_date,kind) already have a usable
-- natural key — no column needed for those. fasting_sessions' PK `id` is
-- already a client-assignable uuid, so the client just sends its own id.

alter table food_logs       add column client_id uuid unique;
alter table water_logs      add column client_id uuid unique;
alter table workout_logs    add column client_id uuid unique;
alter table medication_logs add column client_id uuid unique;
