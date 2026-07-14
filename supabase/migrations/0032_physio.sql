-- 0032_physio.sql — Physio/Rehab Mode: curated exercise library + adaptive programs
-- Planned 2026-07-11 (see memory), built 2026-07-14. Lives on the Workout tab as a
-- sibling mode, not under Wellness. Deliberately a SEPARATE table from `exercises`
-- rather than reusing it — physio picks need body_area + contraindication_notes,
-- which don't belong on the general strength/cardio/yoga library.

-- ============ physio_exercises (public curated library, seeded) ============
create table physio_exercises (
  id            bigint generated always as identity primary key,
  name          text not null,
  body_area     text not null check (body_area in ('knee','shoulder','back','neck','hip','ankle','wrist')),
  instructions  text not null,
  default_sets  smallint,
  default_reps  text,             -- '10-15', 'each side' — same free-text convention as workout_plan_items.reps
  hold_sec      smallint,         -- set instead of sets/reps for timed holds (matches SetTimer's targetSeconds)
  equipment     text not null default 'bodyweight',
  contraindication_notes text      -- shown alongside the exercise, e.g. "skip if sharp pain during the move"
);
create index idx_physio_exercises_area on physio_exercises (body_area);

-- ============ physio_programs (one per body-area complaint, user-owned) ============
create table physio_programs (
  id             bigint generated always as identity primary key,
  user_id        uuid not null references profiles(id) on delete cascade,
  body_area      text not null check (body_area in ('knee','shoulder','back','neck','hip','ankle','wrist')),
  complaint      text not null,
  status         text not null default 'active' check (status in ('active','resolved')),
  created_at     timestamptz not null default now(),
  last_session_at timestamptz
);
create index idx_physio_programs_user on physio_programs (user_id, status);

-- ============ physio_program_sessions (one AI-generated routine per session) ============
create table physio_program_sessions (
  id            bigint generated always as identity primary key,
  program_id    bigint not null references physio_programs(id) on delete cascade,
  session_number smallint not null,
  -- [{ name, sets?, reps?, hold_sec?, instructions, source: 'library'|'ai', library_id? }]
  exercises     jsonb not null,
  pain_before   smallint check (pain_before between 0 and 10),
  pain_after    smallint check (pain_after between 0 and 10),
  difficulty    text check (difficulty in ('too_easy','right','too_hard')),
  completed_at  timestamptz,      -- null = generated but not yet done
  created_at    timestamptz not null default now(),
  unique (program_id, session_number)
);
create index idx_physio_sessions_program on physio_program_sessions (program_id);

-- RLS
alter table physio_exercises enable row level security;
alter table physio_programs enable row level security;
alter table physio_program_sessions enable row level security;

create policy physio_exercises_select on physio_exercises for select using (true);

create policy physio_programs_select on physio_programs for select using (user_id = auth.uid());
create policy physio_programs_insert on physio_programs for insert with check (user_id = auth.uid());
create policy physio_programs_update on physio_programs for update using (user_id = auth.uid());
create policy physio_programs_delete on physio_programs for delete using (user_id = auth.uid());

create policy physio_sessions_select on physio_program_sessions for select
  using (exists (select 1 from physio_programs p where p.id = program_id and p.user_id = auth.uid()));
create policy physio_sessions_write on physio_program_sessions for all
  using (exists (select 1 from physio_programs p where p.id = program_id and p.user_id = auth.uid()))
  with check (exists (select 1 from physio_programs p where p.id = program_id and p.user_id = auth.uid()));

-- ai_suggestions: add the physio_plan kind to the existing hard-cap check constraint
-- (see 0026_form_check_cap.sql for why every kind MUST be listed here — an unlisted
-- kind silently fails the upsert and the cap never actually enforces).
alter table ai_suggestions
  drop constraint if exists ai_suggestions_kind_check;
alter table ai_suggestions
  add constraint ai_suggestions_kind_check
  check (kind in (
    'daily_tip', 'daily_tip_calls', 'meal_idea', 'workout_tip', 'food_estimate',
    'assistant_turn', 'workout_suggest', 'form_check', 'skin_scan', 'eye_scan', 'hair_scan',
    'wellness_insight', 'physio_plan'
  ));

-- ============ curated exercise seed (public domain standard rehab moves) ============
insert into physio_exercises (name, body_area, instructions, default_sets, default_reps, hold_sec, contraindication_notes) values
-- knee
('Quad Set', 'knee', 'Sit with leg straight, tighten the thigh muscle to press the back of the knee down into the floor/bed.', 3, '10', null, 'Skip if it causes sharp knee pain, not just muscle fatigue.'),
('Straight Leg Raise', 'knee', 'Lying down, tighten the thigh and lift the straight leg ~30cm, hold, lower slowly.', 3, '10', null, 'Stop if the lower back arches painfully to compensate.'),
('Heel Slides', 'knee', 'Lying down, slowly slide the heel toward the buttocks bending the knee, then slide back out.', 3, '10', null, null),
('Wall Sit', 'knee', 'Back against a wall, slide down to a shallow squat (not past 45°), hold.', 3, null, 20, 'Keep the squat shallow — deep wall sits load the knee more, not less.'),
('Seated Knee Extension', 'knee', 'Sitting on a chair, slowly straighten the knee until the leg is level, hold briefly, lower.', 3, '10-12', null, null),
('Step-Ups (low step)', 'knee', 'Step up onto a low, stable step leading with the affected leg, step back down with control.', 3, '8', null, 'Use a low step (10-15cm) and a rail for balance if unsteady.'),
-- shoulder
('Pendulum Swing', 'shoulder', 'Lean forward supporting yourself on a table with the good arm, let the affected arm hang and gently swing it in small circles.', 2, null, 30, null),
('Wall Crawl', 'shoulder', 'Facing a wall, walk the fingers up the wall as high as comfortable, hold briefly, walk back down.', 3, '8', null, 'Stop climbing at the first pinch of pain, don''t push through it.'),
('External Rotation (band or towel)', 'shoulder', 'Elbow at your side bent 90°, rotate the forearm outward against light resistance (band or rolled towel), return slowly.', 3, '10-12', null, null),
('Scapular Squeeze', 'shoulder', 'Sitting or standing, squeeze the shoulder blades together and hold, then release.', 3, null, 5, null),
('Cross-Body Stretch', 'shoulder', 'Bring the affected arm across the chest, gently pull it closer with the other arm, hold.', 2, null, 20, 'Should feel like a stretch, not pain — ease off if sharp.'),
-- back
('Cat-Cow', 'back', 'On hands and knees, alternate arching the back up (cat) and letting it sag down (cow), moving slowly with breath.', 2, '10', null, null),
('Pelvic Tilt', 'back', 'Lying on your back knees bent, flatten the lower back into the floor by tightening the abdomen, hold, release.', 3, null, 5, null),
('Bird Dog', 'back', 'On hands and knees, extend one arm and the opposite leg straight out, hold, return, alternate sides.', 3, '8 each side', null, 'Keep the movement slow and controlled — don''t let the back twist or sag.'),
('Bridge', 'back', 'Lying on your back knees bent, lift the hips up until body forms a straight line shoulders-to-knees, hold, lower.', 3, null, 5, null),
('Knee-to-Chest Stretch', 'back', 'Lying on your back, pull one knee toward the chest, hold, switch legs.', 2, null, 20, null),
('Child''s Pose', 'back', 'Kneel and sit back onto the heels, reach the arms forward and lower the chest toward the floor, hold.', 2, null, 30, null),
-- neck
('Chin Tucks', 'neck', 'Sitting tall, gently draw the chin straight back (like making a double chin), hold, release.', 3, null, 5, null),
('Neck Rotation Stretch', 'neck', 'Slowly turn the head to look over one shoulder as far as comfortable, hold, return, repeat other side.', 2, null, 15, 'Move slowly — avoid quick or jerky rotation.'),
('Upper Trap Stretch', 'neck', 'Sitting, gently tilt the head to one side (ear toward shoulder), use light hand pressure only if pain-free, hold, switch sides.', 2, null, 20, 'No forceful pulling — a mild stretch sensation only.'),
('Neck Side Bend', 'neck', 'Sitting tall, slowly tilt the ear toward the shoulder without lifting the shoulder up, hold, return, repeat other side.', 2, null, 10, null),
-- hip
('Clamshell', 'hip', 'Lying on your side knees bent, feet together, lift the top knee like opening a clamshell, lower slowly.', 3, '12', null, null),
('Standing Hip Abduction', 'hip', 'Standing holding support, lift the affected leg out to the side keeping the knee straight, lower slowly.', 3, '10', null, null),
('Glute Bridge', 'hip', 'Lying on your back knees bent, squeeze the glutes and lift the hips, hold, lower with control.', 3, null, 5, null),
('Hip Flexor Stretch', 'hip', 'Kneel in a lunge position, gently push the hips forward until a stretch is felt in the front of the hip, hold.', 2, null, 20, null),
('Seated Figure-4 Stretch', 'hip', 'Sitting, cross one ankle over the opposite knee, gently lean forward until a stretch is felt in the hip, hold, switch sides.', 2, null, 20, null),
-- ankle
('Ankle Alphabet', 'ankle', 'Sitting with the leg extended, trace the letters of the alphabet in the air with the big toe, moving only the ankle.', 1, null, null, null),
('Calf Raises', 'ankle', 'Standing (holding support if needed), rise up onto the toes, hold briefly, lower with control.', 3, '10-15', null, null),
('Ankle Pumps', 'ankle', 'Sitting or lying, point the foot down then flex it back up, repeat rhythmically.', 3, '15', null, null),
('Towel Calf Stretch', 'ankle', 'Sitting with the leg extended, loop a towel around the ball of the foot, gently pull the toes toward you, hold.', 2, null, 20, null),
('Single-Leg Balance', 'ankle', 'Stand on the affected leg near a wall or counter for support, hold as steady as possible.', 3, null, 20, 'Keep a hand near support at all times — this is a balance challenge, not a fall risk.'),
-- wrist
('Wrist Flexor Stretch', 'wrist', 'Extend the arm, palm up, gently pull the fingers back with the other hand until a stretch is felt, hold.', 2, null, 20, null),
('Wrist Extensor Stretch', 'wrist', 'Extend the arm, palm down, gently press the back of the hand down until a stretch is felt, hold.', 2, null, 20, null),
('Wrist Circles', 'wrist', 'Extend the arm forward and slowly rotate the wrist in circles, both directions.', 2, '10 each direction', null, null),
('Grip Strengthening (soft ball)', 'wrist', 'Squeeze a soft ball or rolled towel gently, hold, release.', 3, '10', null, 'Stop if it sharply increases pain rather than mild fatigue.'),
('Tendon Glide', 'wrist', 'Move the fingers through a straight hand → hook fist → full fist → straight fist sequence, slowly.', 2, '5', null, null);
