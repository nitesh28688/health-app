const pg = require('pg');

const client = new pg.Client({ connectionString: process.env.SEED_DB_URL });

(async () => {
  try {
    await client.connect();

    console.log("=== Testing Badges RLS ===");
    const creatorId = "44444444-4444-4444-4444-444444444444";
    const friendId = "55555555-5555-5555-5555-555555555555";
    const strangerId = "66666666-6666-6666-6666-666666666666";

    // Insert dummy profiles directly
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

    // Insert a badge
    await client.query(`set role authenticated; set request.jwt.claim.sub to '${creatorId}';`);
    await client.query(`INSERT INTO user_badges (user_id, badge_code) VALUES ($1, 'streak_7')`, [creatorId]);
    console.log("Badge inserted successfully by owner.");

    // Friend can see badge
    await client.query(`set role authenticated; set request.jwt.claim.sub to '${friendId}';`);
    const cFriend = await client.query(`SELECT * FROM user_badges WHERE user_id = $1`, [creatorId]);
    console.log("Friend sees badge:", cFriend.rows.length === 1);

    // Stranger cannot see badge
    await client.query(`set role authenticated; set request.jwt.claim.sub to '${strangerId}';`);
    const cStranger = await client.query(`SELECT * FROM user_badges WHERE user_id = $1`, [creatorId]);
    console.log("Stranger sees badge:", cStranger.rows.length === 0);

    // Stranger cannot insert for someone else
    try {
      await client.query(`INSERT INTO user_badges (user_id, badge_code) VALUES ($1, 'streak_30')`, [creatorId]);
      console.log("Error: Stranger could insert badge for another user!");
    } catch(e) {
      console.log("Stranger correctly rejected from inserting badge for another user.");
    }

    // Cleanup
    await client.query(`RESET ROLE`);
    await client.query(`DELETE FROM user_badges WHERE user_id = $1`, [creatorId]);
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
