// Seed INDB (Indian Nutrient Databank) into foods + food_servings.
// Idempotent: upserts on foods.indb_code; rebuilds servings for INDB foods.
// Run: SEED_DB_URL='postgresql://...' node scripts/seed-indb.mjs
import XLSX from 'xlsx';
import pg from 'pg';

const db = new pg.Client({ connectionString: process.env.SEED_DB_URL });
await db.connect();

const wb = XLSX.readFile(new URL('../data/INDB.xlsx', import.meta.url).pathname.replace(/^\/([A-Z]:)/, '$1'));
const rows = XLSX.utils.sheet_to_json(wb.Sheets['Nutrient Data']);
console.log(`INDB rows: ${rows.length}`);

const n = (v) => (v === undefined || v === null || v === '' || Number.isNaN(+v) ? null : Math.round(+v * 1000) / 1000);
const mg = (v) => { const x = n(v); return x === null ? null : Math.round(x) / 1000; }; // sfa_mg -> g

const mapped = rows
  .filter((r) => r.food_code && r.food_name && n(r.energy_kcal) !== null)
  .map((r) => ({
    code: String(r.food_code).trim(),
    name: String(r.food_name).trim().slice(0, 200),
    kcal: n(r.energy_kcal) ?? 0,
    protein_g: n(r.protein_g) ?? 0,
    carbs_g: n(r.carb_g) ?? 0,
    fat_g: n(r.fat_g) ?? 0,
    fiber_g: n(r.fibre_g) ?? 0,
    sat_fat_g: mg(r.sfa_mg),
    sugar_g: n(r.freesugar_g),
    cholesterol_mg: n(r.cholesterol_mg),
    sodium_mg: n(r.sodium_mg),
    potassium_mg: n(r.potassium_mg),
    calcium_mg: n(r.calcium_mg),
    iron_mg: n(r.iron_mg),
    zinc_mg: n(r.zinc_mg),
    magnesium_mg: n(r.magnesium_mg),
    phosphorus_mg: n(r.phosphorus_mg),
    vit_a_ug: n(r.vita_ug),
    vit_c_mg: n(r.vitc_mg),
    vit_d_ug: n(r.vitd2_ug) === null && n(r.vitd3_ug) === null ? null : (n(r.vitd2_ug) ?? 0) + (n(r.vitd3_ug) ?? 0),
    vit_b12_ug: null, // not covered by INDB
    folate_ug: n(r.folate_ug),
    // serving grams derived from per-serving vs per-100g energy ratio
    serving_label: r.servings_unit ? String(r.servings_unit).trim().slice(0, 60) : null,
    serving_g: (n(r.energy_kcal) > 0 && n(r.unit_serving_energy_kcal) > 0)
      ? Math.round((n(r.unit_serving_energy_kcal) / n(r.energy_kcal)) * 100 * 10) / 10
      : null,
  }));

console.log(`valid: ${mapped.length}`);

const cols = ['indb_code','name','source','is_verified','kcal','protein_g','carbs_g','fat_g','fiber_g',
  'sat_fat_g','sugar_g','cholesterol_mg','sodium_mg','potassium_mg','calcium_mg','iron_mg','zinc_mg',
  'magnesium_mg','phosphorus_mg','vit_a_ug','vit_c_mg','vit_d_ug','vit_b12_ug','folate_ug'];

const BATCH = 200;
for (let i = 0; i < mapped.length; i += BATCH) {
  const chunk = mapped.slice(i, i + BATCH);
  const values = [];
  const params = [];
  chunk.forEach((f, j) => {
    const base = j * cols.length;
    values.push(`(${cols.map((_, k) => `$${base + k + 1}`).join(',')})`);
    params.push(f.code, f.name, 'indb', true, f.kcal, f.protein_g, f.carbs_g, f.fat_g, f.fiber_g,
      f.sat_fat_g, f.sugar_g, f.cholesterol_mg, f.sodium_mg, f.potassium_mg, f.calcium_mg, f.iron_mg,
      f.zinc_mg, f.magnesium_mg, f.phosphorus_mg, f.vit_a_ug, f.vit_c_mg, f.vit_d_ug, f.vit_b12_ug, f.folate_ug);
  });
  await db.query(
    `insert into foods (${cols.join(',')}) values ${values.join(',')}
     on conflict (indb_code) do update set
       name=excluded.name, kcal=excluded.kcal, protein_g=excluded.protein_g,
       carbs_g=excluded.carbs_g, fat_g=excluded.fat_g, fiber_g=excluded.fiber_g,
       sat_fat_g=excluded.sat_fat_g, sugar_g=excluded.sugar_g, cholesterol_mg=excluded.cholesterol_mg,
       sodium_mg=excluded.sodium_mg, potassium_mg=excluded.potassium_mg, calcium_mg=excluded.calcium_mg,
       iron_mg=excluded.iron_mg, zinc_mg=excluded.zinc_mg, magnesium_mg=excluded.magnesium_mg,
       phosphorus_mg=excluded.phosphorus_mg, vit_a_ug=excluded.vit_a_ug, vit_c_mg=excluded.vit_c_mg,
       vit_d_ug=excluded.vit_d_ug, folate_ug=excluded.folate_ug`,
    params);
  process.stdout.write(`foods ${Math.min(i + BATCH, mapped.length)}/${mapped.length}\r`);
}
console.log('\nfoods upserted');

// rebuild servings for INDB foods (dataset serving + universal measures)
await db.query(`delete from food_servings where food_id in (select id from foods where source='indb')`);
const { rows: idRows } = await db.query(`select id, indb_code from foods where source='indb'`);
const idByCode = Object.fromEntries(idRows.map((r) => [r.indb_code, r.id]));

const servings = [];
for (const f of mapped) {
  const fid = idByCode[f.code];
  if (!fid) continue;
  if (f.serving_label && f.serving_g && f.serving_g > 0 && f.serving_g < 2000)
    servings.push([fid, f.serving_label, f.serving_g]);
}
for (let i = 0; i < servings.length; i += 500) {
  const chunk = servings.slice(i, i + 500);
  const values = chunk.map((_, j) => `($${j * 3 + 1},$${j * 3 + 2},$${j * 3 + 3})`).join(',');
  await db.query(`insert into food_servings (food_id, label, grams) values ${values}`, chunk.flat());
}
console.log(`servings inserted: ${servings.length}`);

const { rows: [{ count }] } = await db.query(`select count(*) from foods where source='indb'`);
console.log(`TOTAL indb foods in db: ${count}`);
await db.end();
