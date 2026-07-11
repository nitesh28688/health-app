import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { generateWithFallback } from "@/lib/gemini";

const DAILY_USER_CAP = 5;

const admin = () =>
  createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { persistSession: false },
  });

export async function POST(req: NextRequest) {
  const jwt = req.headers.get("authorization")?.replace("Bearer ", "");
  if (!jwt) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const { videoDataUrl } = await req.json();
  if (typeof videoDataUrl !== "string" || !videoDataUrl.startsWith("data:video/")) {
    return NextResponse.json({ error: "bad video payload" }, { status: 400 });
  }

  const [, mimeType, base64] = videoDataUrl.match(/^data:(video\/\w+);base64,(.+)$/) ?? [];
  if (!base64 || (mimeType !== "video/webm" && mimeType !== "video/mp4")) {
    return NextResponse.json({ error: "bad video payload or unsupported mime type" }, { status: 400 });
  }

  const db = admin();
  const { data: userData } = await db.auth.getUser(jwt);
  if (!userData.user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const userId = userData.user.id;

  const today = new Date().toISOString().slice(0, 10);
  const { data: capRow } = await db.from("ai_suggestions").select("content")
    .eq("user_id", userId).eq("log_date", today).eq("kind", "form_check").maybeSingle();
  const used = (capRow?.content as { count?: number } | null)?.count ?? 0;
  if (used >= DAILY_USER_CAP) {
    return NextResponse.json({ error: "daily AI limit reached, try tomorrow" }, { status: 429 });
  }

  const prompt = `You are an exercise form coach analyzing a short video clip of someone performing a workout exercise.

1. Identify the exercise being performed, if determinable from the video. If you cannot confidently identify it, set exercise_guess to "Unable to determine from this angle/clip".

2. Provide 2-4 concrete observations about the person's form. Be specific — describe what you can actually see in the clip:
   - "good" observations: things being done correctly (e.g., "Neutral spine maintained throughout")
   - "issue" observations: risks or form breakdowns (e.g., "Knees caving inward on the descent")

3. Be conservative. If the clip is too short, the angle is poor, lighting is insufficient, or the movement is unclear — say so explicitly as an observation (type: "issue", note: "Clip too short / angle unclear to assess form details"). Do NOT guess or fabricate observations you cannot see.

Return only JSON matching the schema.`;

  const schema = {
    type: "OBJECT",
    properties: {
      exercise_guess: { type: "STRING" },
      observations: {
        type: "ARRAY",
        items: {
          type: "OBJECT",
          properties: {
            type: { type: "STRING", enum: ["good", "issue"] },
            note: { type: "STRING" }
          },
          required: ["type", "note"]
        }
      }
    },
    required: ["exercise_guess", "observations"]
  };

  // Call generateWithFallback with a bumped timeout of 25 seconds (25000ms) for video processing
  const res = await generateWithFallback(
    [
      { text: prompt },
      { inline_data: { mime_type: mimeType, data: base64 } }
    ],
    schema,
    25000
  );

  if (!res.ok) {
    return NextResponse.json({ error: "AI unavailable — Google's models are under heavy load, try again shortly" }, { status: 502 });
  }

  const body = await res.json();
  let estimate;
  try {
    estimate = JSON.parse(body.candidates[0].content.parts[0].text);
  } catch {
    return NextResponse.json({ error: "AI returned invalid data structure" }, { status: 502 });
  }

  await db.from("ai_suggestions").upsert(
    { user_id: userId, log_date: today, kind: "form_check", content: { count: used + 1 } },
    { onConflict: "user_id,log_date,kind" }
  );

  // Return the selected model name in JSON for script verification, which is not read by FormCheckSheet
  const backendModel = (res as any).selectedModel || "unknown";
  return NextResponse.json({ result: estimate, backend_model: backendModel });
}
