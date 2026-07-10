// Estimate grams-per-piece for count-based foods with no known serving size
// (e.g. "KFC Peri Peri Chicken Strips" — searched, matched, but nobody seeded
// how much one strip weighs). Optional, user-triggered — never runs automatically,
// so it doesn't add an unbounded quota channel on top of food-estimate.
// Shares the same daily cap + cache table as food-estimate (query_norm prefixed
// "piece:") rather than introducing a second quota bucket to reason about.
import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { generateWithFallback } from "@/lib/gemini";

const DAILY_USER_CAP = 10;

const admin = () =>
  createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { persistSession: false },
  });

// Persist an AI piece-weight as a real food_servings row (service role — global
// foods aren't user-writable under RLS). Self-learning: the next person who opens
// this food sees a "piece" chip instead of re-asking the AI. Only fills a gap —
// never overwrites an existing piece serving.
async function persistPieceServing(db: ReturnType<typeof admin>, foodId: number, grams: number) {
  if (!(grams > 0 && grams <= 1000)) return;
  const { data: existing } = await db.from("food_servings")
    .select("id").eq("food_id", foodId).eq("label", "piece").limit(1);
  if (existing?.length) return;
  await db.from("food_servings").insert({ food_id: foodId, label: "piece", grams });
}

export async function POST(req: NextRequest) {
  const { name, food_id } = await req.json();
  if (!name || typeof name !== "string" || name.length > 100) {
    return NextResponse.json({ error: "bad name" }, { status: 400 });
  }
  const jwt = req.headers.get("authorization")?.replace("Bearer ", "");
  if (!jwt) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const db = admin();
  const { data: userData, error: authErr } = await db.auth.getUser(jwt);
  if (authErr || !userData.user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const userId = userData.user.id;

  const qNorm = `piece:${name.trim().toLowerCase().replace(/\s+/g, " ")}`;
  const { data: cached } = await db.from("ai_food_cache").select("response").eq("query_norm", qNorm).maybeSingle();
  if (cached) {
    const cachedGrams = (cached.response as { grams: number }).grams;
    if (typeof food_id === "number") await persistPieceServing(db, food_id, cachedGrams);
    return NextResponse.json({ source: "cache", grams: cachedGrams });
  }

  const today = new Date().toISOString().slice(0, 10);
  const { data: capRow } = await db.from("ai_suggestions").select("content")
    .eq("user_id", userId).eq("log_date", today).eq("kind", "food_estimate").maybeSingle();
  const used = (capRow?.content as { count?: number } | null)?.count ?? 0;
  if (used >= DAILY_USER_CAP) {
    return NextResponse.json({ error: "daily AI limit reached, try tomorrow" }, { status: 429 });
  }

  const prompt = `What is the typical weight in grams of ONE piece/unit of this food: "${name}"? ` +
    `Give a single realistic number for one typical serving unit (one strip, one piece, one bottle, etc).`;
  const res = await generateWithFallback([{ text: prompt }], {
    type: "OBJECT",
    properties: { grams: { type: "NUMBER" } },
    required: ["grams"],
  });
  if (!res.ok) return NextResponse.json({ error: "AI unavailable — try again shortly" }, { status: 502 });
  const body = await res.json();
  let grams: number;
  try { grams = JSON.parse(body.candidates[0].content.parts[0].text).grams; }
  catch { return NextResponse.json({ error: "AI returned invalid data" }, { status: 502 }); }
  if (!(grams > 0)) return NextResponse.json({ error: "couldn't estimate a weight" }, { status: 502 });

  await db.from("ai_suggestions").upsert(
    { user_id: userId, log_date: today, kind: "food_estimate", content: { count: used + 1 } },
    { onConflict: "user_id,log_date,kind" });
  await db.from("ai_food_cache").insert({ query_norm: qNorm, response: { grams } });
  if (typeof food_id === "number") await persistPieceServing(db, food_id, grams);
  return NextResponse.json({ source: "gemini", grams });
}
