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

  const { text } = await req.json();
  if (!text || typeof text !== "string") {
    return NextResponse.json({ error: "bad request" }, { status: 400 });
  }

  const db = admin();
  const { data: userData, error: authErr } = await db.auth.getUser(jwt);
  if (authErr || !userData.user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  // Look up the user's current weight so we can properly estimate kcal burned
  const { data: latestMetric } = await db
    .from("body_metrics")
    .select("weight_kg")
    .eq("user_id", userData.user.id)
    .order("log_date", { ascending: false })
    .limit(1)
    .single();
  const userWeightKg = latestMetric?.weight_kg ?? 70; // safe fallback

  const prompt = `You are a health logging assistant. Parse this message and extract everything that should be logged: "${text}"

Return a strict JSON object. Follow these exact rules:
- foods: for each food, estimate the realistic quantity in grams (qty_g) and a display label (qty_unit_label, e.g. "2 eggs", "1 bowl", "200g"). All per-100g macros (kcal, protein_g, carbs_g, fat_g, fiber_g) must be realistic per-100g values for that food. Do NOT scale them to the quantity.
- exercises: for each exercise, provide duration_min (total workout duration) and met_value (standard MET value: walking=3.5, running=9, cycling=6, pushups=5, weightlifting=5, yoga=2.5).
- weight_kg: if mentioned, as a number.
- water_ml: if mentioned, as a number (500ml = 500, "2 glasses" = 500).
Do not invent anything not mentioned. Return empty arrays if nothing is found.`;

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
            qty_g: { type: "NUMBER" },
            qty_unit_label: { type: "STRING" },
            meal: { type: "STRING", enum: ["breakfast", "lunch", "dinner", "snack"] },
            kcal: { type: "NUMBER" },
            protein_g: { type: "NUMBER" },
            carbs_g: { type: "NUMBER" },
            fat_g: { type: "NUMBER" },
            fiber_g: { type: "NUMBER" },
          },
          required: ["name", "qty_g", "qty_unit_label", "meal", "kcal", "protein_g", "carbs_g", "fat_g", "fiber_g"],
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
            met_value: { type: "NUMBER" },
          },
          required: ["name", "sets", "duration_min", "met_value"],
        },
      },
    },
  });

  if (!res.ok) return NextResponse.json({ error: "AI unavailable" }, { status: 502 });
  const body = await res.json();
  let parsed: {
    weight_kg?: number;
    water_ml?: number;
    foods?: {
      name: string;
      qty_g: number;
      qty_unit_label: string;
      meal: string;
      kcal: number;
      protein_g: number;
      carbs_g: number;
      fat_g: number;
      fiber_g: number;
    }[];
    exercises?: {
      name: string;
      sets: number;
      reps?: number;
      weight_kg?: number;
      duration_min: number;
      met_value: number;
    }[];
  };
  try {
    parsed = JSON.parse(body.candidates[0].content.parts[0].text);
  } catch {
    return NextResponse.json({ error: "AI returned invalid data" }, { status: 502 });
  }

  // Compute kcal_burned for each exercise using the MET formula.
  // kcal = MET × weight_kg × (duration_min / 60)
  // This matches kcalBurned() in lib/nutrition.ts — done here so the
  // frontend can display per-exercise estimates in the confirmation sheet
  // without importing server-side logic.
  const exercisesWithBurn = (parsed.exercises ?? []).map((ex) => ({
    ...ex,
    kcal_burned: Math.round(ex.met_value * userWeightKg * (ex.duration_min / 60)),
  }));

  // Return the proposal to the client. Nothing is written to the DB here.
  // The frontend shows the user a confirmation sheet and performs the inserts
  // only if the user confirms.
  return NextResponse.json({
    proposal: {
      // Gemini's schema requires these fields to always be numbers (no
      // "absent" representation) — when nothing was mentioned it returns 0,
      // not null. Normalize that here so "not logged" and "logged as zero"
      // (a case that never legitimately happens for weight/water) collapse
      // to the same null, instead of leaking a literal "0" into the UI.
      weight_kg: parsed.weight_kg || null,
      water_ml: parsed.water_ml || null,
      foods: parsed.foods ?? [],
      exercises: exercisesWithBurn,
      user_weight_kg: userWeightKg, // sent back so the client can recompute if needed
    },
  });
}
