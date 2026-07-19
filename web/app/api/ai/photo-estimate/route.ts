// AI food estimate from a photo (Gemini vision). No caching possible here —
// every photo is unique — so this shares the same 10/day quota bucket as the
// text-based /api/ai/food-estimate to bound worst-case Gemini free-tier load
// regardless of how many people use the app.
import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { generateWithFallback } from "@/lib/gemini";

const DAILY_USER_CAP = 10;

const admin = () =>
  createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { persistSession: false },
  });

export async function POST(req: NextRequest) {
  const jwt = req.headers.get("authorization")?.replace("Bearer ", "");
  if (!jwt) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const { imageDataUrl } = await req.json();
  if (typeof imageDataUrl !== "string" || !imageDataUrl.startsWith("data:image/")) {
    return NextResponse.json({ error: "bad image" }, { status: 400 });
  }
  const [, mimeType, base64] = imageDataUrl.match(/^data:(image\/\w+);base64,(.+)$/) ?? [];
  if (!base64) return NextResponse.json({ error: "bad image" }, { status: 400 });

  const db = admin();
  const { data: userData } = await db.auth.getUser(jwt);
  if (!userData.user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const userId = userData.user.id;

  const today = new Date().toISOString().slice(0, 10);
  const { data: capRow } = await db.from("ai_suggestions").select("content")
    .eq("user_id", userId).eq("log_date", today).eq("kind", "food_estimate").maybeSingle();
  const used = (capRow?.content as { count?: number } | null)?.count ?? 0;
  if (used >= DAILY_USER_CAP) {
    return NextResponse.json({ error: "daily AI limit reached, try tomorrow" }, { status: 429 });
  }

  const res = await generateWithFallback(
    [
      { text: "Identify the food in this photo and estimate its nutrition per 100 grams. Treat beverages (including alcohol and liquor) as food. If this isn't a consumable food or beverage, set is_food to false. Set is_liquid to true if it's a drink/beverage/soup measured in ml rather than grams. Also give 1-2 natural household serving measures in servings with the typical weight in grams of ONE such serving: piece for countable items, glass/cup for drinks, katori (~150g) for curries/dal/rice, plate for full plates, slice/bowl/tbsp/tsp/scoop where natural. If this is packaged food, look closely for a printed net weight (e.g. \"15g\", \"Net Wt. 30g\") on the packaging and use that exact figure for the serving size instead of guessing a generic default — packaged snack sizes vary widely and a printed weight is always more accurate than an estimate. Also set is_usable: false if the photo is too blurry/dark/obscured to confidently identify the food and estimate its nutrition (you're mostly guessing), true otherwise — most photos should be true." },
      { inline_data: { mime_type: mimeType, data: base64 } },
    ],
    {
      type: "OBJECT",
      properties: {
        is_food: { type: "BOOLEAN" }, name: { type: "STRING" }, is_liquid: { type: "BOOLEAN" }, is_usable: { type: "BOOLEAN" },
        kcal: { type: "NUMBER" }, protein_g: { type: "NUMBER" },
        carbs_g: { type: "NUMBER" }, fat_g: { type: "NUMBER" }, fiber_g: { type: "NUMBER" },
        servings: {
          type: "ARRAY",
          items: {
            type: "OBJECT",
            properties: {
              label: { type: "STRING", enum: ["piece", "slice", "katori", "bowl", "cup", "glass", "plate", "tbsp", "tsp", "scoop"] },
              grams: { type: "NUMBER" },
            },
            required: ["label", "grams"],
          },
        },
      },
      required: ["is_food", "name", "is_liquid", "kcal", "protein_g", "carbs_g", "fat_g", "fiber_g"],
    }
  );
  if (!res.ok) return NextResponse.json({ error: "AI unavailable — Google's models are under heavy load, try again shortly" }, { status: 502 });
  const body = await res.json();
  let estimate;
  try { estimate = JSON.parse(body.candidates[0].content.parts[0].text); }
  catch { return NextResponse.json({ error: "AI returned invalid data" }, { status: 502 }); }

  await db.from("ai_suggestions").upsert(
    { user_id: userId, log_date: today, kind: "food_estimate", content: { count: used + 1 } },
    { onConflict: "user_id,log_date,kind" });
  return NextResponse.json({ estimate });
}
