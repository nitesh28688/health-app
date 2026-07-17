import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { generateWithFallback, searchGrounded } from "@/lib/gemini";
import { normalizeProductKey } from "@/lib/productKey";

const SOURCE_RANK: Record<string, number> = { general_knowledge: 1, grounded: 2, scan: 3 };

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

  const { imageDataUrl, productName, ingredientsText } = await req.json();
  const hasImage = typeof imageDataUrl === "string" && imageDataUrl.startsWith("data:image/");
  const hasTyped = typeof productName === "string" && productName.trim().length > 0;
  if (!hasImage && !hasTyped) {
    return NextResponse.json({ error: "provide a photo or a product name" }, { status: 400 });
  }
  let mimeType = "", base64 = "";
  if (hasImage) {
    const match = imageDataUrl.match(/^data:(image\/\w+);base64,(.+)$/) ?? [];
    [, mimeType, base64] = match;
    if (!base64) return NextResponse.json({ error: "bad image payload structure" }, { status: 400 });
  }

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

  // For a typed product with no ingredients supplied, check the shared
  // cross-user ingredient cache before spending a grounding call — a popular
  // product that's already been analyzed (by this user or anyone else)
  // shouldn't re-pay the web-search round trip every time.
  let cachedEntry: { name: string; brand: string | null; product_type: string | null; ingredients: string[]; key_actives: string[]; pao_months: number | null; source: string } | null = null;
  let groundedFacts: string | null = null;
  const typedHasIngredients = !!(ingredientsText && String(ingredientsText).trim());
  if (hasTyped && !typedHasIngredients) {
    const key = normalizeProductKey(String(productName));
    const { data: cacheHit } = await dbAdmin.from("product_ingredient_cache")
      .select("name, brand, product_type, ingredients, key_actives, pao_months, source")
      .eq("name_key", key).maybeSingle();
    if (cacheHit && cacheHit.ingredients?.length) {
      cachedEntry = cacheHit;
    } else {
      // For a typed product with no ingredients supplied, try a web-search-grounded
      // lookup (mainstream brands often have their INCI list published on the
      // brand site, Sephora/Nykaa/INCIDecoder etc.) rather than relying solely on
      // the model's training-data memory, which misses smaller/newer/niche brands.
      groundedFacts = await searchGrounded(
        `Search the web for the real ingredient list (INCI) of the cosmetic/haircare product "${stripNulls(String(productName)).slice(0, 150)}". ` +
        `Reply with the brand, product type, and the full INCI ingredient list if you can find it from a real source (brand website, retailer listing, INCIDecoder, etc.), citing what you found. ` +
        `If you cannot find reliable ingredient data for this exact product, say so plainly instead of guessing.`
      );
    }
  }

  const inputDescription = hasImage
    ? `The photo shows a skincare or haircare product — read its label, especially the INCI ingredient list if visible. Also read the printed volume/weight (e.g. "250 ml", "50 g") if visible.`
    : `The user couldn't scan the product (label unreadable/no camera) and typed it in instead:
Product name: "${stripNulls(String(productName)).slice(0, 150)}"
${typedHasIngredients
      ? `Ingredients they typed from the label: "${stripNulls(String(ingredientsText)).slice(0, 1500)}"`
      : cachedEntry
        ? `Already-known ingredient data from a previous verified check of this exact product: brand "${cachedEntry.brand ?? "?"}", product_type "${cachedEntry.product_type ?? "?"}", ingredients: ${cachedEntry.ingredients.join(", ")}. Use this directly as the ingredient list — no need to re-search.`
        : groundedFacts
          ? `Web search results for this product: "${groundedFacts.slice(0, 2000)}"\nUse this search result if it actually names real ingredients for this product. If the search result itself says it couldn't find reliable data, say so plainly in verdict_reason rather than inventing a specific ingredient list.`
          : "They did not provide an ingredient list and a web search found nothing reliable — use your general knowledge of this specific product only if you confidently recognize it. If you don't, say so plainly in verdict_reason (e.g. \"I don't have reliable ingredient data for this exact product — here's general guidance for a product of this type\") rather than inventing a specific ingredient list."}`;

  const prompt = `You are a cosmetic-ingredient analysis AI inside a wellness app. ${inputDescription}

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
4. usage_time: ONLY applies to skincare product_types (cleanser/moisturizer/sunscreen/serum/toner/exfoliant/mask) — "am" | "pm" | "both" there, with retinoids/strong exfoliating acids always pm and SPF always am. For haircare product_types (shampoo/conditioner/hair_oil/hair_treatment) and "other", AM/PM is not a meaningful concept (haircare is used every wash, not on a daily routine) — set usage_time to null, do not force it to "both".
5. conflicts: warnings against their CURRENT shelf or recent treatments only (e.g. "You already use a salicylic acid cleanser — don't layer this AHA toner the same night", "Avoid for 48h after your laser session"). Empty array if none. Never invent shelf items.
6. pao_months: the period-after-opening number if the open-jar symbol is legible (e.g. 12 for "12M"), else null.
7. NON-DIAGNOSTIC: describe cosmetic suitability only, never medical conditions or treatment claims.
8. ${hasImage ? "If the image is not a skincare/haircare product at all, set not_a_product to true and leave other fields minimal." : "not_a_product should be false unless the typed name is obviously not a skincare/haircare product."}
9. ${hasImage ? "size_value/size_unit: the printed volume/weight if legible (e.g. 250 + \"ml\", 50 + \"g\"), else null. Never guess a size that isn't actually printed on the label." : "size_value/size_unit: always null — there's no label to read for a typed entry."}`;

  const parts: object[] = [{ text: prompt }];
  if (hasImage) parts.push({ inline_data: { mime_type: mimeType, data: base64 } });

  const aiRes = await generateWithFallback(
    parts,
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
        size_value: { type: "NUMBER" },
        size_unit: { type: "STRING", enum: ["ml", "g", "oz"] },
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
    return NextResponse.json({ error: hasImage ? "That doesn't look like a skincare/haircare product — try again with the label visible" : "That doesn't look like a skincare/haircare product name" }, { status: 422 });
  }

  // Preview only — nothing is saved yet. The client shows this with an
  // "Add to my kit" action that does the actual insert, so scanning to
  // check something you're deciding whether to buy (or a duplicate/mis-scan)
  // doesn't silently clutter the shelf.
  const preview = {
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
    size_value: Number.isFinite(parsed.size_value) && parsed.size_value > 0 ? parsed.size_value : null,
    size_unit: ["ml", "g", "oz"].includes(parsed.size_unit) ? parsed.size_unit : null,
  };

  // Best-effort cache write-back — never fails the main request. A photo
  // label-read or user-typed real ingredients ("scan") outranks a grounded
  // web search, which outranks the model's own unverified memory — so a
  // low-confidence guess can never clobber a previously verified entry.
  if (preview.ingredients.length > 0) {
    const source = hasImage || typedHasIngredients ? "scan" : cachedEntry ? cachedEntry.source : groundedFacts ? "grounded" : "general_knowledge";
    const newRank = SOURCE_RANK[source];
    try {
      const key = normalizeProductKey(preview.name, preview.brand);
      const { data: existing } = await dbAdmin.from("product_ingredient_cache")
        .select("id, source, hit_count").eq("name_key", key).maybeSingle();
      if (!existing) {
        await dbAdmin.from("product_ingredient_cache").insert({
          name_key: key, name: preview.name, brand: preview.brand, product_type: preview.product_type,
          ingredients: preview.ingredients, key_actives: preview.key_actives, pao_months: preview.pao_months, source,
        });
      } else if (newRank >= SOURCE_RANK[existing.source]) {
        await dbAdmin.from("product_ingredient_cache").update({
          name: preview.name, brand: preview.brand, product_type: preview.product_type,
          ingredients: preview.ingredients, key_actives: preview.key_actives, pao_months: preview.pao_months, source,
          hit_count: existing.hit_count + 1, updated_at: new Date().toISOString(),
        }).eq("id", existing.id);
      } else {
        await dbAdmin.from("product_ingredient_cache").update({
          hit_count: existing.hit_count + 1, updated_at: new Date().toISOString(),
        }).eq("id", existing.id);
      }
    } catch {
      // Cache is a pure optimization — a write failure here must never affect the response.
    }
  }

  return NextResponse.json({ product: preview });
}
