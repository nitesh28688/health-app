// USDA Branded Foods has a separate row per UPC — every pack size, bottle vs can,
// and multi-pack count of the SAME product is its own entry (confirmed: 267 near-
// identical Cheez-It rows, 150 Diet Pepsi variants all labeled "Diet Cola"). That's
// real data, not an insertion bug, but it's unusable clutter for search — nobody
// needs to pick between 24 sizes of Diet Coke to log a can.
//
// Dedup rule: group by (brand, name with pack-size/container noise stripped,
// macros rounded to the nearest whole number) and keep only the lowest-id row per
// group. Never deletes a food any user has already logged (food_logs.food_id is
// ON DELETE RESTRICT, so this would fail loudly instead of silently corrupting
// someone's diary anyway — the check here just skips those up front for a clean run).
//
// Run with no args first (dry run, reports count only). Pass --apply to actually delete.
import pg from "pg";

const APPLY = process.argv.includes("--apply");
const db = new pg.Client({ connectionString: process.env.SEED_DB_URL });
await db.connect();

const normalizedCte = `
  with normalized as (
    select f.id, f.brand,
      trim(regexp_replace(
        regexp_replace(split_part(f.name, ',', 1), '\\s+(Bottles?|Cans?|Jugs?|Jars?|Boxes?|Bags?|Cartons?|Packs?|Pouches?)$', '', 'i'),
        '\\s+$', ''
      )) as norm_name,
      round(f.kcal) as kcal_r, round(f.protein_g) as protein_r, round(f.carbs_g) as carbs_r, round(f.fat_g) as fat_r
    from foods f
    where f.indb_code like 'USDABR-%'
  ),
  ranked as (
    select n.id, row_number() over (
      partition by n.brand, n.norm_name, n.kcal_r, n.protein_r, n.carbs_r, n.fat_r
      order by n.id
    ) as rn
    from normalized n
  ),
  deletable as (
    select r.id from ranked r
    where r.rn > 1
    and not exists (select 1 from food_logs fl where fl.food_id = r.id)
  )
`;

const { rows: [{ count }] } = await db.query(`${normalizedCte} select count(*) from deletable`);
console.log(`${count} duplicate rows found (will be deleted, keeping one per distinct product)`);

if (!APPLY) {
  console.log("Dry run only — rerun with --apply to actually delete.");
} else {
  const { rowCount } = await db.query(`${normalizedCte} delete from foods where id in (select id from deletable)`);
  console.log(`deleted ${rowCount} rows`);
  const { rows: [c] } = await db.query(`select count(*) from foods where indb_code like 'USDABR-%'`);
  console.log(`remaining branded foods: ${c.count}`);
}
await db.end();
