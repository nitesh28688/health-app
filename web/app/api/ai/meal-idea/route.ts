// AI meal suggestion based on remaining daily macros. Same cache/quota pattern
// as workout-tip: capped at once per user per day via ai_suggestions.
import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { todayLocal } from "@/lib/nutrition";
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
  const today = todayLocal();

  const { data: cached } = await db.from("ai_suggestions").select("content")
    .eq("user_id", userId).eq("log_date", today).eq("kind", "meal_idea").maybeSingle();
  if (cached) return NextResponse.json({ source: "cache", idea: cached.content });

  const [{ data: profile }, { data: totalsRows }] = await Promise.all([
    db.from("profiles").select("target_kcal,target_protein,target_carbs,target_fat").eq("id", userId).single(),
    db.rpc("get_daily_totals", { p_from: today, p_to: today }),
  ]);
  const t = totalsRows?.[0];
  const remKcal = Math.max(0, (profile?.target_kcal ?? 2000) - Number(t?.kcal ?? 0));
  const remProtein = Math.max(0, (profile?.target_protein ?? 100) - Number(t?.protein_g ?? 0));
  const remCarbs = Math.max(0, (profile?.target_carbs ?? 250) - Number(t?.carbs_g ?? 0));
  const remFat = Math.max(0, (profile?.target_fat ?? 65) - Number(t?.fat_g ?? 0));

  const prompt = `Someone has ${Math.round(remKcal)} kcal, ${Math.round(remProtein)}g protein, ` +
    `${Math.round(remCarbs)}g carbs, ${Math.round(remFat)}g fat left in their daily targets. ` +
    `Suggest ONE simple Indian-friendly meal or snack that roughly fits. Max 40 words, plain text, no markdown.`;

  const res = await generateWithFallback([{ text: prompt }]);
  if (!res.ok) return NextResponse.json({ error: "AI unavailable — Google's models are under heavy load, try again shortly" }, { status: 502 });
  const body = await res.json();
  const text = body.candidates?.[0]?.content?.parts?.[0]?.text?.trim();
  if (!text) return NextResponse.json({ error: "AI returned nothing" }, { status: 502 });

  await db.from("ai_suggestions").upsert(
    { user_id: userId, log_date: today, kind: "meal_idea", content: { text } },
    { onConflict: "user_id,log_date,kind" });
  return NextResponse.json({ source: "gemini", idea: { text } });
}
