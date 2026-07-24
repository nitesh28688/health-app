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

  try {
    const { data: cacheRow } = await db
      .from("wellness_discover_feed_cache")
      .select("boutique_matches, items")
      .eq("user_id", userId)
      .maybeSingle();

    const matches = cacheRow?.boutique_matches || [];

    // Fast path: Cache hit (0 credits)
    if (matches.length > 0) {
      // Check if it's the old format (missing premium_pick)
      const isOldFormat = matches[0] && !matches[0].premium_pick;
      if (!isOldFormat) {
        return NextResponse.json({ matches });
      }
    }

    // Slow path: Lazy Backfill (Cost: 1 API call ONE TIME per legacy user)
    // If cache is empty, check if they even have a scan.
    const { data: scans } = await db.from("wellness_scans").select("*")
      .eq("user_id", userId).eq("is_usable", true).order("taken_at", { ascending: false }).limit(3);

    // If no scans at all, return empty array (UI will tell them to go scan)
    if (!scans || scans.length === 0) {
      return NextResponse.json({ matches: [] });
    }

    // They have scans but no cached matches! Let's generate them once and cache them.
    const scanSummary = scans.map(s => 
      `${s.scan_type} scan (Score: ${s.overall_score}): ${s.classification || 'unknown'} skin/hair. Observations: ${JSON.stringify(s.observations)}`
    ).join("\n");

    const timeZone = req.headers.get("x-timezone") || "America/New_York";

    const prompt = `
You are a highly sophisticated, unbiased aesthetic consultant AI.
Based on the user's recent wellness scans, suggest 3-4 routine categories (e.g. Cleanser, Vitamin C Serum, Spot Treatment) they should add to their shelf to fix their specific issues.
For each category, provide two product recommendations from real, top-tier global brands:
1. A "Premium Pick" (luxury or clinical brand like Skinceuticals, K18, La Mer).
2. An "Accessible Pick" (a highly effective, affordable alternative or 'dupe' like CeraVe, The Ordinary, Good Molecules).

CRITICAL: Both the Premium Pick and Accessible Pick MUST be the EXACT TYPE of product described in the category. For example, if the category is 'Hair Growth Serum', do NOT recommend a shampoo or a conditioner. Both picks MUST be actual Hair Growth Serums.

User's Recent Scans:
${scanSummary}

Return a JSON array where each object has:
- category: string (e.g., "Vitamin C Serum", "Exfoliant")
- reason: string (1-2 sentences explaining EXACTLY why they need this category based on specific observations from their scan report, e.g. "Since your scan detected slight dehydration and prominent dark circles...")
- premium_pick: object with 'brand', 'name', and 'price_estimate'
- accessible_pick: object with 'brand', 'name', and 'price_estimate'

For ALL price_estimates, estimate the typical retail price specifically for the region corresponding to the timezone: ${timeZone}. Account for regional retail pricing and import markups. Format it in the local currency for that region (e.g., ₹ for India, $ for US).
`;

    const res = await generateWithFallback(
      [{ text: prompt }],
      {
        type: "array",
        items: {
          type: "object",
          properties: {
            category: { type: "string" },
            reason: { type: "string" },
            premium_pick: {
              type: "object",
              properties: { brand: { type: "string" }, name: { type: "string" }, price_estimate: { type: "string" } },
              required: ["brand", "name", "price_estimate"]
            },
            accessible_pick: {
              type: "object",
              properties: { brand: { type: "string" }, name: { type: "string" }, price_estimate: { type: "string" } },
              required: ["brand", "name", "price_estimate"]
            }
          },
          required: ["category", "reason", "premium_pick", "accessible_pick"]
        }
      }
    );
    
    if (!res.ok) throw new Error("AI failed during backfill");
    const body = await res.json();
    const text = body?.candidates?.[0]?.content?.parts?.[0]?.text || "[]";

    let generatedMatches = [];
    try {
      generatedMatches = JSON.parse(text);
    } catch {
      generatedMatches = [];
    }

    // Cache the result so it's 0-credits next time!
    if (generatedMatches.length > 0) {
      await db.from("wellness_discover_feed_cache").upsert(
        { 
          user_id: userId, 
          boutique_matches: generatedMatches,
          items: cacheRow?.items || [],
          updated_at: new Date().toISOString() 
        },
        { onConflict: "user_id" }
      );
    }

    return NextResponse.json({ matches: generatedMatches });
  } catch (err: any) {
    console.error("Boutique Matches Error:", err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

