// Seed Open Food Facts India (ODbL) — most-scanned packaged/branded products.
// Respects OFF API rate limits (10 search req/min → 6.5s between pages).
// Idempotent: upserts on indb_code = 'OFF-<barcode>'.
// Run: SEED_DB_URL='postgresql://...' node scripts/seed-off.mjs [pages=15]
import pg from "pg";

const PAGES = +(process.argv[2] ?? 15);
const UA = "HealthApp-Family/1.0 (personal macro tracker; contact shool007@gmail.com)";

const n = (v) => (v === undefined || v === null || v === "" || Number.isNaN(+v) ? null : Math.round(+v * 1000) / 1000);
// OFF is crowdsourced — some entries have garbage unit-conversion values (e.g. sodium
// off by 1000x). Clamp to sane per-100g bounds; anything beyond is nulled, not stored.
const clamp = (v, max) => (v !== null && Math.abs(v) <= max ? v : null);

const db = new pg.Client({ connectionString: process.env.SEED_DB_URL });
await db.connect();

const cols = ["indb_code", "name", "brand", "source", "kcal", "protein_g", "carbs_g", "fat_g", "fiber_g",
  "sat_fat_g", "sugar_g", "sodium_mg", "calcium_mg", "iron_mg", "potassium_mg"];

let total = 0;
for (let page = 1; page <= PAGES; page++) {
  // world.* proved far more stable than in.* during this session's OFF outages.
  const url = `https://world.openfoodfacts.org/api/v2/search?fields=code,product_name,brands,nutriments,quantity` +
    `&countries_tags_en=india&page_size=100&page=${page}&sort_by=unique_scans_n`;
  const res = await fetch(url, { headers: { "User-Agent": UA } });
  if (!res.ok) { console.error(`page ${page}: HTTP ${res.status}, stopping`); break; }
  const body = await res.json();
  const products = (body.products ?? [])
    .map((p) => {
      const m = p.nutriments ?? {};
      return {
        code: String(p.code ?? "").trim(),
        name: String(p.product_name ?? "").trim().slice(0, 200),
        brand: String(p.brands ?? "").split(",")[0].trim().slice(0, 80) || null,
        kcal: clamp(n(m["energy-kcal_100g"]), 900),
        protein_g: clamp(n(m.proteins_100g), 100), carbs_g: clamp(n(m.carbohydrates_100g), 100),
        fat_g: clamp(n(m.fat_100g), 100), fiber_g: clamp(n(m.fiber_100g), 100),
        sat_fat_g: clamp(n(m["saturated-fat_100g"]), 100), sugar_g: clamp(n(m.sugars_100g), 100),
        sodium_mg: m.sodium_100g != null ? clamp(n(m.sodium_100g * 1000), 20000) : null, // OFF sodium is g
        calcium_mg: m.calcium_100g != null ? clamp(n(m.calcium_100g * 1000), 20000) : null,
        iron_mg: m.iron_100g != null ? clamp(n(m.iron_100g * 1000), 1000) : null,
        potassium_mg: m.potassium_100g != null ? clamp(n(m.potassium_100g * 1000), 20000) : null,
      };
    })
    .filter((p) => p.code && p.name.length >= 3 && p.kcal != null && p.kcal <= 900
      && p.protein_g != null && p.carbs_g != null && p.fat_g != null);

  if (products.length) {
    const values = [], params = [];
    products.forEach((p, j) => {
      const base = j * cols.length;
      values.push(`(${cols.map((_, k) => `$${base + k + 1}`).join(",")})`);
      params.push(`OFF-${p.code}`, p.name, p.brand, "off", p.kcal, p.protein_g, p.carbs_g,
        p.fat_g, p.fiber_g ?? 0, p.sat_fat_g, p.sugar_g, p.sodium_mg, p.calcium_mg, p.iron_mg, p.potassium_mg);
    });
    await db.query(
      `insert into foods (${cols.join(",")}) values ${values.join(",")}
       on conflict (indb_code) do update set name=excluded.name, brand=excluded.brand,
         kcal=excluded.kcal, protein_g=excluded.protein_g, carbs_g=excluded.carbs_g,
         fat_g=excluded.fat_g, sugar_g=excluded.sugar_g`,
      params);
    total += products.length;
  }
  console.log(`page ${page}: +${products.length} (total ${total})`);
  if (page < PAGES) await new Promise((r) => setTimeout(r, 6500));
}

const { rows: [c] } = await db.query(`select count(*) from foods where source='off'`);
console.log(`TOTAL off foods in db: ${c.count}`);
await db.end();
