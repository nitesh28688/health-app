import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { searchGrounded } from "@/lib/gemini";

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

  try {
    const { brand, name } = await req.json();

    if (!brand || !name) {
      return NextResponse.json({ error: "Missing brand or name" }, { status: 400 });
    }

    const prompt = `Search online for the product "${brand} ${name}".
Find it across multiple major retailers.
Determine the current best price and the exact URL to buy it at that price.
Return ONLY a valid JSON object in this exact format, with no markdown formatting:
{
  "bestPrice": "$XX.XX",
  "retailer": "Retailer Name",
  "url": "https://..."
}`;

    const text = await searchGrounded(prompt);
    
    if (!text) {
      return NextResponse.json({ error: "Could not find product online." }, { status: 404 });
    }

    // Attempt to parse JSON from the grounded text. The model might wrap it in ```json ... ```
    const jsonStr = text.replace(/```json/g, '').replace(/```/g, '').trim();
    const result = JSON.parse(jsonStr);

    return NextResponse.json(result);
  } catch (err: any) {
    console.error("[find-online] Error:", err);
    return NextResponse.json({ error: "Failed to find product." }, { status: 500 });
  }
}
