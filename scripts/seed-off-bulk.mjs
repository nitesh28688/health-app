// Seed Open Food Facts from the full bulk CSV export instead of the live API.
// The API throttles hard and unpredictably (multi-day IP blocks after ~10 requests —
// see seed-off.mjs and STRUCTURE.md Round 8); the bulk export is OFF's officially
// recommended path for anything more than a handful of lookups. No rate limits.
//
// Download once (~1GB gz, ~10GB unzipped — we stream-decompress, never write the
// unzipped file):
//   https://static.openfoodfacts.org/data/en.openfoodfacts.org.products.csv.gz
// into data/off_dump/products.csv.gz (gitignored, delete after seeding).
//
// The export is TAB-separated with no quoting (per OFF docs), so parsing is a
// straight split — none of the quoted-field state machine seed-usda-branded.mjs needs.
//
// Filters to products tagged India or UAE with a usable name + complete macros,
// same validity rules and clamps seed-off.mjs applies to API results.
// Idempotent: upserts on indb_code = 'OFF-<barcode>', same key as the API seeder,
// so the existing 172 API-seeded rows are updated in place, never duplicated.
// Run: SEED_DB_URL='postgresql://...' node scripts/seed-off-bulk.mjs
import { createReadStream } from "fs";
import { createGunzip } from "zlib";
import pg from "pg";

const FILE = new URL("../data/off_dump/products.csv.gz", import.meta.url);

const n = (v) => (v === undefined || v === null || v === "" || Number.isNaN(+v) ? null : Math.round(+v * 1000) / 1000);
const clamp = (v, max) => (v !== null && Math.abs(v) <= max ? v : null);

// Three-tier heuristic (evolved from seed-off.mjs / seed-usda-branded.mjs after the
// first bulk seed flagged "Amul Cheese Slices" liquid via the "milk" substring):
// 1. strong liquid phrases win outright — "buttermilk" must not lose to the "butter"
//    veto, "milkshake" must not lose to anything;
// 2. solid-food vetoes — cheese/bread/biscuit/ghee products whose names merely
//    mention milk/butter;
// 3. generic liquid words, plus the brand-name fallback for products whose name has
//    no generic beverage word at all (Sprite, Thums Up, Bisleri…).
const STRONG_LIQUID = ["buttermilk", "butter milk", "milkshake", "milk shake", "lassi", "chaas",
  "yogurt drink", "yogurt shake", "smoothie", "energy drink", "sports drink", "thirst quencher"];
const NOT_LIQUID_KEYWORDS = ["powder", "bar", "candy", "chocolate", "cookie", "cheese", "paneer",
  "bread", "biscuit", "wafer", "croissant", "ghee", "butter", "ice cream", "curd", "yogurt", "yoghurt"];
const LIQUID_KEYWORDS = ["cola", "soda", "coffee", "tea", "latte", "cappuccino", "espresso",
  "juice", "milk", "shake", "lemonade", "beverage", "drink", "water", "syrup", "beer", "wine"];
const LIQUID_BRAND_KEYWORDS = ["sprite", "thums up", "bisleri", "limca", "mirinda", "frooti", "maaza",
  "appy", "rooh afza", "paper boat", "kinley", "aquafina", "gatorade", "monster", "red bull",
  "sting", "tropicana", "minute maid", "nescafe", "nescafé", "lipton", "tetley", "mountain dew",
  "7up", "7-up", "coca-cola", "coca cola", "pepsi", "fanta", "dr pepper", "schweppes"];
const isLiquidByName = (name, brand) => {
  const lower = name.toLowerCase();
  if (STRONG_LIQUID.some((k) => lower.includes(k))) return true;
  if (NOT_LIQUID_KEYWORDS.some((k) => lower.includes(k))) return false;
  const brandLower = (brand || "").toLowerCase();
  if (LIQUID_BRAND_KEYWORDS.some((k) => lower.includes(k) || brandLower.includes(k))) return true;
  return LIQUID_KEYWORDS.some((k) => lower.includes(k));
};

const db = new pg.Client({ connectionString: process.env.SEED_DB_URL });
await db.connect();

const cols = ["indb_code", "name", "brand", "source", "is_liquid", "kcal", "protein_g", "carbs_g", "fat_g", "fiber_g",
  "sat_fat_g", "sugar_g", "sodium_mg", "calcium_mg", "iron_mg", "potassium_mg"];

async function upsert(batch) {
  const values = [], params = [];
  batch.forEach((p, j) => {
    const base = j * cols.length;
    values.push(`(${cols.map((_, k) => `$${base + k + 1}`).join(",")})`);
    params.push(`OFF-${p.code}`, p.name, p.brand, "off", isLiquidByName(p.name, p.brand), p.kcal, p.protein_g,
      p.carbs_g, p.fat_g, p.fiber_g ?? 0, p.sat_fat_g, p.sugar_g, p.sodium_mg, p.calcium_mg, p.iron_mg, p.potassium_mg);
  });
  await db.query(
    `insert into foods (${cols.join(",")}) values ${values.join(",")}
     on conflict (indb_code) do update set name=excluded.name, brand=excluded.brand,
       is_liquid=excluded.is_liquid, kcal=excluded.kcal, protein_g=excluded.protein_g,
       carbs_g=excluded.carbs_g, fat_g=excluded.fat_g, sugar_g=excluded.sugar_g`,
    params);
}

