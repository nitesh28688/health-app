// Seed Open Food Facts (ODbL) — most-scanned packaged/branded products for a
// given country. Respects OFF API rate limits (10 search req/min → 6.5s between
// pages). Idempotent: upserts on indb_code = 'OFF-<barcode>'.
// NOTE: page_size=100 reliably 503s on OFF's current (degraded) infra even when
// small requests succeed — confirmed by isolating the parameter. page_size=25
// works. Keep it small; don't "optimize" this back up without re-testing.
// This has also hit multi-day IP/request-count throttles in the past — run small
// batches patiently rather than large ones, even when the API seems to be up.
// Run: SEED_DB_URL='postgresql://...' node scripts/seed-off.mjs [pages=40] [startPage=1] [pageSize=10] [country=india|uae]
import pg from "pg";

const PAGES = +(process.argv[2] ?? 40);
const START_PAGE = +(process.argv[3] ?? 1);
const PAGE_SIZE = +(process.argv[4] ?? 10);
const COUNTRY = process.argv[5] === "uae" ? "united-arab-emirates" : "india";
const UA = "HealthApp-Family/1.0 (personal macro tracker; contact shool007@gmail.com)";

const n = (v) => (v === undefined || v === null || v === "" || Number.isNaN(+v) ? null : Math.round(+v * 1000) / 1000);
// OFF is crowdsourced — some entries have garbage unit-conversion values (e.g. sodium
// off by 1000x). Clamp to sane per-100g bounds; anything beyond is nulled, not stored.
const clamp = (v, max) => (v !== null && Math.abs(v) <= max ? v : null);

// Same name-keyword heuristic used for indb/usda (category fields are unreliable
// across every source we've tried) — see migration 0017 and seed-usda-branded.mjs.
const LIQUID_KEYWORDS = ["cola", "soda", "coffee", "tea", "latte", "cappuccino", "espresso",
  "juice", "milk", "smoothie", "shake", "energy drink", "sports drink", "thirst quencher", "lemonade",
  "beverage", "drink", "water", "syrup", "beer", "wine", "lassi", "buttermilk", "chaas"];
const NOT_LIQUID_KEYWORDS = ["powder", "bar", "candy", "chocolate", "cookie"];
// Brand-name fallback: a lot of real products (Sprite, Thums Up, Bisleri) are just
// the brand name with no generic beverage word in sight — "Sprite" contains none of
// the keywords above. Confirmed 2026-07-08: Sprite/Thums Up/Bisleri all came through
// is_liquid=false on a fresh OFF seed until this list was added.
const LIQUID_BRAND_KEYWORDS = ["sprite", "thums up", "bisleri", "limca", "mirinda", "frooti", "maaza",
  "appy", "slice", "rooh afza", "paper boat", "kinley", "aquafina", "gatorade", "monster", "red bull",
  "sting", "tropicana", "minute maid", "nescafe", "nescafé", "lipton", "tetley", "mountain dew",
  "7up", "7-up", "coca-cola", "coca cola", "pepsi", "fanta", "dr pepper", "schweppes"];
const isLiquidByName = (name, brand) => {
  const lower = name.toLowerCase();
  const brandLower = (brand || "").toLowerCase();
  if (LIQUID_BRAND_KEYWORDS.some((k) => lower.includes(k) || brandLower.includes(k))) return true;
  return LIQUID_KEYWORDS.some((k) => lower.includes(k)) && !NOT_LIQUID_KEYWORDS.some((k) => lower.includes(k));
};

const db = new pg.Client({ connectionString: process.env.SEED_DB_URL });
await db.connect();

const cols = ["indb_code", "name", "brand", "source", "is_liquid", "kcal", "protein_g", "carbs_g", "fat_g", "fiber_g",
  "sat_fat_g", "sugar_g", "sodium_mg", "calcium_mg", "iron_mg", "potassium_mg"];

let total = 0;
let consecutiveFailures = 0;
for (let page = START_PAGE; page <= PAGES; page++) {
  // world.* proved far more stable than in.* during this session's OFF outages.
  const url = `https://world.openfoodfacts.org/api/v2/search?fields=code,product_name,brands,nutriments,quantity` +
    `&countries_tags_en=${COUNTRY}&page_size=${PAGE_SIZE}&page=${page}&sort_by=unique_scans_n`;

  let res, body;
  for (let attempt = 1; attempt <= 3; attempt++) {
    res = await fetch(url, { headers: { "User-Agent": UA } });
    if (res.ok) { body = await res.json(); break; }
    if (attempt < 3) await new Promise((r) => setTimeout(r, 3000 * attempt));
  }
  if (!body) {
    console.error(`page ${page}: HTTP ${res.status} after retries, skipping this page`);
    if (++consecutiveFailures >= 5) { console.error("5 pages failed in a row, stopping run"); break; }
    continue;
  }
  consecutiveFailures = 0;
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
      params.push(`OFF-${p.code}`, p.name, p.brand, "off", isLiquidByName(p.name, p.brand), p.kcal, p.protein_g, p.carbs_g,
        p.fat_g, p.fiber_g ?? 0, p.sat_fat_g, p.sugar_g, p.sodium_mg, p.calcium_mg, p.iron_mg, p.potassium_mg);
    });
    await db.query(
      `insert into foods (${cols.join(",")}) values ${values.join(",")}
       on conflict (indb_code) do update set name=excluded.name, brand=excluded.brand,
         is_liquid=excluded.is_liquid, kcal=excluded.kcal, protein_g=excluded.protein_g,
         carbs_g=excluded.carbs_g, fat_g=excluded.fat_g, sugar_g=excluded.sugar_g`,
      params);
    total += products.length;
  }
  console.log(`page ${page}: +${products.length} (total ${total})`);
  if (page < PAGES) await new Promise((r) => setTimeout(r, 10000));
}

const { rows: [c] } = await db.query(`select count(*) from foods where source='off'`);
console.log(`TOTAL off foods in db: ${c.count}`);
await db.end();
