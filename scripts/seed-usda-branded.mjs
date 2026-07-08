// Seed USDA Branded Foods (public domain, offline bulk CSV — no live API, no rate
// limits, unlike Open Food Facts which throttles hard and unpredictably).
// This dataset is US-market label data, so Indian-specific SKUs are sparse, but it
// covers most global brands sold in India too (Coca-Cola, Pepsi, Red Bull, Nescafe,
// protein powders/bars, etc). Filtered to relevant categories to avoid importing
// all ~2M branded rows (things like "US-only regional deli meat #4821" aren't useful).
//
// Download once (~427MB zip / 2.9GB unzipped) from:
//   https://fdc.nal.usda.gov/fdc-datasets/FoodData_Central_branded_food_csv_<date>.zip
// unzip into data/usda_branded/ (so this script sees food.csv, branded_food.csv,
// food_nutrient.csv alongside it).
//
// Idempotent: upserts on indb_code = 'USDABR-<fdc_id>'.
// Run: SEED_DB_URL='postgresql://...' node scripts/seed-usda-branded.mjs
import { createReadStream } from "fs";
import pg from "pg";

const DIR = new URL("../data/usda_branded/", import.meta.url);

// Streaming CSV parser (state machine, handles quoted fields with embedded commas
// AND newlines — branded_food.csv's "ingredients" column has both). Reading the
// whole 2.9GB file into memory like seed-usda.mjs does for SR Legacy isn't viable here.
async function* csvStream(filename) {
  const stream = createReadStream(new URL(filename, DIR), { encoding: "utf8" });
  let field = "", row = [], inQ = false, header = null;
  for await (const chunk of stream) {
    for (let i = 0; i < chunk.length; i++) {
      const c = chunk[i];
      if (inQ) {
        if (c === '"') { if (chunk[i + 1] === '"') { field += '"'; i++; } else inQ = false; }
        else field += c;
      } else if (c === '"') inQ = true;
      else if (c === ",") { row.push(field); field = ""; }
      else if (c === "\n") {
        row.push(field.replace(/\r$/, "")); field = "";
        if (!header) { header = row; row = []; continue; }
        yield Object.fromEntries(header.map((h, j) => [h, row[j]]));
        row = [];
      } else field += c;
    }
  }
  if (field || row.length) { row.push(field); if (header) yield Object.fromEntries(header.map((h, j) => [h, row[j]])); }
}

// Brand allowlist, not category keywords — USDA's branded_food_category taxonomy
// has thousands of values and generic words like "snack"/"bar"/"sauce" matched
// 1.1M of ~2M rows on a first attempt, far too much for a 500MB free Postgres.
// Filtering by the actual global brands people search for (the ones flagged as
// missing: Coca-Cola, coffee, protein shakes) keeps this bounded and relevant.
const ALLOWED_BRAND_KEYWORDS = [
  "coca-cola", "coca cola", "pepsi", "sprite", "fanta", "mountain dew", "7up", "7-up",
  "thums up", "limca", "mirinda", "red bull", "monster energy", "gatorade", "powerade",
  "nescafe", "nescafé", "starbucks", "lipton", "tetley", "twinings", "bru",
  "amul", "nestle", "nestlé", "britannia", "parle", "haldiram",
  "quest nutrition", "optimum nutrition", "muscle milk", "premier protein",
  "myprotein", "isopure", "ensure", "boost", "pediasure", "horlicks", "bournvita",
  "cadbury", "hershey", "mars", "kitkat", "kit kat", "ferrero", "nutella",
  "lays", "lay's", "pringles", "doritos", "kurkure", "bingo",
  "kelloggs", "kellogg's", "quaker", "maggi", "knorr", "heinz",
];

