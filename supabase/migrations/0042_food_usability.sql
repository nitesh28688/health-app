-- 0042_food_usability.sql — extend the is_usable pattern (0033 scans, 0041
-- journal/products) to AI-photo food estimates: a blurry/ambiguous food
-- photo shouldn't silently get the same trust as a clear one. Flag-only per
-- explicit scope decision — still counts toward daily totals, just surfaced
-- as a "low confidence" badge so the user knows to double-check it.

alter table foods add column is_usable boolean not null default true;