// India-exclusive brands accepted even without a country tag — see the comment at
// the filter site below for why this list deliberately excludes global brands
// like Nestle/Maggi.
const SAFE_UNTAGGED_BRANDS = ["amul", "haldiram", "britannia", "parle", "patanjali",
  "mtr foods", "dabur", "mother dairy", "bikaji", "everest", "mdh", "catch spices",
  "tata sampann"];

// Stream: gz file -> gunzip -> line splitter -> tab splitter. The dump has one
// header row; rows can be jagged (fewer columns than the header) — index lookups
// past the row's end just come back undefined, which n() treats as null.
const stream = createReadStream(FILE).pipe(createGunzip());
stream.setEncoding("utf8");

let header = null, idx = {}, carry = "";
let scanned = 0, kept = 0, batch = [];
const seen = new Set(); // the dump occasionally repeats a barcode; keep first

for await (const chunk of stream) {
  const lines = (carry + chunk).split("\n");
  carry = lines.pop(); // last element is an incomplete line (or "")
  for (const line of lines) {
    if (!header) {
      header = line.replace(/\r$/, "").split("\t");
      header.forEach((h, i) => { idx[h] = i; });
      for (const req of ["code", "product_name", "brands", "countries_tags",
        "energy-kcal_100g", "proteins_100g", "carbohydrates_100g", "fat_100g"]) {
        if (!(req in idx)) { console.error(`missing expected column "${req}" — dump format changed?`); process.exit(1); }
      }
      continue;
    }
    scanned++;
    if (scanned % 500000 === 0) process.stdout.write(`  scanned ${(scanned / 1e6).toFixed(1)}M rows, kept ${kept}\r`);

    const t = line.split("\t");
    const countries = (t[idx["countries_tags"]] || "").toLowerCase();
    const brandLower = (t[idx["brands"]] || "").toLowerCase();
    const countryTagged = countries.includes("en:india") || countries.includes("en:united-arab-emirates");
    // Country tagging on OFF is sparse for India/UAE (28,975 of 4.5M rows total,
    // confirmed 2026-07-09) — most submissions never get a country tag at all. For
    // brands that are unambiguously India-exclusive (no meaningful presence under
    // this name anywhere else), accept the row even without the tag: 2026-07-09
    // analysis found ~400 real, complete-macro rows this recovers. Deliberately
    // excludes global conglomerate brands (Nestle, Maggi) here — those have
    // genuinely different regional product lines (German/Swiss Maggi, European
    // Nestle) and matching without the country tag would re-import the exact
    // brand-owner over-match problem already fixed once for USDA branded foods
    // (trim-usda-branded.mjs). Global brands still come in fine via the country tag.
    const safeBrandMatch = SAFE_UNTAGGED_BRANDS.some((b) => brandLower.includes(b));
    if (!countryTagged && !safeBrandMatch) continue;

    const code = (t[idx["code"]] || "").trim();
    const name = (t[idx["product_name"]] || "").trim().slice(0, 200);
    const kcal = clamp(n(t[idx["energy-kcal_100g"]]), 900);
    const protein_g = clamp(n(t[idx["proteins_100g"]]), 100);
    const carbs_g = clamp(n(t[idx["carbohydrates_100g"]]), 100);
    const fat_g = clamp(n(t[idx["fat_100g"]]), 100);
    if (!code || name.length < 3 || kcal === null || protein_g === null || carbs_g === null || fat_g === null) continue;
    if (seen.has(code)) continue;
    seen.add(code);

    const sodium_g = n(t[idx["sodium_100g"]]);
    const calcium_g = n(t[idx["calcium_100g"]]);
    const iron_g = n(t[idx["iron_100g"]]);
    const potassium_g = n(t[idx["potassium_100g"]]);
    batch.push({
      code, name,
      brand: (t[idx["brands"]] || "").split(",")[0].trim().slice(0, 80) || null,
      kcal, protein_g, carbs_g, fat_g,
      fiber_g: clamp(n(t[idx["fiber_100g"]]), 100),
      sat_fat_g: clamp(n(t[idx["saturated-fat_100g"]]), 100),
      sugar_g: clamp(n(t[idx["sugars_100g"]]), 100),
      sodium_mg: sodium_g !== null ? clamp(Math.round(sodium_g * 1000 * 1000) / 1000, 20000) : null, // OFF stores g
      calcium_mg: calcium_g !== null ? clamp(Math.round(calcium_g * 1000 * 1000) / 1000, 20000) : null,
      iron_mg: iron_g !== null ? clamp(Math.round(iron_g * 1000 * 1000) / 1000, 1000) : null,
      potassium_mg: potassium_g !== null ? clamp(Math.round(potassium_g * 1000 * 1000) / 1000, 20000) : null,
    });
    kept++;
    if (batch.length >= 200) { await upsert(batch); batch = []; }
  }
}
if (batch.length) await upsert(batch);

console.log(`\nscanned ${scanned} rows, upserted ${kept} India/UAE products with complete macros`);
const { rows: [c] } = await db.query(`select count(*) from foods where source='off'`);
console.log(`TOTAL off foods in db: ${c.count}`);
await db.end();
