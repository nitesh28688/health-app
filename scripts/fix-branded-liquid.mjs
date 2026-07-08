// One-off correction: seed-usda-branded.mjs derived is_liquid from USDA's
// branded_food_category field, which turned out sparse/inconsistent — Coca-Cola,
// coffee, Red Bull, and protein shakes all came through as is_liquid=false.
// Name-based keyword matching (same approach migration 0017 used for OFF/indb
// foods) is far more reliable since the product name almost always says what it is.
import pg from "pg";
const db = new pg.Client({ connectionString: process.env.SEED_DB_URL });
await db.connect();

const { rowCount } = await db.query(`
  update foods set is_liquid = true
  where indb_code like 'USDABR-%'
    and (
      name ilike '%cola%' or name ilike '%soda%' or name ilike '%coffee%' or name ilike '%tea%'
      or name ilike '%latte%' or name ilike '%cappuccino%' or name ilike '%espresso%'
      or name ilike '%juice%' or name ilike '%milk%' or name ilike '%smoothie%' or name ilike '%shake%'
      or name ilike '%energy drink%' or name ilike '%sports drink%' or name ilike '%lemonade%'
      or name ilike '%beverage%' or name ilike '%drink%' or name ilike '%water%'
      or name ilike '%syrup%' or name ilike '%beer%' or name ilike '%wine%'
    )
    and name not ilike '%powder%' and name not ilike '%bar%' and name not ilike '%candy%'
    and name not ilike '%chocolate%' and name not ilike '%cookie%'
`);
console.log(`corrected is_liquid on ${rowCount} branded foods`);

const { rows: [c] } = await db.query(`select count(*) from foods where indb_code like 'USDABR-%' and is_liquid`);
console.log(`total branded foods now flagged liquid: ${c.count}`);
await db.end();
