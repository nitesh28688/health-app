// Seed exercises (free-exercise-db, MIT-licensed) + 4 starter workout plans.
// Idempotent: skips exercises/plans if already present.
// Run: SEED_DB_URL='postgresql://...' node scripts/seed-workouts.mjs
import { readFileSync } from 'fs';
import pg from 'pg';

const db = new pg.Client({ connectionString: process.env.SEED_DB_URL });
await db.connect();

const raw = JSON.parse(readFileSync(new URL('../data/exercises.json', import.meta.url)));

const catMap = (e) => {
  if (e.category === 'stretching') return 'flexibility';
  if (e.category === 'cardio' || e.category === 'plyometrics') return 'cardio';
  if ((e.primaryMuscles || []).some((m) => ['abdominals', 'lower back'].includes(m))) return 'core';
  return 'strength';
};
const equipMap = (e) => ({
  'body only': 'bodyweight', '': 'none', 'kettlebells': 'dumbbell', 'dumbbell': 'dumbbell',
  'barbell': 'barbell', 'e-z curl bar': 'barbell', 'cable': 'machine', 'machine': 'machine',
  'bands': 'band',
}[e.equipment ?? ''] ?? 'other');
const metMap = { strength: 5.0, cardio: 8.0, flexibility: 2.5, core: 4.0 };

const { rows: [{ count: exCount }] } = await db.query('select count(*) from exercises');
if (+exCount > 0) {
  console.log(`exercises already seeded (${exCount}), skipping`);
} else {
  const ex = raw.map((e) => [
    e.name.slice(0, 120), catMap(e), equipMap(e),
    (e.primaryMuscles || [])[0] ?? null,
    metMap[catMap(e)],
    (e.instructions || []).join(' ').slice(0, 1500) || null,
  ]);
  for (let i = 0; i < ex.length; i += 200) {
    const chunk = ex.slice(i, i + 200);
    const values = chunk.map((_, j) => `(${[1,2,3,4,5,6].map((k) => `$${j * 6 + k}`).join(',')})`).join(',');
    await db.query(
      `insert into exercises (name, category, equipment, primary_muscle, met_value, instructions) values ${values}`,
      chunk.flat());
  }
  console.log(`exercises inserted: ${ex.length}`);
}

// ---- starter plans (owner_id NULL = public) ----
const { rows: [{ count: planCount }] } = await db.query('select count(*) from workout_plans where owner_id is null');
if (+planCount > 0) {
  console.log(`plans already seeded (${planCount}), done`);
  await db.end();
  process.exit(0);
}

async function findEx(...patterns) {
  for (const p of patterns) {
    const { rows } = await db.query(
      `select id from exercises where name ilike $1 order by length(name) limit 1`, [p]);
    if (rows[0]) return rows[0].id;
  }
  return null;
}

