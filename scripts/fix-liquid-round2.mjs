// Round 2 correction: is_liquid keyword matching (seed-off.mjs, seed-usda-branded.mjs)
// only checked the product name for generic beverage words ("cola", "juice", etc.).
// Real products are often just a brand name with no generic word at all — "Sprite",
// "Thums Up", "Bisleri", Gatorade's "ICY CHARGE"/"GLACIER CHERRY" flavors — and came
// through is_liquid=false. Confirmed 2026-07-08 spot-checking fresh OFF India rows.
// This applies the same brand-keyword list added to both seed scripts directly against
// already-inserted rows, so a full re-seed (blocked by OFF's throttle, and USDA's source
// CSVs were deleted after the original seed) isn't needed to correct existing data.
import pg from "pg";
const db = new pg.Client({ connectionString: process.env.SEED_DB_URL });
await db.connect();

const BRAND_OR_NAME_KEYWORDS = [
  "sprite", "thums up", "bisleri", "limca", "mirinda", "frooti", "maaza", "appy", "slice",
  "rooh afza", "paper boat", "kinley", "aquafina", "gatorade", "monster", "red bull", "sting",
  "tropicana", "minute maid", "nescafe", "nescafé", "starbucks", "lipton", "twinings", "tetley",
  "mountain dew", "7up", "7-up", "coca-cola", "coca cola", "pepsi", "fanta", "dr pepper",
  "schweppes", "thirst quencher",
];

const keepClause = BRAND_OR_NAME_KEYWORDS
  .map((_, i) => `(name ilike '%'||$${i + 1}||'%' or brand ilike '%'||$${i + 1}||'%')`)
  .join(" or ");

const { rowCount } = await db.query(
  `update foods set is_liquid = true
   where (indb_code like 'OFF-%' or indb_code like 'USDABR-%')
     and is_liquid = false
     and (${keepClause})`,
  BRAND_OR_NAME_KEYWORDS);
console.log(`corrected is_liquid on ${rowCount} rows`);

const { rows: [c] } = await db.query(
  `select count(*) from foods where (indb_code like 'OFF-%' or indb_code like 'USDABR-%') and is_liquid`);
console.log(`total OFF+USDA branded rows now flagged liquid: ${c.count}`);
await db.end();
