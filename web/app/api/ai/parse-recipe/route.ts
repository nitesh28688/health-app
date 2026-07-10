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
  
  const { text } = await req.json();
  if (!text || typeof text !== "string") {
    return NextResponse.json({ error: "bad request" }, { status: 400 });
  }

  const db = admin();
  const { data: userData, error: authErr } = await db.auth.getUser(jwt);
  if (authErr || !userData.user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const prompt = `Parse this recipe into individual ingredients and estimate their raw weights in grams. 
Recipe text: "${text}"

Return a strict JSON object with:
- name (string, optional): The name of the recipe, if one can be inferred (e.g. "Mom's Rajma").
- servings (number, optional): The number of servings this recipe yields, if specified.
- ingredients (array of objects):
  - name (string): Clean, standardized name of the ingredient (e.g., "boiled rajma" instead of "2 cups boiled rajma").
  - qty_g (number): Estimated raw weight in grams (e.g. 1 cup boiled rajma ≈ 170g, 1 tbsp oil ≈ 14g, 1 medium onion ≈ 110g). Make realistic estimates.`;

  const res = await generateWithFallback([{ text: prompt }], {
    type: "OBJECT",
    properties: {
      name: { type: "STRING" },
      servings: { type: "NUMBER" },
      ingredients: {
        type: "ARRAY",
        items: {
          type: "OBJECT",
          properties: {
            name: { type: "STRING" },
            qty_g: { type: "NUMBER" },
          },
          required: ["name", "qty_g"],
        },
      },
    },
    required: ["ingredients"],
  });

  if (!res.ok) return NextResponse.json({ error: "AI unavailable" }, { status: 502 });
  const body = await res.json();
  let parsed;
  try {
    parsed = JSON.parse(body.candidates[0].content.parts[0].text);
  } catch {
    return NextResponse.json({ error: "AI returned invalid data" }, { status: 502 });
  }

  // Auto-match ingredients against the database
  const mappedIngredients = [];
  for (const item of parsed.ingredients || []) {
    if (!item.name) continue;
    const { data } = await db.rpc("search_foods", { q: item.name });
    if (data && data.length > 0) {
      mappedIngredients.push({
        food: data[0],
        qty: String(item.qty_g || 100),
      });
    }
  }

  return NextResponse.json({
    name: parsed.name,
    servings: parsed.servings,
    ingredients: mappedIngredients
  });
}
