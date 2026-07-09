// Same two-part cleanup as dedupe-branded.mjs / remove-ambiguous-branded.mjs
// (USDA branded foods), applied to the 'off' source. OFF's problem is much smaller
// in absolute terms (93 of 2,671 rows vs. USDA's tens of thousands) but the same two
// failure modes exist:
// 1. Pack-size/resubmission duplicates — same product, near-identical macros, just a
//    different barcode or a second crowdsourced entry. Collapse to the lowest-id row.
// 2. Ambiguous rows — same (brand, name) but macros genuinely differ with no
//    flavor/variant text to tell them apart (e.g. multiple "Maggi" entries at very
//    different kcal/100g). No way for a user to know which is right; delete rather
//    than guess.
// Unlike the USDA scripts, matching here is case-insensitive (lower(brand), lower(name))
// — OFF's crowdsourced brand/name casing is inconsistent ("maggi" vs "Maggi" vs "MAGGI"
// are all the same product, confirmed 2026-07-09).
// Dry-run by default; pass --apply to actually delete. Skips anything already logged.
import pg from "pg";

const APPLY = process.argv.includes("--apply");
const db = new pg.Client({ connectionString: process.env.SEED_DB_URL });
await db.connect();

const normalizedCte = `
  with normalized as (
    select id, lower(coalesce(brand, '')) as brand, lower(trim(name)) as norm_name,
      round(kcal) as kcal_r, round(protein_g) as protein_r, round(carbs_g) as carbs_r, round(fat_g) as fat_r
    from foods where source = 'off'
  ),
  dup_ranked as (
    select id, row_number() over (
      partition by brand, norm_name, kcal_r, protein_r, carbs_r, fat_r order by id
    ) as rn
    from normalized
  ),
  dup_deletable as (
    select r.id from dup_ranked r where r.rn > 1
    and not exists (select 1 from food_logs fl where fl.food_id = r.id)
  )
`;

const { rows: [{ count: dupCount }] } = await db.query(`${normalizedCte} select count(*) from dup_deletable`);
console.log(`pack-size/resubmission duplicates: ${dupCount}`);

if (APPLY && dupCount > 0) {
  const { rowCount } = await db.query(`${normalizedCte} delete from foods where id in (select id from dup_deletable)`);
  console.log(`  deleted ${rowCount}`);
}

const ambiguousCte = `
  with ambiguous_groups as (
    select lower(coalesce(brand, '')) as brand, lower(trim(name)) as norm_name
    from foods where source = 'off'
    group by lower(coalesce(brand, '')), lower(trim(name))
    having count(*) > 1
  ),
  amb_deletable as (
    select f.id from foods f
    join ambiguous_groups g on lower(coalesce(f.brand, '')) = g.brand and lower(trim(f.name)) = g.norm_name
    where f.source = 'off'
    and not exists (select 1 from food_logs fl where fl.food_id = f.id)
  )
`;

const { rows: [{ count: ambCount }] } = await db.query(`${ambiguousCte} select count(*) from amb_deletable`);
console.log(`ambiguous rows (same name/brand, differing macros, no way to tell apart): ${ambCount}`);

if (!APPLY) {
  console.log("\nDry run only — rerun with --apply to actually delete both categories.");
} else {
  if (ambCount > 0) {
    const { rowCount } = await db.query(`${ambiguousCte} delete from foods where id in (select id from amb_deletable)`);
    console.log(`  deleted ${rowCount}`);
  }
  const { rows: [c] } = await db.query(`select count(*) from foods where source = 'off'`);
  console.log(`\nremaining OFF foods: ${c.count}`);
}
await db.end();
