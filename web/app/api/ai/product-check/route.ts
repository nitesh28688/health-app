import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { generateWithFallback } from "@/lib/gemini";

const DAILY_USER_CAP = 10;

const admin = () =>
  createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { persistSession: false },
  });

const todayIst = () => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" }).format(new Date());

const stripNulls = (s: string) => s.split(String.fromCharCode(0)).join("");
const cleanArr = (a: unknown, max: number) =>
  Array.isArray(a) ? a.slice(0, max).map((x) => stripNulls(String(x)).trim()).filter(Boolean) : [];

export async function POST(req: NextRequest) {
  const jwt = req.headers.get("authorization")?.replace("Bearer ", "");
  if (!jwt) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const { imageDataUrl } = await req.json();
  if (typeof imageDataUrl !== "string" || !imageDataUrl.startsWith("data:image/")) {
    return NextResponse.json({ error: "bad image payload" }, { status: 400 });
  }
  const match = imageDataUrl.match(/^data:(image\/\w+);base64,(.+)$/) ?? [];
  const [, mimeType, base64] = match;
  if (!base64) return NextResponse.json({ error: "bad image payload structure" }, { status: 400 });

  const dbAdmin = admin();
  const { data: userData } = await dbAdmin.auth.getUser(jwt);
  if (!userData.user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const userId = userData.user.id;

  const userDb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
    global: { headers: { Authorization: `Bearer ${jwt}` } },
    auth: { persistSession: false },
  });

  // Cap check
  const today = todayIst();
  const { data: capRow } = await dbAdmin.from("ai_suggestions").select("content")
    .eq("user_id", userId).eq("log_date", today).eq("kind", "product_check").maybeSingle();
  const used = (capRow?.content as { count?: number } | null)?.count ?? 0;
  if (used >= DAILY_USER_CAP) {
    return NextResponse.json({ error: "daily AI limit reached, try tomorrow" }, { status: 429 });
  }

  // Personalization context: latest usable scan per type, flagged conditions,
  // and the current shelf (for conflict warnings against what they already own).
  const [scansRes, profileRes, shelfRes, journalRes] = await Promise.all([
    userDb.from("wellness_scans")
      .select("scan_type, classification, observations, taken_at")
      .eq("is_usable", true).order("taken_at", { ascending: false }).limit(6),
    userDb.from("profiles").select("sex, conditions").eq("id", userId).single(),
    userDb.from("wellness_products")
      .select("name, product_type, key_actives, usage_time")
      .eq("status", "active").limit(30),
    userDb.from("wellness_journal")
      .select("entry_text, entry_at, category")
      .eq("category", "treatment")
      .order("entry_at", { ascending: false }).limit(3),
  ]);

  const latestByType: Record<string, { classification: string | null; observations: unknown }> = {};
  for (const s of scansRes.data ?? []) {
    if (!latestByType[s.scan_type]) latestByType[s.scan_type] = { classification: s.classification, observations: s.observations };
  }
  const conditions = (profileRes.data?.conditions as string[] | null) ?? [];
  const shelf = shelfRes.data ?? [];
  const recentTreatments = (journalRes.data ?? [])
    .map((j) => `${j.entry_at.slice(0, 10)}: ${j.entry_text.slice(0, 120)}`);

  const prompt = `You are a cosmetic-ingredient analysis AI inside a wellness app. The photo shows a skincare or haircare product — read its label, especially the INCI ingredient list if visible.

USER CONTEXT (personalize the verdict to THIS person):
- Skin scan: ${latestByType.skin ? `type "${latestByType.skin.classification}", observations: ${JSON.stringify(latestByType.skin.observations).slice(0, 400)}` : "none yet"}
- Hair scan: ${latestByType.hair ? `classification "${latestByType.hair.classification}"` : "none yet"}
- Flagged conditions: ${conditions.length ? conditions.join(", ") : "none"}
- Current shelf: ${shelf.length ? shelf.map((p) => `${p.name} (${p.product_type ?? "?"}; actives: ${(p.key_actives ?? []).join("/") || "none"}; ${p.usage_time ?? "?"})`).join("; ") : "empty"}
- Recent treatments from their journal: ${recentTreatments.length ? recentTreatments.join(" | ") : "none"}

RULES:
1. Identify the product: name, brand, product_type (one of cleanser|moisturizer|sunscreen|serum|toner|exfoliant|mask|shampoo|conditioner|hair_oil|hair_treatment|other).
2. ingredients: the INCI list as read from the label (empty array if not legible). key_actives: the 1-5 actives that actually matter (e.g. "niacinamide", "salicylic acid", "retinol", "SPF 50").
3. verdict for THIS user: "good_match" | "use_carefully" | "skip", with verdict_reason (2-3 plain sentences referencing THEIR skin type/conditions/observations — not generic ingredient trivia).
4. usage_time: "am" | "pm" | "both". Retinoids and strong exfoliating acids are always pm; SPF is always am.
5. conflicts: warnings against their CURRENT shelf or recent treatments only (e.g. "You already use a salicylic acid cleanser — don't layer this AHA toner the same night", "Avoid for 48h after your laser session"). Empty array if none. Never invent shelf items.
6. pao_months: the period-after-opening number if the open-jar symbol is legible (e.g. 12 for "12M"), else null.
7. NON-DIAGNOSTIC: describe cosmetic suitability only, never medical conditions or treatment claims.
8. If the image is not a skincare/haircare product at all, set not_a_product to true and leave other fields minimal.`;

  const aiRes = await generateWithFallback(
    [{ text: prompt }, { inline_data: { mime_type: mimeType, data: base64 } }],
    {
      type: "OBJECT",
      properties: {
        not_a_product: { type: "BOOLEAN" },
        name: { type: "STRING" },
        brand: { type: "STRING" },
        product_type: { type: "STRING", enum: ["cleanser", "moisturizer", "sunscreen", "serum", "toner", "exfoliant", "mask", "shampoo", "conditioner", "hair_oil", "hair_treatment", "other"] },
        ingredients: { type: "ARRAY", items: { type: "STRING" } },
        key_actives: { type: "ARRAY", items: { type: "STRING" } },
        verdict: { type: "STRING", enum: ["good_match", "use_carefully", "skip"] },
        verdict_reason: { type: "STRING" },
        usage_time: { type: "STRING", enum: ["am", "pm", "both"] },
        conflicts: { type: "ARRAY", items: { type: "STRING" } },
        pao_months: { type: "NUMBER" },
      },
      required: ["not_a_product", "name", "verdict", "verdict_reason"],
    },
    20000 // vision + long label reads run slower than text calls
  );
  if (!aiRes.ok) return NextResponse.json({ error: "AI unavailable, try again" }, { status: 502 });

  let parsed: any;
  try {
    const aiBody = await aiRes.json();
    parsed = JSON.parse(aiBody.candidates[0].content.parts[0].text);
  } catch {
    return NextResponse.json({ error: "couldn't read the label — try a clearer photo" }, { status: 422 });
  }

  // Bump the cap on every successful AI read (even not_a_product — the call happened)
  await dbAdmin.from("ai_suggestions").upsert(
    { user_id: userId, log_date: today, kind: "product_check", content: { count: used + 1 } },
    { onConflict: "user_id,log_date,kind" }
  );

  if (parsed.not_a_product) {
    return NextResponse.json({ error: "That doesn't look like a skincare/haircare product — try again with the label visible" }, { status: 422 });
  }

  const row = {
    user_id: userId,
    name: stripNulls(String(parsed.name || "Unknown product")).slice(0, 120),
    brand: parsed.brand ? stripNulls(String(parsed.brand)).slice(0, 80) : null,
    product_type: parsed.product_type ?? "other",
    ingredients: cleanArr(parsed.ingredients, 80),
    key_actives: cleanArr(parsed.key_actives, 5),
    verdict: parsed.verdict,
    verdict_reason: parsed.verdict_reason ? stripNulls(String(parsed.verdict_reason)) : null,
    usage_time: parsed.usage_time ?? null,
    conflicts: cleanArr(parsed.conflicts, 6),
    pao_months: Number.isFinite(parsed.pao_months) && parsed.pao_months > 0 && parsed.pao_months <= 60
      ? Math.round(parsed.pao_months) : null,
  };

  const { data: product, error: insErr } = await userDb
    .from("wellness_products").insert(row).select("*").single();
  if (insErr) return NextResponse.json({ error: "couldn't save product" }, { status: 500 });

  return NextResponse.json({ product });
}
