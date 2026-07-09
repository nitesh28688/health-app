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
  const { data: userData, error: authErr } = await db.auth.getUser(jwt);
  if (authErr || !userData.user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const userId = userData.user.id;

  const today = new Date().toISOString().slice(0, 10);

  // 1. check if we already generated a tip today
  const { data: existing } = await db.from("ai_suggestions")
    .select("content")
    .eq("user_id", userId)
    .eq("log_date", today)
    .eq("kind", "daily_tip")
    .maybeSingle();
    
  if (existing && existing.content && typeof existing.content === 'object' && 'text' in existing.content) {
    return NextResponse.json({ tip: (existing.content as { text: string }).text });
  }

  // 2. Fetch recent activity to give a context-aware tip
  const { data: profile } = await db.from("profiles").select("*").eq("id", userId).single();
  const { data: recentFood } = await db.from("food_logs").select("kcal, protein_g").eq("user_id", userId).eq("log_date", today);
  const { data: recentWater } = await db.from("water_logs").select("ml").eq("user_id", userId).eq("log_date", today);

  const tKcal = (recentFood || []).reduce((sum, f) => sum + Number(f.kcal), 0);
  const tProtein = (recentFood || []).reduce((sum, f) => sum + Number(f.protein_g), 0);
  const tWater = (recentWater || []).reduce((sum, w) => sum + Number(w.ml), 0);

  const prompt = `You are an encouraging AI health coach.
User profile: ${profile?.diet_type} diet, target ${profile?.target_kcal} kcal, ${profile?.target_protein}g protein, ${profile?.target_water_ml}ml water.
Today's progress: ${tKcal} kcal eaten, ${tProtein}g protein eaten, ${tWater}ml water drank.
Give a single, very short (1-2 sentences max) proactive health tip or encouragement based on their day so far. Keep it casual and friendly. No hashtags or markdown.`;

  const aiRes = await generateWithFallback([{ text: prompt }]);
  if (!aiRes.ok) return NextResponse.json({ error: "AI unavailable" }, { status: 503 });

  const aiBody = await aiRes.json();
  const text = aiBody.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!text) return NextResponse.json({ error: "bad AI response" }, { status: 500 });

  const tip = text.trim();

  // save to ai_suggestions
  await db.from("ai_suggestions").upsert({
    user_id: userId,
    log_date: today,
    kind: "daily_tip",
    content: { text: tip }
  }, { onConflict: "user_id,log_date,kind" });

  return NextResponse.json({ tip });
}
