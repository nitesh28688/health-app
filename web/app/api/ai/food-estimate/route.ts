// Gemini food-nutrition estimate with global cache. Quota-conscious by design:
// 1. normalized-query cache hit → zero Gemini calls
// 2. per-user daily cap (checked server-side)
// Requires env: GEMINI_API_KEY, SUPABASE_SERVICE_ROLE_KEY (cache write bypasses RLS).
import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { generateWithFallback } from "@/lib/gemini";

const DAILY_USER_CAP = 10;

const admin = () =>
  createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { persistSession: false },
  });

export async function POST(req: NextRequest) {
  const { query } = await req.json();
  if (!query || typeof query !== "string" || query.length > 100) {
    return NextResponse.json({ error: "bad query" }, { status: 400 });
  }

  // authenticate the caller (anon key + user JWT from client)
  const jwt = req.headers.get("authorization")?.replace("Bearer ", "");
  if (!jwt) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const db = admin();
  const { data: userData, error: authErr } = await db.auth.getUser(jwt);
  if (authErr || !userData.user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const userId = userData.user.id;

  const qNorm = query.trim().toLowerCase().replace(/\s+/g, " ");

  // 1. cache
  const { data: cached } = await db.from("ai_food_cache").select("id,response,hit_count").eq("query_norm", qNorm).maybeSingle();
  if (cached) {
    db.from("ai_food_cache").update({ hit_count: cached.hit_count + 1 }).eq("id", cached.id).then(() => {});
    return NextResponse.json({ source: "cache", estimate: cached.response });
  }

  // 2. per-user daily cap (counts today's cache MISSES only, tracked in ai_suggestions)
  const today = new Date().toISOString().slice(0, 10);
  const { data: capRow } = await db.from("ai_suggestions").select("content")
    .eq("user_id", userId).eq("log_date", today).eq("kind", "food_estimate").maybeSingle();
  const used = (capRow?.content as { count?: number } | null)?.count ?? 0;
  if (used >= DAILY_USER_CAP) {
    return NextResponse.json({ error: "daily AI limit reached, try tomorrow" }, { status: 429 });
  }

  // 3. Gemini (REST, JSON mode — no SDK dependency)
  const prompt = `Estimate nutrition per 100 grams for this food (likely Indian cuisine): "${query}".
Respond with realistic values. If the query is not a food, set "is_food" to false.
Set "is_liquid" to true if this is a drink/beverage/soup that people would measure in ml rather than grams (tea, coffee, juice, milk, soda, soup, lassi, smoothie, shake). False for solid foods.`;
  const res = await generateWithFallback([{ text: prompt }], {
    type: "OBJECT",
    properties: {
      is_food: { type: "BOOLEAN" },
      name: { type: "STRING" },
      is_liquid: { type: "BOOLEAN" },
      kcal: { type: "NUMBER" }, protein_g: { type: "NUMBER" },
      carbs_g: { type: "NUMBER" }, fat_g: { type: "NUMBER" }, fiber_g: { type: "NUMBER" },
      sodium_mg: { type: "NUMBER" }, calcium_mg: { type: "NUMBER" }, iron_mg: { type: "NUMBER" },
    },
    required: ["is_food", "name", "is_liquid", "kcal", "protein_g", "carbs_g", "fat_g", "fiber_g"],
  });
  if (!res.ok) return NextResponse.json({ error: "AI unavailable — Google's models are under heavy load, try again shortly" }, { status: 502 });
  const body = await res.json();
  let estimate;
  try {
    estimate = JSON.parse(body.candidates[0].content.parts[0].text);
  } catch {
    return NextResponse.json({ error: "AI returned invalid data" }, { status: 502 });
  }

  // 4. record usage + cache (only cache real foods)
  await db.from("ai_suggestions").upsert(
    { user_id: userId, log_date: today, kind: "food_estimate", content: { count: used + 1 } },
    { onConflict: "user_id,log_date,kind" });
  if (estimate.is_food) {
    await db.from("ai_food_cache").insert({ query_norm: qNorm, response: estimate });
  }
  return NextResponse.json({ source: "gemini", estimate });
}
