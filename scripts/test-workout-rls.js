const fs = require('fs');
const pg = require('pg');

const client = new pg.Client({ connectionString: process.env.SEED_DB_URL });

(async () => {
  try {
    await client.connect();

    console.log("=== Testing Cascade Delete ===");
    const userId = "33333333-3333-3333-3333-333333333333";
    await client.query(`INSERT INTO auth.users (id, email) VALUES ($1, 'testw1@example.com') ON CONFLICT DO NOTHING`, [userId]);
    await client.query(`
      INSERT INTO auth.identities (id, user_id, provider_id, identity_data, provider) 
      VALUES ($1, $1, $1::text, '{"sub":"${userId}"}', 'email') ON CONFLICT DO NOTHING
    `, [userId]);

    // Insert dummy workout log
    const logRes = await client.query(`
      INSERT INTO workout_logs (user_id, log_date, title, duration_min) 
      VALUES ($1, '2026-07-09', 'Test Log', 30) RETURNING id
    `, [userId]);
    const logId = logRes.rows[0].id;

    // Get a random exercise
    const exRes = await client.query(`SELECT id FROM exercises LIMIT 1`);
    const exId = exRes.rows[0].id;

    // Insert workout_log_exercises
    const wleRes = await client.query(`
      INSERT INTO workout_log_exercises (workout_log_id, exercise_id) 
      VALUES ($1, $2) RETURNING id
    `, [logId, exId]);
    const wleId = wleRes.rows[0].id;

    // Insert workout_log_sets
    await client.query(`
      INSERT INTO workout_log_sets (workout_log_exercise_id, set_number, reps, weight_kg) 
      VALUES ($1, 1, 10, 50.0)
    `, [wleId]);

    // Verify they exist
    let countRes = await client.query(`SELECT count(*) FROM workout_log_sets WHERE workout_log_exercise_id = $1`, [wleId]);
    console.log("Sets before delete:", countRes.rows[0].count);

    // Delete workout_log
    await client.query(`DELETE FROM workout_logs WHERE id = $1`, [logId]);

    // Verify sets cascade deleted
    countRes = await client.query(`SELECT count(*) FROM workout_log_sets WHERE workout_log_exercise_id = $1`, [wleId]);
    console.log("Sets after delete:", countRes.rows[0].count);
    let wleCount = await client.query(`SELECT count(*) FROM workout_log_exercises WHERE id = $1`, [wleId]);
    console.log("Exercises after delete:", wleCount.rows[0].count);

    console.log("\n=== Testing RLS ===");
    // Setup another user and their log
    const user1Id = "11111111-1111-1111-1111-111111111111";
    const user2Id = "22222222-2222-2222-2222-222222222222";
    await client.query(`
      INSERT INTO auth.users (id, email) VALUES ($1, 'testw2@example.com'), ($2, 'testw3@example.com') ON CONFLICT DO NOTHING
    `, [user1Id, user2Id]);
    await client.query(`
      INSERT INTO auth.identities (id, user_id, provider_id, identity_data, provider) 
      VALUES ($1, $1, $1::text, '{"sub":"${user1Id}"}', 'email'), ($2, $2, $2::text, '{"sub":"${user2Id}"}', 'email') ON CONFLICT DO NOTHING
    `, [user1Id, user2Id]);

    const log1Res = await client.query(`
      INSERT INTO workout_logs (user_id, log_date, title, duration_min) 
      VALUES ($1, '2026-07-09', 'User 1 Log', 30) RETURNING id
    `, [user1Id]);
    const log1Id = log1Res.rows[0].id;

    const wle1Res = await client.query(`
      INSERT INTO workout_log_exercises (workout_log_id, exercise_id) 
      VALUES ($1, $2) RETURNING id
    `, [log1Id, exId]);
    
    // Now switch role to authenticated user 1 and select
    await client.query(`
      set role authenticated; 
      set request.jwt.claim.sub to '${user1Id}';
    `);
    let myRes = await client.query(`SELECT count(*) FROM workout_log_exercises`);
    console.log("User 1 sees WLE count:", myRes.rows[0].count);

    // Switch to user 2
    await client.query(`
      set role authenticated; 
      set request.jwt.claim.sub to '${user2Id}';
    `);
    let theirRes = await client.query(`SELECT count(*) FROM workout_log_exercises`);
    console.log("User 2 sees WLE count:", theirRes.rows[0].count);

    // Cleanup
    await client.query(`RESET ROLE`);
    await client.query(`DELETE FROM profiles WHERE id IN ($1, $2, $3)`, [userId, user1Id, user2Id]);
    console.log("Cleanup done.");
    
  } catch(e) {
    console.error(e);
  } finally {
    await client.end();
  }
})();
