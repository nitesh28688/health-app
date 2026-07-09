// Full removal of USDA Branded Foods ('usda' source, indb_code prefix 'USDABR-').
// After three cleanup passes (trim/dedupe/remove-ambiguous, see STRUCTURE.md Round 8)
// this was still down to US-only packaging conventions the family doesn't use — serving
// labels like "0.125 PACKET (MAKES 8 FL OZ PREPARED)" or "1 K-CUP pod" that don't map
// to anything sold in India/UAE. Decision 2026-07-09: not worth maintaining, remove
// entirely. USDA SR Legacy (plain 'USDA-' prefix, generic foods like rice/chicken/apple)
// is untouched — separate dataset, no reported issues, not seeded from the same script.
// food_servings cascades automatically on food delete (FK ON DELETE CASCADE). food_logs
// and recipe_ingredients.ingredient_id are ON DELETE RESTRICT, so any USDA branded food
// a user has actually logged or used in a recipe is skipped, not force-deleted — deleting
// someone's diary history is not an acceptable side effect of a data-source cleanup.
// Dry-run by default; pass --apply to actually delete.
import pg from "pg";

const APPLY = process.argv.includes("--apply");
const db = new pg.Client({ connectionString: process.env.SEED_DB_URL });
await db.connect();

const deletableCte = `
  with deletable as (
    select f.id from foods f
    where f.indb_code like 'USDABR-%'
    and not exists (select 1 from food_logs fl where fl.food_id = f.id)
    and not exists (select 1 from recipe_ingredients ri where ri.ingredient_id = f.id)
  )
`;

const { rows: [{ count: totalBefore }] } = await db.query(
  `select count(*) as count from foods where indb_code like 'USDABR-%'`);
const { rows: [{ count: deletable }] } = await db.query(`${deletableCte} select count(*) from deletable`);
const skipped = totalBefore - deletable;

console.log(`USDA branded foods currently: ${totalBefore}`);
console.log(`Deletable: ${deletable}`);
console.log(`Skipped (logged by a user or used in a recipe): ${skipped}`);

if (!APPLY) {
  console.log("\nDry run only — rerun with --apply to actually delete.");
} else {
  const { rowCount } = await db.query(`${deletableCte} delete from foods where id in (select id from deletable)`);
  console.log(`\ndeleted ${rowCount} rows`);
  const { rows: [c] } = await db.query(`select count(*) from foods where indb_code like 'USDABR-%'`);
  console.log(`remaining USDA branded foods: ${c.count} (all skipped — still referenced by a user's data)`);
}
await db.end();
