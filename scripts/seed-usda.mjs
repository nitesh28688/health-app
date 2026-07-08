// Seed USDA SR Legacy (public domain) — ~7.8k western/generic foods incl. fast food.
// Idempotent: upserts on indb_code = 'USDA-<fdc_id>'.
// Run: SEED_DB_URL='postgresql://...' node scripts/seed-usda.mjs
import { readFileSync } from "fs";
import pg from "pg";

const DIR = new URL("../data/usda_sr/FoodData_Central_sr_legacy_food_csv_2018-04/", import.meta.url);

// tiny CSV parser (handles quoted fields with commas)
function parseCsv(text) {
  const rows = [];
  let row = [], field = "", inQ = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQ) {
      if (c === '"') { if (text[i + 1] === '"') { field += '"'; i++; } else inQ = false; }
      else field += c;
    } else if (c === '"') inQ = true;
    else if (c === ",") { row.push(field); field = ""; }
    else if (c === "\n") { row.push(field.replace(/\r$/, "")); rows.push(row); row = []; field = ""; }
    else field += c;
  }
  if (field || row.length) { row.push(field); rows.push(row); }
  return rows;
}
const load = (f) => {
  const [header, ...rows] = parseCsv(readFileSync(new URL(f, DIR), "utf8"));
  return rows.filter((r) => r.length === header.length)
    .map((r) => Object.fromEntries(header.map((h, i) => [h, r[i]])));
};

// nutrient_id → our column (all per 100g; USDA units already match ours)
const NUTRIENTS = {
  1008: "kcal", 1003: "protein_g", 1005: "carbs_g", 1004: "fat_g", 1079: "fiber_g",
  2000: "sugar_g", 1258: "sat_fat_g", 1253: "cholesterol_mg",
  1093: "sodium_mg", 1092: "potassium_mg", 1087: "calcium_mg", 1089: "iron_mg",
  1095: "zinc_mg", 1090: "magnesium_mg", 1091: "phosphorus_mg",
  1106: "vit_a_ug", 1162: "vit_c_mg", 1114: "vit_d_ug", 1178: "vit_b12_ug", 1177: "folate_ug",
};

console.log("parsing CSVs…");
const foods = load("food.csv");
const nutrients = load("food_nutrient.csv");
const portions = load("food_portion.csv");
console.log(`${foods.length} foods, ${nutrients.length} nutrient rows, ${portions.length} portions`);

const byFood = new Map();
for (const n of nutrients) {
  const col = NUTRIENTS[+n.nutrient_id];
  if (!col) continue;
  let m = byFood.get(n.fdc_id);
  if (!m) { m = {}; byFood.set(n.fdc_id, m); }
  m[col] = Math.round(parseFloat(n.amount) * 1000) / 1000;
}

const mapped = foods
  .map((f) => ({ fdc: f.fdc_id, name: f.description.trim().slice(0, 200), n: byFood.get(f.fdc_id) }))
  .filter((f) => f.name && f.n && f.n.kcal != null);
console.log(`${mapped.length} foods with kcal`);

const db = new pg.Client({ connectionString: process.env.SEED_DB_URL });
await db.connect();

const cols = ["indb_code", "name", "source", "is_verified", "kcal", "protein_g", "carbs_g", "fat_g", "fiber_g",
  "sat_fat_g", "sugar_g", "cholesterol_mg", "sodium_mg", "potassium_mg", "calcium_mg", "iron_mg", "zinc_mg",
  "magnesium_mg", "phosphorus_mg", "vit_a_ug", "vit_c_mg", "vit_d_ug", "vit_b12_ug", "folate_ug"];

for (let i = 0; i < mapped.length; i += 200) {
  const chunk = mapped.slice(i, i + 200);
  const values = [], params = [];
  chunk.forEach((f, j) => {
    const base = j * cols.length;
    values.push(`(${cols.map((_, k) => `$${base + k + 1}`).join(",")})`);
    params.push(`USDA-${f.fdc}`, f.name, "usda", true,
      f.n.kcal ?? 0, f.n.protein_g ?? 0, f.n.carbs_g ?? 0, f.n.fat_g ?? 0, f.n.fiber_g ?? 0,
      f.n.sat_fat_g ?? null, f.n.sugar_g ?? null, f.n.cholesterol_mg ?? null,
      f.n.sodium_mg ?? null, f.n.potassium_mg ?? null, f.n.calcium_mg ?? null, f.n.iron_mg ?? null,
      f.n.zinc_mg ?? null, f.n.magnesium_mg ?? null, f.n.phosphorus_mg ?? null,
      f.n.vit_a_ug ?? null, f.n.vit_c_mg ?? null, f.n.vit_d_ug ?? null, f.n.vit_b12_ug ?? null,
      f.n.folate_ug ?? null);
  });
  await db.query(
    `insert into foods (${cols.join(",")}) values ${values.join(",")}
     on conflict (indb_code) do update set name=excluded.name, kcal=excluded.kcal,
       protein_g=excluded.protein_g, carbs_g=excluded.carbs_g, fat_g=excluded.fat_g,
       fiber_g=excluded.fiber_g, sat_fat_g=excluded.sat_fat_g, sugar_g=excluded.sugar_g`,
    params);
  process.stdout.write(`foods ${Math.min(i + 200, mapped.length)}/${mapped.length}\r`);
}
console.log("\nfoods upserted");

// servings from food_portion (up to 3 per food)
await db.query(`delete from food_servings where food_id in (select id from foods where source='usda')`);
const { rows: idRows } = await db.query(`select id, indb_code from foods where source='usda'`);
const idByFdc = new Map(idRows.map((r) => [r.indb_code.slice(5), r.id]));

const perFood = new Map();
const servings = [];
for (const p of portions) {
  const fid = idByFdc.get(p.fdc_id);
  if (!fid) continue;
  const g = parseFloat(p.gram_weight);
  const label = (p.modifier || p.portion_description || "").trim().slice(0, 60);
  const count = perFood.get(fid) ?? 0;
  if (!(g > 0) || !label || count >= 3) continue;
  perFood.set(fid, count + 1);
  const amt = parseFloat(p.amount) || 1;
  servings.push([fid, amt === 1 ? label : `${amt} ${label}`, Math.round(g * 10) / 10]);
}
for (let i = 0; i < servings.length; i += 500) {
  const chunk = servings.slice(i, i + 500);
  const values = chunk.map((_, j) => `($${j * 3 + 1},$${j * 3 + 2},$${j * 3 + 3})`).join(",");
  await db.query(`insert into food_servings (food_id, label, grams) values ${values}`, chunk.flat());
}
console.log(`servings inserted: ${servings.length}`);

const { rows: [c] } = await db.query(`select count(*) from foods where source='usda'`);
console.log(`TOTAL usda foods in db: ${c.count}`);
await db.end();
