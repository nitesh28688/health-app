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

export async function POST(req: NextRequest) {
  const { name } = await req.json();
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
  if (cached) return NextResponse.json({ source: "cache", grams: (cached.response as { grams: number }).grams });

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
  return NextResponse.json({ source: "gemini", grams });
}
