import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { generateWithFallback } from "@/lib/gemini";

const DAILY_USER_CAP = 10;

const admin = () =>
  createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { persistSession: false },
  });

export async function POST(req: NextRequest) {
  const { muscle, equipment } = await req.json();
  if (!muscle || typeof muscle !== "string" || muscle.length > 50) {
    return NextResponse.json({ error: "bad request" }, { status: 400 });
  }

  // authenticate the caller (anon key + user JWT from client)
  const jwt = req.headers.get("authorization")?.replace("Bearer ", "");
  if (!jwt) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const db = admin();
  const { data: userData, error: authErr } = await db.auth.getUser(jwt);
  if (authErr || !userData.user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const userId = userData.user.id;

  // per-user daily cap (tracked in ai_suggestions)
  const today = new Date().toISOString().slice(0, 10);
  const { data: capRow } = await db.from("ai_suggestions").select("content")
    .eq("user_id", userId).eq("log_date", today).eq("kind", "workout_suggest").maybeSingle();
  const used = (capRow?.content as { count?: number } | null)?.count ?? 0;
  if (used >= DAILY_USER_CAP) {
    return NextResponse.json({ error: "daily AI limit reached, try tomorrow" }, { status: 429 });
  }

  const prompt = `Suggest 3-5 exercises for the ${muscle} muscle group.
Equipment available: ${equipment || "Any"}.
Return them in JSON format. For each exercise, provide:
- name: clear name of the exercise
- met_value: estimated MET value (Metabolic Equivalent of Task, typical range 3.0 to 8.0)
- instructions: 1-2 short sentences on how to perform it
- typical_sets: number of sets (e.g. 3)
- typical_reps: recommended reps (e.g. 10)`;

  const res = await generateWithFallback([{ text: prompt }], {
    type: "OBJECT",
    properties: {
      suggestions: {
        type: "ARRAY",
        items: {
          type: "OBJECT",
          properties: {
            name: { type: "STRING" },
            met_value: { type: "NUMBER" },
            instructions: { type: "STRING" },
            typical_sets: { type: "NUMBER" },
            typical_reps: { type: "NUMBER" },
          },
          required: ["name", "met_value", "instructions", "typical_sets", "typical_reps"],
        },
      },
    },
    required: ["suggestions"],
  });

  if (!res.ok) return NextResponse.json({ error: "AI unavailable — Google's models are under heavy load, try again shortly" }, { status: 502 });
  const body = await res.json();
  let result;
  try {
    result = JSON.parse(body.candidates[0].content.parts[0].text);
  } catch {
    return NextResponse.json({ error: "AI returned invalid data" }, { status: 502 });
  }

  // record usage
  await db.from("ai_suggestions").upsert(
    { user_id: userId, log_date: today, kind: "workout_suggest", content: { count: used + 1 } },
    { onConflict: "user_id,log_date,kind" });

  return NextResponse.json(result);
}