console.log("pass 1: scanning branded_food.csv for allowed brands…");
const allowed = new Map(); // fdc_id -> { brand, category, servingSize, servingUnit, household }
let scanned = 0;
for await (const r of csvStream("branded_food.csv")) {
  scanned++;
  if (scanned % 200000 === 0) process.stdout.write(`  scanned ${scanned}, kept ${allowed.size}\r`);
  const brand = `${r.brand_name || ""} ${r.brand_owner || ""}`.toLowerCase();
  if (!ALLOWED_BRAND_KEYWORDS.some((k) => brand.includes(k))) continue;
  allowed.set(r.fdc_id, {
    brand: (r.brand_name || r.brand_owner || "").trim().slice(0, 80) || null,
    category: r.branded_food_category || null,
    servingSize: parseFloat(r.serving_size) || null,
    servingUnit: (r.serving_size_unit || "").toLowerCase(),
    household: (r.household_serving_fulltext || "").trim().slice(0, 60) || null,
  });
}
console.log(`\npass 1 done: ${allowed.size} branded foods matched brand allowlist (of ${scanned} scanned)`);

console.log("pass 2: reading descriptions from food.csv…");
const descriptions = new Map();
for await (const r of csvStream("food.csv")) {
  if (allowed.has(r.fdc_id)) descriptions.set(r.fdc_id, (r.description || "").trim().slice(0, 200));
}
console.log(`pass 2 done: ${descriptions.size} descriptions found`);

const NUTRIENTS = {
  1008: "kcal", 1003: "protein_g", 1005: "carbs_g", 1004: "fat_g", 1079: "fiber_g",
  2000: "sugar_g", 1258: "sat_fat_g", 1253: "cholesterol_mg",
  1093: "sodium_mg", 1092: "potassium_mg", 1087: "calcium_mg", 1089: "iron_mg",
};
// Column precision caps from the schema (numeric(p,s) → max abs value 10^(p-s) - 1) —
// crowdsourced/label data has occasional garbage (units off by 1000x etc). Clamp
// instead of letting Postgres reject the whole batch on one bad row, same approach
// seed-off.mjs already uses.
const CLAMP = {
  kcal: 99999, protein_g: 9999, carbs_g: 9999, fat_g: 9999, fiber_g: 9999,
  sugar_g: 9999, sat_fat_g: 9999, cholesterol_mg: 99999,
  sodium_mg: 999999, potassium_mg: 999999, calcium_mg: 999999, iron_mg: 9999,
};
console.log("pass 3: reading nutrients from food_nutrient.csv (this is the big file)…");
const nutrientsByFood = new Map();
let nRows = 0;
for await (const r of csvStream("food_nutrient.csv")) {
  nRows++;
  if (nRows % 2000000 === 0) process.stdout.write(`  scanned ${nRows} nutrient rows\r`);
  if (!allowed.has(r.fdc_id)) continue;
  const col = NUTRIENTS[+r.nutrient_id];
  if (!col) continue;
  let m = nutrientsByFood.get(r.fdc_id);
  if (!m) { m = {}; nutrientsByFood.set(r.fdc_id, m); }
  const v = parseFloat(r.amount);
  if (!Number.isNaN(v) && Math.abs(v) <= CLAMP[col]) m[col] = Math.round(v * 1000) / 1000;
}
console.log(`\npass 3 done: nutrients found for ${nutrientsByFood.size} of ${allowed.size} candidate foods`);

// Liquids: beverages/coffee/tea/juice/dairy-drinks measured in ml, not grams.
// Name-based, not category-based — USDA's branded_food_category field is sparse/
// inconsistent enough that a first attempt using it left Coca-Cola, Red Bull, and
// protein shakes all flagged is_liquid=false. The product name reliably says what it is.
const LIQUID_NAME_KEYWORDS = [
  "cola", "soda", "coffee", "tea", "latte", "cappuccino", "espresso", "juice", "milk",
  "smoothie", "shake", "energy drink", "sports drink", "lemonade", "beverage", "drink",
  "water", "syrup", "beer", "wine",
];
const NOT_LIQUID_KEYWORDS = ["powder", "bar", "candy", "chocolate", "cookie"];
const isLiquidByName = (name) => {
  const n = (name || "").toLowerCase();
  return LIQUID_NAME_KEYWORDS.some((k) => n.includes(k)) && !NOT_LIQUID_KEYWORDS.some((k) => n.includes(k));
};

