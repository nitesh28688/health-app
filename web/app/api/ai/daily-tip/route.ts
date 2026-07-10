import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { generateWithFallback } from "@/lib/gemini";

const admin = () =>
  createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { persistSession: false },
  });

// Generous but bounded — regenerating on every meaningful change to the day
// (not just once/day) means a genuinely active day can trigger several calls,
// but at Vertex Flash pricing that's still a fraction of a paisa each.
const DAILY_USER_CAP = 15;

interface CachedTip {
  text: string;
  kcal: number;
  protein_g: number;
  water_ml: number;
  workout_kcal: number;
}

export async function POST(req: NextRequest) {
  const jwt = req.headers.get("authorization")?.replace("Bearer ", "");
  if (!jwt) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const db = admin();
  const { data: userData, error: authErr } = await db.auth.getUser(jwt);
  if (authErr || !userData.user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const userId = userData.user.id;

  const today = new Date().toISOString().slice(0, 10);

  // Fetch today's real signal — same fields whether reusing the cache or
  // deciding to regenerate, so the comparison below is apples-to-apples.
  const { data: profile } = await db.from("profiles").select("*").eq("id", userId).single();
  const { data: recentFood } = await db.from("food_logs").select("kcal, protein_g").eq("user_id", userId).eq("log_date", today);
  const { data: recentWater } = await db.from("water_logs").select("ml").eq("user_id", userId).eq("log_date", today);
  const { data: recentWorkouts } = await db.from("workout_logs").select("title, duration_min, kcal_burned").eq("user_id", userId).eq("log_date", today);
  const { data: streaksData } = await db.rpc("get_streaks");

  const tKcal = (recentFood || []).reduce((sum, f) => sum + Number(f.kcal), 0);
  const tProtein = (recentFood || []).reduce((sum, f) => sum + Number(f.protein_g), 0);
  const tWater = (recentWater || []).reduce((sum, w) => sum + Number(w.ml), 0);
  const tWorkoutKcal = (recentWorkouts || []).reduce((sum, w) => sum + Number(w.kcal_burned ?? 0), 0);

  // 1. Reuse today's cached tip ONLY if nothing about the day has actually
  // changed since it was generated — the previous version cached purely by
  // calendar date, so a tip generated at 8am off near-zero totals (a generic
  // "drink water" nudge, since there's nothing else to react to yet) stayed
  // frozen for the rest of the day no matter how much got logged afterward.
  const { data: existing } = await db.from("ai_suggestions")
    .select("content")
    .eq("user_id", userId)
    .eq("log_date", today)
    .eq("kind", "daily_tip")
    .maybeSingle();

  const cached = existing?.content as CachedTip | undefined;
  const staleCacheFields = !cached || typeof cached.text !== "string" || typeof cached.kcal !== "number";
  const unchanged =
    !staleCacheFields &&
    cached!.kcal === tKcal &&
    cached!.protein_g === tProtein &&
    cached!.water_ml === tWater &&
    cached!.workout_kcal === tWorkoutKcal;

  if (unchanged) {
    return NextResponse.json({ tip: cached!.text });
  }

  // 2. Daily cap on actual regenerations (not on cache hits above).
  const { data: capRow } = await db.from("ai_suggestions").select("content")
    .eq("user_id", userId).eq("log_date", today).eq("kind", "daily_tip_calls").maybeSingle();
  const used = (capRow?.content as { count?: number } | null)?.count ?? 0;
  if (used >= DAILY_USER_CAP) {
    // Out of regenerations for today — better to show the last real tip
    // (even if slightly stale) than nothing at all.
    if (cached?.text) return NextResponse.json({ tip: cached.text });
    return NextResponse.json({ error: "daily AI limit reached, try tomorrow" }, { status: 429 });
  }
  await db.from("ai_suggestions").upsert(
    { user_id: userId, log_date: today, kind: "daily_tip_calls", content: { count: used + 1 } },
    { onConflict: "user_id,log_date,kind" });

  const streak = (streaksData ?? []).find((s: { kind: string }) => s.kind === "diary");
  const workoutSummary = recentWorkouts?.length
    ? recentWorkouts.map((w) => `${w.title} (${w.duration_min}min, ~${Math.round(Number(w.kcal_burned ?? 0))} kcal)`).join(", ")
    : "no workout logged yet today";

  const prompt = `You are "Core Insights", an AI health coach with real personality — witty, a little cheeky, genuinely reactive to what this specific person actually did today. Never generic.
User profile: target ${profile?.target_kcal} kcal, ${profile?.target_protein}g protein, ${profile?.target_water_ml}ml water.
Today so far: ${tKcal} kcal eaten, ${tProtein}g protein eaten, ${tWater}ml water drunk, workouts: ${workoutSummary}.
Current daily-logging streak: ${streak?.current_streak ?? 0} days (best ever: ${streak?.best_streak ?? 0}).
Give a 2-sentence reactive message about their day so far, taking ALL of the above into account — not just water. If they worked out, mention it specifically. If they're on a good streak, acknowledge it. If they're crushing protein/calorie goals, hype them up hard. If they're way off (overeating, barely any protein, zero water, no activity), give a playful, motivating roast — never mean, always funny. Vary your angle each time based on whichever signal is most notable right now. Keep it punchy and fun. No hashtags, no markdown, no generic filler like "keep up the good work."`;

  const aiRes = await generateWithFallback([{ text: prompt }]);
  if (!aiRes.ok) {
    // Fall back to the last real tip rather than surfacing an error for
    // something this low-stakes.
    if (cached?.text) return NextResponse.json({ tip: cached.text });
    return NextResponse.json({ error: "AI unavailable" }, { status: 503 });
  }

  const aiBody = await aiRes.json();
  const text = aiBody.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!text) {
    if (cached?.text) return NextResponse.json({ tip: cached.text });
    return NextResponse.json({ error: "bad AI response" }, { status: 500 });
  }

  const tip = text.trim();

  await db.from("ai_suggestions").upsert({
    user_id: userId,
    log_date: today,
    kind: "daily_tip",
    content: { text: tip, kcal: tKcal, protein_g: tProtein, water_ml: tWater, workout_kcal: tWorkoutKcal } satisfies CachedTip,
  }, { onConflict: "user_id,log_date,kind" });

  return NextResponse.json({ tip });
}
