import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { generateWithFallback } from "@/lib/gemini";

const DAILY_USER_CAP = 10;

const admin = () =>
  createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { persistSession: false },
  });

export async function POST(req: NextRequest) {
  const { time, location, equipment, focus } = await req.json();
  if (!focus || typeof focus !== "string") {
    return NextResponse.json({ error: "bad request" }, { status: 400 });
  }

  // authenticate the caller
  const jwt = req.headers.get("authorization")?.replace("Bearer ", "");
  if (!jwt) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const db = admin();
  const { data: userData, error: authErr } = await db.auth.getUser(jwt);
  if (authErr || !userData.user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const userId = userData.user.id;

  // daily cap
  const today = new Date().toISOString().slice(0, 10);
  const { data: capRow } = await db.from("ai_suggestions").select("content")
    .eq("user_id", userId).eq("log_date", today).eq("kind", "workout_suggest").maybeSingle();
  const used = (capRow?.content as { count?: number } | null)?.count ?? 0;
  if (used >= DAILY_USER_CAP) {
    return NextResponse.json({ error: "daily AI limit reached, try tomorrow" }, { status: 429 });
  }

  const prompt = `Act as an expert personal trainer. Generate a highly effective workout routine based on:
Target Focus: ${focus}
Time Available: ${time || "30"} minutes
Location: ${location || "Gym"}
Available Equipment: ${equipment || "Standard gym equipment"}

Return a strict JSON object containing:
- title: A catchy name for this routine (e.g. "30 Min Kettlebell Shred")
- exercises: An array of exercises in the order they should be performed. For each:
  - name: Exercise name
  - met_value: Estimated MET value (3.0 to 8.0)
  - instructions: 1-2 short sentences on form
  - sets: Number of sets (number)
  - reps: Reps per set (number, optional if it's duration based)
  - duration_min: Duration in minutes (number, optional if it's rep based)
`;

  const res = await generateWithFallback([{ text: prompt }], {
    type: "OBJECT",
    properties: {
      title: { type: "STRING" },
      exercises: {
        type: "ARRAY",
        items: {
          type: "OBJECT",
          properties: {
            name: { type: "STRING" },
            met_value: { type: "NUMBER" },
            instructions: { type: "STRING" },
            sets: { type: "NUMBER" },
            reps: { type: "NUMBER" },
            duration_min: { type: "NUMBER" },
          },
          required: ["name", "met_value", "instructions", "sets"],
        },
      },
    },
    required: ["title", "exercises"],
  });

  if (!res.ok) return NextResponse.json({ error: "AI unavailable" }, { status: 502 });
  const body = await res.json();
  let result;
  try {
    result = JSON.parse(body.candidates[0].content.parts[0].text);
  } catch {
    return NextResponse.json({ error: "AI returned invalid data" }, { status: 502 });
  }

  // 1. Create the Workout Plan
  const { data: planRow } = await db.from("workout_plans").insert({
    owner_id: userId, title: result.title, is_public: false,
    description: `AI Generated ${location} Workout - ${focus} (${time || 30}m)`
  }).select("id").single();

  if (planRow) {
    // 2. Create a single Plan Day
    const { data: dayRow } = await db.from("workout_plan_days").insert({
      plan_id: planRow.id, day_number: 1, title: result.title
    }).select("id").single();

    if (dayRow) {
      // 3. Create Exercises and Plan Items
      for (let i = 0; i < result.exercises.length; i++) {
        const ex = result.exercises[i];
        const { data: exRow } = await db.from("exercises").insert({
          name: ex.name, category: "Custom", owner_id: userId, met_value: ex.met_value || 5, instructions: ex.instructions
        }).select("id").single();

        if (exRow) {
          await db.from("workout_plan_items").insert({
            day_id: dayRow.id, exercise_id: exRow.id, order_index: i,
            sets: ex.sets || 3, reps: ex.reps || null, duration_min: ex.duration_min || null
          });
        }
      }
    }
  }

  // record usage
  await db.from("ai_suggestions").upsert(
    { user_id: userId, log_date: today, kind: "workout_suggest", content: { count: used + 1 } },
    { onConflict: "user_id,log_date,kind" }
  );

  return NextResponse.json({ success: true, planId: planRow?.id });
}
