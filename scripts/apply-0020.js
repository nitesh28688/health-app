const fs = require('fs');
const pg = require('pg');

const sql = fs.readFileSync('supabase/migrations/0020_workout_sets.sql', 'utf8');
const client = new pg.Client({ connectionString: process.env.SEED_DB_URL });

(async () => {
  try {
    await client.connect();
    await client.query(sql);
    console.log("Migration applied.");
    
    // Check if tables exist and RLS is enabled
    const res = await client.query(`
      SELECT relname, relrowsecurity
      FROM pg_class
      WHERE relname IN ('exercises', 'workout_log_exercises', 'workout_log_sets');
    `);
    console.log("Tables:");
    console.table(res.rows);
  } catch(e) {
    console.error(e);
  } finally {
    await client.end();
  }
})();
