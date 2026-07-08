// USDA Branded Foods is US-market label data — most of the 80k rows are US-only
// SKUs (regional cereal flavors, US-only pack sizes) that a family in India will
// never search for. Trim down to only brands that are actually sold in India/UAE
// with roughly the same recipe — the global brands, not the long tail.
// Dry-run by default (reports what would be deleted); pass --apply to actually delete.
import pg from "pg";

const APPLY = process.argv.includes("--apply");

// Brands genuinely available in India and/or UAE. Deliberately narrower than the
// original seed-usda-branded.mjs allowlist (that one was "could plausibly search
// for this" — this one is "actually stocked on shelves here").
const KEEP_BRANDS = [
  "coca-cola", "coca cola", "pepsi", "sprite", "fanta", "mountain dew", "7up", "7-up",
  "red bull", "monster energy", "gatorade",
  "nescafe", "nescafé", "starbucks", "lipton", "twinings",
  "nestle", "nestlé", "cadbury", "hershey", "mars", "kitkat", "kit kat", "ferrero", "nutella",
  "lays", "lay's", "pringles", "doritos",
  "quest nutrition", "optimum nutrition", "myprotein", "isopure", "ensure",
  "kelloggs", "kellogg's", "quaker", "heinz", "knorr",
];

const db = new pg.Client({ connectionString: process.env.SEED_DB_URL });
await db.connect();

const keepClause = KEEP_BRANDS.map((_, i) => `brand ilike '%'||$${i + 1}||'%'`).join(" or ");

const { rows: [{ count: totalBefore }] } = await db.query(
  `select count(*) as count from foods where indb_code like 'USDABR-%'`);

const { rows: [{ count: toDelete }] } = await db.query(
  `select count(*) as count from foods where indb_code like 'USDABR-%'
   and not (${keepClause})
   and not exists (select 1 from food_logs fl where fl.food_id = foods.id)`,
  KEEP_BRANDS);

console.log(`USDA branded foods currently: ${totalBefore}`);
console.log(`Would delete (not in India/UAE brand allowlist, not logged by anyone): ${toDelete}`);
console.log(`Would remain: ${totalBefore - toDelete}`);

if (!APPLY) {
  console.log("\nDry run only — rerun with --apply to actually delete.");
} else {
  const { rowCount } = await db.query(
    `delete from foods where indb_code like 'USDABR-%'
     and not (${keepClause})
     and not exists (select 1 from food_logs fl where fl.food_id = foods.id)`,
    KEEP_BRANDS);
  console.log(`\ndeleted ${rowCount} rows`);
  const { rows: [c] } = await db.query(`select count(*) from foods where indb_code like 'USDABR-%'`);
  console.log(`remaining USDA branded foods: ${c.count}`);
}
await db.end();
