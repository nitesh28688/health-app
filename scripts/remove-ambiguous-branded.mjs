// USDA branded foods where (brand, name) is identical across multiple rows but the
// macros differ are NOT pack-size duplicates (dedupe-branded.mjs already handled
// those) — they're genuinely different products (different flavors/recipes) whose
// distinguishing detail simply isn't in USDA's description field for these SKUs.
// Confirmed 2026-07-09: "Coffee Creamer" (Nestle) has 32 such rows spanning 67-600
// kcal/100g with zero way to tell which is French Vanilla vs Original vs Hazelnut.
// A user has no way to pick the right one, so keeping any of them risks silently
// wrong macro logging — safer to delete and let the AI fallback (which reads the
// user's actual search text) produce a correctly-labeled, product-specific entry.
// Dry-run by default; pass --apply to actually delete. Skips anything already in a
// user's food_logs (same guard as dedupe-branded.mjs / trim-usda-branded.mjs).
import pg from "pg";

const APPLY = process.argv.includes("--apply");
const db = new pg.Client({ connectionString: process.env.SEED_DB_URL });
await db.connect();

const ambiguousCte = `
  with ambiguous_groups as (
    select brand, name from foods
    where indb_code like 'USDABR-%'
    group by brand, name
    having count(*) > 1
  ),
  deletable as (
    select f.id from foods f
    join ambiguous_groups g on f.brand = g.brand and f.name = g.name
    where f.indb_code like 'USDABR-%'
    and not exists (select 1 from food_logs fl where fl.food_id = f.id)
  )
`;

const { rows: [{ count }] } = await db.query(`${ambiguousCte} select count(*) from deletable`);
console.log(`${count} rows in ambiguous (brand,name) groups found (will be deleted)`);

if (!APPLY) {
  console.log("Dry run only — rerun with --apply to actually delete.");
} else {
  const { rowCount } = await db.query(`${ambiguousCte} delete from foods where id in (select id from deletable)`);
  console.log(`deleted ${rowCount} rows`);
  const { rows: [c] } = await db.query(`select count(*) from foods where indb_code like 'USDABR-%'`);
  console.log(`remaining branded foods: ${c.count}`);
}
await db.end();
