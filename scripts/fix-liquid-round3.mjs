// Round 3 is_liquid correction, after the first bulk OFF seed (seed-off-bulk.mjs)
// surfaced two new false-positive classes:
// - "milk" substring flagging solid dairy ("Amul Pure Milk Cheese Slices", "Milk Bread")
// - the drink brand "Slice" in the brand fallback matching "Cheese Slices"
// Recomputes is_liquid for every OFF row with the reordered three-tier heuristic now
// in seed-off-bulk.mjs (strong liquid phrases > solid-food vetoes > generic keywords)
// and updates only rows whose value changes. Idempotent, safe to re-run.
import pg from "pg";

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

const { rows } = await db.query(`select id, name, brand, is_liquid from foods where source='off'`);
let toTrue = 0, toFalse = 0;
for (const r of rows) {
  const want = isLiquidByName(r.name, r.brand);
  if (want === r.is_liquid) continue;
  await db.query(`update foods set is_liquid=$1 where id=$2`, [want, r.id]);
  want ? toTrue++ : toFalse++;
}
console.log(`checked ${rows.length} OFF rows: ${toFalse} corrected to solid, ${toTrue} corrected to liquid`);
const { rows: [c] } = await db.query(`select count(*) from foods where source='off' and is_liquid`);
console.log(`OFF rows now flagged liquid: ${c.count}`);
await db.end();