const mapped = [];
for (const [fdcId, info] of allowed) {
  const name = descriptions.get(fdcId);
  const n = nutrientsByFood.get(fdcId);
  if (!name || name.length < 3 || !n || n.kcal == null || n.kcal > 900) continue;
  if (n.protein_g == null || n.carbs_g == null || n.fat_g == null) continue;
  mapped.push({ fdcId, name, ...info, n });
}
console.log(`${mapped.length} branded foods ready to insert`);

const db = new pg.Client({ connectionString: process.env.SEED_DB_URL });
await db.connect();

const cols = ["indb_code", "name", "brand", "source", "is_liquid", "kcal", "protein_g", "carbs_g",
  "fat_g", "fiber_g", "sat_fat_g", "sugar_g", "cholesterol_mg", "sodium_mg", "potassium_mg", "calcium_mg", "iron_mg"];

for (let i = 0; i < mapped.length; i += 200) {
  const chunk = mapped.slice(i, i + 200);
  const values = [], params = [];
  chunk.forEach((f, j) => {
    const base = j * cols.length;
    values.push(`(${cols.map((_, k) => `$${base + k + 1}`).join(",")})`);
    params.push(`USDABR-${f.fdcId}`, f.name, f.brand, "usda", isLiquidByName(f.name),
      f.n.kcal ?? 0, f.n.protein_g ?? 0, f.n.carbs_g ?? 0, f.n.fat_g ?? 0, f.n.fiber_g ?? 0,
      f.n.sat_fat_g ?? null, f.n.sugar_g ?? null, f.n.cholesterol_mg ?? null,
      f.n.sodium_mg ?? null, f.n.potassium_mg ?? null, f.n.calcium_mg ?? null, f.n.iron_mg ?? null);
  });
  await db.query(
    `insert into foods (${cols.join(",")}) values ${values.join(",")}
     on conflict (indb_code) do update set name=excluded.name, brand=excluded.brand,
       is_liquid=excluded.is_liquid, kcal=excluded.kcal, protein_g=excluded.protein_g,
       carbs_g=excluded.carbs_g, fat_g=excluded.fat_g, sugar_g=excluded.sugar_g`,
    params);
  process.stdout.write(`inserted ${Math.min(i + 200, mapped.length)}/${mapped.length}\r`);
}
console.log("\nfoods upserted");

// household-serving text as a food_servings row, when USDA gave us one
// (e.g. "1 bottle", "1 can (12 fl oz)") — parsed loosely, skipped if unclear.
await db.query(`delete from food_servings where food_id in (select id from foods where indb_code like 'USDABR-%')`);
const { rows: idRows } = await db.query(`select id, indb_code from foods where indb_code like 'USDABR-%'`);
const idByFdc = new Map(idRows.map((r) => [r.indb_code.slice(7), r.id]));

const GRAMS_PER_ML = 1; // close enough for water-based drinks; per-serving override exists in the UI
const servings = [];
for (const f of mapped) {
  const fid = idByFdc.get(f.fdcId);
  if (!fid || !f.household || !(f.servingSize > 0)) continue;
  const grams = f.servingUnit === "ml" ? f.servingSize * GRAMS_PER_ML : f.servingUnit === "g" ? f.servingSize : null;
  if (!grams) continue;
  servings.push([fid, f.household, Math.round(grams * 10) / 10]);
}
for (let i = 0; i < servings.length; i += 500) {
  const chunk = servings.slice(i, i + 500);
  const values = chunk.map((_, j) => `($${j * 3 + 1},$${j * 3 + 2},$${j * 3 + 3})`).join(",");
  await db.query(`insert into food_servings (food_id, label, grams) values ${values}`, chunk.flat());
}
console.log(`servings inserted: ${servings.length}`);

const { rows: [c] } = await db.query(`select count(*) from foods where indb_code like 'USDABR-%'`);
console.log(`TOTAL usda branded foods in db: ${c.count}`);
await db.end();
