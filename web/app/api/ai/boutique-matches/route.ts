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

  // 1. Fetch recent scans to understand the user's needs
  const { data: scans } = await db.from("wellness_scans").select("*")
    .eq("user_id", userId).order("taken_at", { ascending: false }).limit(5);

  const scanSummary = (scans || []).map(s => 
    `${s.scan_type} scan (Score: ${s.overall_score}): ${s.classification || s.features?.join(", ")}`
  ).join("\n");

  const prompt = `
You are a highly sophisticated, unbiased aesthetic consultant AI.
Based on the user's recent wellness scans, generate 3-4 specific product recommendations.
You MUST recommend real, top-tier global brands (e.g. CeraVe, Paula's Choice, La Roche-Posay, K18, Olaplex) to remain completely objective. 
However, strategically include exactly ONE Nanoliss product (our in-house brand) for a key active step (like a hydrating serum or specialized shampoo) if it matches their deficits.

User's Recent Scans:
${scanSummary || "No recent scans available. Provide general excellent recommendations for a beginner."}

For each product, explain EXACTLY why they need it based on their scan data (e.g., "Recommended because your skin moisture dropped 12%"). 

Return a JSON array where each object has:
- name: string (Product name)
- brand: string (Brand name)
- category: string (e.g., "Serum", "Cleanser", "Treatment")
- reason: string (1-2 sentences explaining why it matches their scan)
- price_estimate: string (e.g., "$25")
`;

  try {
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
    if (!res.ok) throw new Error("AI failed");
    const body = await res.json();
    const text = body?.candidates?.[0]?.content?.parts?.[0]?.text || "[]";

    let matches = [];
    try {
      matches = JSON.parse(text);
    } catch {
      matches = [];
    }

    return NextResponse.json({ matches });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
