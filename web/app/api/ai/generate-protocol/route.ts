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

  const { goal } = await req.json();
  if (!goal || typeof goal !== "string") {
    return NextResponse.json({ error: "Goal is required" }, { status: 400 });
  }

  const db = admin();
  const { data: userData } = await db.auth.getUser(jwt);
  if (!userData.user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const userId = userData.user.id;

  const { data: scans } = await db.from("wellness_scans").select("*")
    .eq("user_id", userId).order("taken_at", { ascending: false }).limit(3);

  const scanSummary = (scans || []).map(s => 
    `${s.scan_type}: ${s.classification || s.features?.join(", ")}`
  ).join("\n");

  const prompt = `
The user wants to generate a custom aesthetic wellness protocol to solve this problem/goal: "${goal}".
Here are their recent scan insights for context:
${scanSummary || "No scans."}

Generate a structured daily protocol (typically 14, 21, or 30 days) to help them achieve this goal.
Include a compelling title, a description explaining why this protocol will work, the duration in days, and a daily checklist of tasks.
Keep tasks concise and actionable (e.g., "Apply Vitamin C serum", "Drink 3L of water"). Assign each task a time of day ("am", "pm", or "any").

Return a JSON object:
- title: string
- description: string
- duration_days: number
- tasks: array of objects { name: string, time: "am" | "pm" | "any" }
`;

  try {
    const res = await generateWithFallback(
      [{ text: prompt }],
      {
        type: "object",
        properties: {
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
        required: ["title", "description", "duration_days", "tasks"]
      }
    );
    if (!res.ok) throw new Error("AI failed");
    const body = await res.json();
    const text = body?.candidates?.[0]?.content?.parts?.[0]?.text || "null";

    let protocol = null;
    try {
      protocol = JSON.parse(text);
    } catch {
      throw new Error("Failed to parse AI output");
    }

    return NextResponse.json({ protocol });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
