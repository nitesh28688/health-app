// AI coach feedback on a user's recent workout history. Capped at one per user
// per day via ai_suggestions (same quota-cap pattern as food-estimate).
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
  const db = admin();
  const { data: userData } = await db.auth.getUser(jwt);
  if (!userData.user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const userId = userData.user.id;
  const today = new Date().toISOString().slice(0, 10);

  const { data: cached } = await db.from("ai_suggestions").select("content")
    .eq("user_id", userId).eq("log_date", today).eq("kind", "workout_tip").maybeSingle();
  if (cached) return NextResponse.json({ source: "cache", tip: cached.content });

  const since = new Date(Date.now() - 21 * 86400_000).toISOString().slice(0, 10);
  const [{ data: logs }, { data: profile }] = await Promise.all([
    db.from("workout_logs").select("log_date,title,duration_min,kcal_burned,notes")
      .eq("user_id", userId).gte("log_date", since).order("log_date", { ascending: false }),
    db.from("profiles").select("activity_level,target_kcal").eq("id", userId).single(),
  ]);
  if (!logs || logs.length === 0) {
    return NextResponse.json({ error: "Log a few workouts first, then ask again." }, { status: 400 });
  }

  const summary = logs.map((l) =>
    `${l.log_date}: ${l.title}, ${l.duration_min}min, ~${Math.round(l.kcal_burned ?? 0)}kcal${l.notes ? ` — ${l.notes}` : ""}`
  ).join("\n");
  const prompt = `You are a friendly, concise fitness coach. Here is a person's workout log from the last 3 weeks (activity level: ${profile?.activity_level ?? "unknown"}):\n${summary}\n\nGive 2-3 short, specific, encouraging observations and one concrete suggestion for next week. Max 80 words total. Plain text, no markdown headers.`;

  const res = await generateWithFallback([{ text: prompt }]);
  if (!res.ok) return NextResponse.json({ error: "AI unavailable — Google's models are under heavy load, try again shortly" }, { status: 502 });
  const body = await res.json();
  const tip = body.candidates?.[0]?.content?.parts?.[0]?.text?.trim();
  if (!tip) return NextResponse.json({ error: "AI returned nothing" }, { status: 502 });

  await db.from("ai_suggestions").upsert(
    { user_id: userId, log_date: today, kind: "workout_tip", content: { text: tip } },
    { onConflict: "user_id,log_date,kind" });
  return NextResponse.json({ source: "gemini", tip: { text: tip } });
}
