import pg from "pg";
const db = new pg.Client({ connectionString: process.env.SEED_DB_URL });
await db.connect();
for (const q of ["coca-cola", "coffee", "protein shake", "red bull", "cadbury"]) {
  const { rows } = await db.query(
    `select name, brand, kcal, is_liquid from foods where indb_code like 'USDABR-%'
     and (name ilike '%'||$1||'%' or brand ilike '%'||$1||'%') limit 3`, [q]);
  console.log(q, "=>", rows.map(r => `${r.brand || ""} ${r.name} (${r.kcal}kcal, liquid=${r.is_liquid})`));
}
await db.end();
