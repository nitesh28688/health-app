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
      return NextResponse.json({ matches });
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

    const country = req.headers.get("x-vercel-ip-country") || req.headers.get("cf-ipcountry") || "US";

    const prompt = `
You are a highly sophisticated, unbiased aesthetic consultant AI.
Based on the user's recent wellness scans, generate 3-4 specific product recommendations.
You MUST recommend real, top-tier global brands (e.g. CeraVe, Paula's Choice, La Roche-Posay, K18, Olaplex).

User's Recent Scans:
${scanSummary}

For each product, explain EXACTLY why they need it based on their scan data. 

Return a JSON array where each object has:
- name: string (Product name)
- brand: string (Brand name)
- category: string (e.g., "Serum", "Cleanser", "Treatment")
- reason: string (1-2 sentences explaining why it matches their scan)
- price_estimate: string (Format the price estimate in the local currency for the country code ${country}. E.g. for IN use INR (₹), for AE use AED, for US use USD ($), for GB use GBP (£).)
`;

    const res = await generateWithFallback(
      [{ text: prompt }],
      {
        type: "array",
        items: {
          type: "object",
          properties: {
            name: { type: "string" },
            brand: { type: "string" },
            category: { type: "string" },
            reason: { type: "string" },
            price_estimate: { type: "string" }
          },
          required: ["name", "brand", "category", "reason", "price_estimate"]
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

