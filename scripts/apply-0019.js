const fs = require('fs');
const pg = require('pg');

const sql = fs.readFileSync('supabase/migrations/0019_search_milk_default.sql', 'utf8');
const client = new pg.Client({ connectionString: process.env.SEED_DB_URL });
(async () => {
  try {
    await client.connect();
    await client.query(sql);
    console.log("Migration applied.");
    const res = await client.query("select name from search_foods('milk') limit 6");
    console.log("Verify result:");
    res.rows.forEach(r => console.log(r.name));
  } catch(e) {
    console.error(e);
  } finally {
    await client.end();
  }
})();
