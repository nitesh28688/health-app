import pg from "pg";
const db = new pg.Client({ connectionString: process.env.SEED_DB_URL });
await db.connect();

console.log("=== Overall food counts by source ===");
const { rows: bySource } = await db.query(`select source, count(*) from foods group by source order by 2 desc`);
console.table(bySource);

console.log("\n=== Brands with the most SKUs (likely clutter) ===");
const { rows: topBrands } = await db.query(`
  select brand, count(*) as n from foods where indb_code like 'USDABR-%' and brand is not null
  group by brand order by n desc limit 15`);
console.table(topBrands);

console.log("\n=== Sample: all Coca-Cola / Diet Coke entries ===");
const { rows: coke } = await db.query(`
  select name, brand, kcal from foods where indb_code like 'USDABR-%'
  and (name ilike '%coca-cola%' or name ilike '%diet coke%') limit 30`);
console.table(coke);

console.log("\n=== Near-duplicate check: same brand + first 15 chars of name + same kcal ===");
const { rows: dupes } = await db.query(`
  select brand, left(name, 20) as name_prefix, kcal, count(*) as n
  from foods where indb_code like 'USDABR-%'
  group by brand, left(name, 20), kcal
  having count(*) > 1
  order by n desc limit 20`);
console.table(dupes);

await db.end();
