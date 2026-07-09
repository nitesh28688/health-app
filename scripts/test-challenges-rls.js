const fs = require('fs');
const pg = require('pg');

const client = new pg.Client({ connectionString: process.env.SEED_DB_URL });

(async () => {
  try {
    await client.connect();

    console.log("=== Testing Challenges RLS and Progress ===");
    const creatorId = "44444444-4444-4444-4444-444444444444";
    const friendId = "55555555-5555-5555-5555-555555555555";
    const strangerId = "66666666-6666-6666-6666-666666666666";

    // Insert dummy profiles directly (auth.users + auth.identities)
    await client.query(`
      INSERT INTO auth.users (id, email) VALUES 
      ($1, 'creator@example.com'), 
      ($2, 'friend@example.com'), 
      ($3, 'stranger@example.com') ON CONFLICT DO NOTHING;
    `, [creatorId, friendId, strangerId]);
    await client.query(`
      INSERT INTO auth.identities (id, user_id, provider_id, identity_data, provider) VALUES 
      ($1, $1, '${creatorId}', '{"sub":"${creatorId}"}', 'email') ON CONFLICT DO NOTHING
    `, [creatorId]);
    await client.query(`
      INSERT INTO auth.identities (id, user_id, provider_id, identity_data, provider) VALUES 
      ($1, $1, '${friendId}', '{"sub":"${friendId}"}', 'email') ON CONFLICT DO NOTHING
    `, [friendId]);
    await client.query(`
      INSERT INTO auth.identities (id, user_id, provider_id, identity_data, provider) VALUES 
      ($1, $1, '${strangerId}', '{"sub":"${strangerId}"}', 'email') ON CONFLICT DO NOTHING
    `, [strangerId]);

    // Make friend a friend
    await client.query(`
      INSERT INTO friendships (requester_id, addressee_id, status) VALUES ($1, $2, 'accepted') ON CONFLICT DO NOTHING;
    `, [creatorId, friendId]);

    // Create a challenge
    const res = await client.query(`
      INSERT INTO challenges (creator_id, name, kind, start_date, end_date) 
      VALUES ($1, 'Test Challenge', 'workout_days', '2026-07-01', '2026-07-31') RETURNING id
    `, [creatorId]);
    const challengeId = res.rows[0].id;

    // Join the challenge (creator)
    await client.query(`
      INSERT INTO challenge_participants (challenge_id, user_id) VALUES ($1, $2)
    `, [challengeId, creatorId]);

    // Add some logs for the creator
    await client.query(`
      INSERT INTO workout_logs (user_id, log_date, title, duration_min) 
      VALUES ($1, '2026-07-05', 'Workout 1', 30), ($1, '2026-07-06', 'Workout 2', 45)
    `, [creatorId]);

    // Verify progress RPC
    await client.query(`set role authenticated; set request.jwt.claim.sub to '${creatorId}';`);
    const progRes = await client.query(`SELECT * FROM get_challenge_progress($1)`, [challengeId]);
    console.log("Creator Scoreboard:", progRes.rows);

    // Verify friend can see the challenge (but isn't a member yet)
    await client.query(`set role authenticated; set request.jwt.claim.sub to '${friendId}';`);
    const cFriend = await client.query(`SELECT * FROM challenges WHERE id = $1`, [challengeId]);
    console.log("Friend sees challenge:", cFriend.rows.length === 1);

    // Friend cannot see scoreboard before joining
    try {
      await client.query(`SELECT * FROM get_challenge_progress($1)`, [challengeId]);
      console.log("Error: Friend could see scoreboard before joining");
    } catch(e) {
      console.log("Friend correctly rejected from scoreboard");
    }

    // Friend joins
    await client.query(`
      INSERT INTO challenge_participants (challenge_id, user_id) VALUES ($1, $2)
    `, [challengeId, friendId]);

    // Verify stranger cannot see it
    await client.query(`set role authenticated; set request.jwt.claim.sub to '${strangerId}';`);
    const cStranger = await client.query(`SELECT * FROM challenges WHERE id = $1`, [challengeId]);
    console.log("Stranger sees challenge:", cStranger.rows.length === 1);

    // Cleanup
    await client.query(`RESET ROLE`);
    await client.query(`DELETE FROM challenges WHERE id = $1`, [challengeId]);
    await client.query(`DELETE FROM friendships WHERE requester_id = $1 AND addressee_id = $2`, [creatorId, friendId]);
    await client.query(`DELETE FROM auth.identities WHERE user_id IN ($1, $2, $3)`, [creatorId, friendId, strangerId]);
    await client.query(`DELETE FROM auth.users WHERE id IN ($1, $2, $3)`, [creatorId, friendId, strangerId]);
    console.log("Cleanup done.");
    
  } catch(e) {
    console.error(e);
  } finally {
    await client.end();
  }
})();