const plans = [
  {
    name: 'Beginner Home (No Equipment)', goal: 'general_fitness', level: 'beginner', dpw: 3,
    description: 'Full-body bodyweight, 3 days a week. Perfect starting point.',
    days: [
      { n: 1, title: 'Full Body A', items: [
        ['Push%up%|Pushups', 3, '8-12'], ['%bodyweight squat%|%air squat%|Bodyweight%Squat%', 3, '12-15'],
        ['Plank', 3, '30s'], ['%glute bridge%', 3, '12'], ['Jumping jack%|%jumping jack%', 2, '45s'] ] },
      { n: 2, title: 'Full Body B', items: [
        ['%lunge%', 3, '10/leg'], ['%incline push%|Push%up%', 3, '8-12'],
        ['%crunch%', 3, '15'], ['%superman%', 3, '12'], ['%mountain climber%', 2, '30s'] ] },
      { n: 3, title: 'Full Body C + Walk', items: [
        ['%squat%', 3, '12-15'], ['%dip%bench%|%bench dip%', 3, '8-12'],
        ['%side plank%', 3, '20s/side'], ['%bird dog%|%bird-dog%', 3, '10/side'], ['Walking%|%brisk walk%|%treadmill%', 1, '20min'] ] },
    ],
  },
  {
    name: 'Push Pull Legs (Dumbbell)', goal: 'muscle_gain', level: 'intermediate', dpw: 6,
    description: 'Classic PPL split with dumbbells, run twice per week.',
    days: [
      { n: 1, title: 'Push', items: [
        ['Dumbbell Bench Press', 4, '8-12'], ['%dumbbell shoulder press%|%dumbbell press%', 3, '8-12'],
        ['%lateral raise%', 3, '12-15'], ['%triceps extension%|%tricep%', 3, '10-12'] ] },
      { n: 2, title: 'Pull', items: [
        ['%dumbbell row%|One-Arm Dumbbell Row', 4, '8-12'], ['Pullups|%pull-up%|%pullup%', 3, 'AMRAP'],
        ['%dumbbell curl%|%bicep curl%', 3, '10-12'], ['%rear delt%|%reverse fly%', 3, '12-15'] ] },
      { n: 3, title: 'Legs', items: [
        ['%goblet squat%|%dumbbell squat%', 4, '10-12'], ['%romanian deadlift%|%stiff-leg%', 3, '10-12'],
        ['%lunge%dumbbell%|%dumbbell lunge%|%walking lunge%', 3, '10/leg'], ['%calf raise%', 4, '15-20'] ] },
      { n: 4, title: 'Push (heavy)', items: [
        ['Dumbbell Bench Press', 5, '5-8'], ['%incline dumbbell%press%', 3, '8-10'],
        ['%front raise%', 3, '12'], ['%skullcrusher%|%lying triceps%', 3, '8-10'] ] },
      { n: 5, title: 'Pull (heavy)', items: [
        ['%dumbbell row%', 5, '5-8'], ['%shrug%', 3, '12-15'],
        ['%hammer curl%', 3, '10-12'], ['%face pull%|%rear delt%', 3, '15'] ] },
      { n: 6, title: 'Legs + Core', items: [
        ['%goblet squat%|%dumbbell squat%', 4, '8-10'], ['%glute bridge%|%hip thrust%', 3, '12'],
        ['Plank', 3, '45s'], ['%russian twist%', 3, '20'] ] },
    ],
  },
  {
    name: 'Fat-Loss Cardio + Core', goal: 'fat_loss', level: 'beginner', dpw: 4,
    description: 'Low-equipment cardio intervals plus core strength, 4 days a week.',
    days: [
      { n: 1, title: 'Intervals', items: [
        ['Jumping jack%', 4, '45s'], ['%high knee%', 4, '30s'], ['%burpee%', 3, '10'], ['%mountain climber%', 3, '30s'] ] },
      { n: 2, title: 'Core Circuit', items: [
        ['Plank', 3, '45s'], ['%crunch%', 3, '20'], ['%leg raise%', 3, '12'], ['%russian twist%', 3, '20'], ['%side plank%', 3, '30s/side'] ] },
      { n: 3, title: 'Steady Cardio', items: [
        ['Walking%|%treadmill%|%jog%', 1, '40min'] ] },
      { n: 4, title: 'Full Body Burn', items: [
        ['%squat%', 3, '15'], ['Push%up%', 3, '10'], ['%burpee%', 3, '8'], ['%jump rope%|%rope jumping%', 3, '60s'] ] },
    ],
  },
  {
    name: 'Mobility & Stretch', goal: 'mobility', level: 'beginner', dpw: 3,
    description: 'Gentle 20-minute flexibility sessions. Great rest-day activity for everyone.',
    days: [
      { n: 1, title: 'Lower Body', items: [
        ['%hamstring stretch%', 2, '30s/side'], ['%quad%stretch%|%quadriceps%stretch%', 2, '30s/side'],
        ['%calf stretch%', 2, '30s/side'], ['%hip%stretch%|%pigeon%', 2, '30s/side'] ] },
      { n: 2, title: 'Upper Body', items: [
        ['%shoulder stretch%', 2, '30s/side'], ['%chest%stretch%', 2, '30s'],
        ['%triceps stretch%', 2, '30s/side'], ['%neck%stretch%|%neck%', 2, '20s/side'] ] },
      { n: 3, title: 'Spine & Full Body', items: [
        ['%cat%stretch%|%cat cow%', 2, '10'], ['%child%pose%|%childs pose%', 2, '45s'],
        ['%cobra%|%upward%dog%', 2, '30s'], ['%spinal twist%|%torso twist%', 2, '30s/side'] ] },
    ],
  },
];

for (const p of plans) {
  const { rows: [plan] } = await db.query(
    `insert into workout_plans (name, goal, level, days_per_week, description)
     values ($1,$2,$3,$4,$5) returning id`, [p.name, p.goal, p.level, p.dpw, p.description]);
  for (const d of p.days) {
    const { rows: [day] } = await db.query(
      `insert into workout_plan_days (plan_id, day_number, title) values ($1,$2,$3) returning id`,
      [plan.id, d.n, d.title]);
    let sort = 0, placed = 0;
    for (const [patterns, sets, reps] of d.items) {
      const exId = await findEx(...patterns.split('|'));
      if (!exId) { console.log(`  (no match: ${patterns})`); continue; }
      const isDuration = /min$/.test(reps);
      await db.query(
        `insert into workout_plan_items (plan_day_id, exercise_id, sets, reps, duration_min, sort_order)
         values ($1,$2,$3,$4,$5,$6)`,
        [day.id, exId, isDuration ? null : sets, isDuration ? null : reps,
         isDuration ? parseInt(reps) : null, sort++]);
      placed++;
    }
    console.log(`${p.name} / ${d.title}: ${placed} items`);
  }
}

const { rows: [s] } = await db.query(
  `select (select count(*) from exercises) ex,
          (select count(*) from workout_plans where owner_id is null) plans,
          (select count(*) from workout_plan_items) items`);
console.log(`TOTAL: ${s.ex} exercises, ${s.plans} plans, ${s.items} plan items`);
await db.end();
