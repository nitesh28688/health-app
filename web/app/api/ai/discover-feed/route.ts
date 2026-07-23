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

  const { data: scans } = await db.from("wellness_scans").select("*")
    .eq("user_id", userId).order("taken_at", { ascending: false }).limit(5);

  const scanSummary = (scans || []).map(s => 
    `${s.scan_type} scan: ${s.classification || s.features?.join(", ")}`
  ).join("\n");

  const prompt = `
Generate a beautiful, personalized aesthetic discovery feed for this user based on their recent wellness scans.
If they have no recent scans, provide general premium aesthetic content.

User's Recent Scans:
${scanSummary || "None."}

The feed should contain an array of items. Each item can be either an 'article', 'tip', or a 'protocol'.
- 'article': A bite-sized insight (e.g. "Ingredient Spotlight: Peptides for barrier repair").
- 'tip': A highly actionable short tip based on their scan.
- 'protocol': A suggested routine (e.g., "14-Day Glass Skin Bootcamp") that they can enroll in. It MUST contain 'duration_days' and a 'tasks' array (each task having 'name' and 'time'='am'|'pm'|'any').

Generate 3-5 items for the feed, mixing the types. Make the tone sophisticated, empathetic, and premium.

Return a JSON array of objects.
Each object MUST have:
- type: "article" | "tip" | "protocol"
- title: string
- description: string
If type === "protocol", ALSO include:
- duration_days: integer
- tasks: array of objects { name: string, time: "am" | "pm" | "any" }
`;

  try {
    const aiResponse = await generateWithFallback(
      prompt,
      "gemini-1.5-flash", 
      "You are a premium lifestyle and aesthetic editor.",
      {
        type: "array",
        items: {
          type: "object",
          properties: {
            type: { type: "string" },
            title: { type: "string" },
            description: { type: "string" },
            duration_days: { type: "number" },
            tasks: { 
              type: "array", 
              items: { 
                type: "object", 
                properties: { 
                  name: { type: "string" }, 
                  time: { type: "string" } 
                },
                required: ["name", "time"]
              } 
            }
          },
          required: ["type", "title", "description"]
        }
      }
    );

    let feed = [];
    try {
      feed = JSON.parse(aiResponse);
    } catch {
      feed = [];
    }

    return NextResponse.json({ feed });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
