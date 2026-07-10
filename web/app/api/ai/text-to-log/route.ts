import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { generateWithFallback } from "@/lib/gemini";

const admin = () =>
  createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { persistSession: false },
  });

export async function POST(req: NextRequest) {
  const jwt = req.headers.get("authorization")?.replace("Bearer ", "");
  if (!jwt) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  
  const { text, log_date } = await req.json();
  if (!text || typeof text !== "string") {
    return NextResponse.json({ error: "bad request" }, { status: 400 });
  }

  const db = admin();
  const { data: userData, error: authErr } = await db.auth.getUser(jwt);
  if (authErr || !userData.user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const userId = userData.user.id;

  const today = log_date || new Date().toISOString().slice(0, 10);

  const prompt = `Extract health logging data from this text: "${text}"
Return a strict JSON object with:
- weight_kg (number, optional)
- water_ml (number, optional)
- foods (array of objects, optional): For each food mentioned, estimate:
  - name (string)
  - kcal (number)
  - protein_g (number)
  - carbs_g (number)
  - fat_g (number)
  - meal (string: breakfast, lunch, dinner, or snack)
- exercises (array of objects, optional): For each exercise:
  - name (string)
  - sets (number, default 1)
  - reps (number, optional)
  - weight_kg (number, optional)
  - duration_min (number, optional)`;

  const res = await generateWithFallback([{ text: prompt }], {
    type: "OBJECT",
    properties: {
      weight_kg: { type: "NUMBER" },
      water_ml: { type: "NUMBER" },
      foods: {
        type: "ARRAY",
        items: {
          type: "OBJECT",
          properties: {
            name: { type: "STRING" },
            kcal: { type: "NUMBER" },
            protein_g: { type: "NUMBER" },
            carbs_g: { type: "NUMBER" },
            fat_g: { type: "NUMBER" },
            meal: { type: "STRING", enum: ["breakfast", "lunch", "dinner", "snack"] },
          },
          required: ["name", "kcal", "protein_g", "carbs_g", "fat_g", "meal"],
        },
      },
      exercises: {
        type: "ARRAY",
        items: {
          type: "OBJECT",
          properties: {
            name: { type: "STRING" },
            sets: { type: "NUMBER" },
            reps: { type: "NUMBER" },
            weight_kg: { type: "NUMBER" },
            duration_min: { type: "NUMBER" },
          },
          required: ["name", "sets"],
        },
      },
    },
  });

  if (!res.ok) return NextResponse.json({ error: "AI unavailable" }, { status: 502 });
  const body = await res.json();
  let parsed;
  try {
    parsed = JSON.parse(body.candidates[0].content.parts[0].text);
  } catch {
    return NextResponse.json({ error: "AI returned invalid data" }, { status: 502 });
  }

  const results: any = {};

  // 1. Weight
  if (parsed.weight_kg) {
    await db.from("body_metrics").upsert(
      { user_id: userId, log_date: today, weight_kg: parsed.weight_kg },
      { onConflict: "user_id,log_date" }
    );
    results.weight = true;
  }

  // 2. Water
  if (parsed.water_ml) {
    await db.from("water_logs").insert({ user_id: userId, log_date: today, ml: parsed.water_ml });
    results.water = true;
  }

  // 3. Foods
  if (parsed.foods && parsed.foods.length > 0) {
    for (const f of parsed.foods) {
      // Create a temporary food item
      const { data: foodRow } = await db.from("foods").insert({
        name: f.name, source: "ai_log", owner_id: userId, 
        kcal: f.kcal, protein_g: f.protein_g, carbs_g: f.carbs_g, fat_g: f.fat_g
      }).select("id").single();
      
      if (foodRow) {
        await db.from("food_logs").insert({
          user_id: userId, log_date: today, food_id: foodRow.id,
          meal: f.meal || "snack", qty_g: 100, qty_unit_label: "1 serving",
          kcal: f.kcal, protein_g: f.protein_g, carbs_g: f.carbs_g, fat_g: f.fat_g, fiber_g: 0
        });
      }
    }
    results.foods = parsed.foods.length;
  }

  // 4. Exercises
  if (parsed.exercises && parsed.exercises.length > 0) {
    const { data: logRow } = await db.from("workout_logs").insert({
      user_id: userId, log_date: today, title: "Smart Log Workout", duration_min: 15, kcal_burned: 100
    }).select("id").single();

    if (logRow) {
      for (const ex of parsed.exercises) {
        const { data: exRow } = await db.from("exercises").insert({
          name: ex.name, category: "Custom", owner_id: userId, met_value: 4
        }).select("id").single();

        if (exRow) {
          const { data: wle } = await db.from("workout_log_exercises").insert({
            log_id: logRow.id, exercise_id: exRow.id, order_index: 0
          }).select("id").single();
          
          if (wle) {
            const setsData = [];
            for (let i = 0; i < ex.sets; i++) {
              setsData.push({
                exercise_id: wle.id, set_number: i + 1,
                weight_kg: ex.weight_kg || null, reps: ex.reps || null,
                duration_sec: ex.duration_min ? ex.duration_min * 60 : null
              });
            }
            await db.from("workout_log_sets").insert(setsData);
          }
        }
      }
      results.workout = true;
    }
  }

  return NextResponse.json({ success: true, parsed, results });
}
