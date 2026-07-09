const pg = require('pg');
const client = new pg.Client({ connectionString: process.env.SEED_DB_URL });

const YOGA_POSES = [
  { name: "Downward-Facing Dog", met_value: 3.0, instructions: "Start on all fours. Lift hips up and back, pressing chest toward thighs." },
  { name: "Warrior I", met_value: 3.0, instructions: "Step one foot back, turn it out slightly. Bend front knee, sweep arms up." },
  { name: "Warrior II", met_value: 3.0, instructions: "Step foot back, turn it out. Bend front knee, open arms wide, gaze over front fingers." },
  { name: "Child's Pose", met_value: 2.0, instructions: "Kneel, sit back on heels, stretch arms forward, rest forehead on mat." },
  { name: "Cobra Pose", met_value: 2.5, instructions: "Lie on stomach, hands under shoulders. Press up to lift chest off floor." },
  { name: "Tree Pose", met_value: 2.5, instructions: "Stand on one leg, place other foot on inner thigh or calf. Hands in prayer at chest." },
  { name: "Triangle Pose", met_value: 3.0, instructions: "Step feet wide. Turn one foot out, reach arm forward and down, opposite arm up." },
  { name: "Bridge Pose", met_value: 2.5, instructions: "Lie on back, knees bent, feet flat. Press into feet to lift hips." },
  { name: "Chaturanga", met_value: 4.0, instructions: "From plank, lower down halfway, keeping elbows tucked close to ribs." },
  { name: "Upward-Facing Dog", met_value: 3.0, instructions: "From chaturanga, press up, lifting chest and thighs off floor." },
  { name: "Corpse Pose (Savasana)", met_value: 1.0, instructions: "Lie flat on back, arms and legs relaxed, palms facing up." },
  { name: "Cat-Cow", met_value: 2.5, instructions: "On all fours, inhale to arch back (Cow), exhale to round spine (Cat)." }
];

(async () => {
  try {
    await client.connect();
    
    // Check if we already seeded them
    const { rows } = await client.query(`SELECT count(*) FROM exercises WHERE category = 'yoga'`);
    if (parseInt(rows[0].count) > 0) {
      console.log("Yoga poses already seeded.");
      return;
    }

    console.log("Seeding yoga poses...");
    
    let count = 0;
    for (const p of YOGA_POSES) {
      await client.query(`
        INSERT INTO exercises (name, category, equipment, primary_muscle, met_value, instructions)
        VALUES ($1, 'yoga', 'body weight', 'full body', $2, $3)
      `, [p.name, p.met_value, p.instructions]);
      count++;
    }
    
    console.log(`Seeded ${count} yoga poses.`);
  } catch(e) {
    console.error(e);
  } finally {
    await client.end();
  }
})();
