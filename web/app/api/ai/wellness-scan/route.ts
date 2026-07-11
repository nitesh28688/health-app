import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { generateWithFallback } from "@/lib/gemini";

const DAILY_USER_CAP = 10;

const admin = () =>
  createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { persistSession: false },
  });

export async function POST(req: NextRequest) {
  const jwt = req.headers.get("authorization")?.replace("Bearer ", "");
  if (!jwt) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const { imageDataUrl, scanType, photoUrl } = await req.json();
  if (typeof imageDataUrl !== "string" || !imageDataUrl.startsWith("data:image/")) {
    return NextResponse.json({ error: "bad image payload" }, { status: 400 });
  }
  if (scanType !== "skin" && scanType !== "eye") {
    return NextResponse.json({ error: "bad scan type" }, { status: 400 });
  }
  if (typeof photoUrl !== "string" || !photoUrl.startsWith("http")) {
    return NextResponse.json({ error: "bad photo url" }, { status: 400 });
  }

  const match = imageDataUrl.match(/^data:(image\/\w+);base64,(.+)$/) ?? [];
  const [, mimeType, base64] = match;
  if (!base64) {
    return NextResponse.json({ error: "bad image payload structure" }, { status: 400 });
  }

  const db = admin();
  const { data: userData } = await db.auth.getUser(jwt);
  if (!userData.user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const userId = userData.user.id;

  const capKind = scanType === "skin" ? "skin_scan" : "eye_scan";
  const today = new Date().toISOString().slice(0, 10);

  // 1. Quota Check
  const { data: capRow } = await db.from("ai_suggestions").select("content")
    .eq("user_id", userId).eq("log_date", today).eq("kind", capKind).maybeSingle();
  const used = (capRow?.content as { count?: number } | null)?.count ?? 0;
  if (used >= DAILY_USER_CAP) {
    return NextResponse.json({ error: "daily AI limit reached, try tomorrow" }, { status: 429 });
  }

  // 2. Prepare Prompts
  let systemPrompt = "";
  if (scanType === "skin") {
    systemPrompt = `You are a professional skincare analysis AI. Analyze the skin condition from the uploaded facial photo.

CRITICAL RULES:
1. STRICTLY NON-DIAGNOSTIC: You must only describe visual characteristics. Never mention medical conditions, syndromes, or diagnoses (e.g., do NOT mention "rosacea", "acne vulgaris", "eczema", "dermatitis", "melasma", "infection"). Instead, use descriptions like "skin appears slightly uneven in tone", "redness visible in cheeks area", "signs of dryness or flaking", "clogged pores or excess shine in T-zone".
2. UNBRANDED ACTIVE INGREDIENTS ONLY: Recommend only generic active ingredients (e.g., "salicylic acid", "vitamin C", "niacinamide", "hyaluronic acid", "retinol"). Do NOT recommend any specific product brands or names.
3. UNUSABLE PHOTO CHECK: If the photo is highly blurry, does not contain a human face, is taken at an unreadable angle, or is of a non-human subject (like a toy, pet, food, or rabbit), you MUST set "is_usable" to false.

Observations & recommendations schema:
- is_usable: boolean (set to false if photo is not a human face or is completely unreadable).
- observations: Array of { area: string, note: string } describing areas analyzed and notes (descriptive only).
- recommendations: Array of { ingredient: string, why: string, how_to_use: string } for generic active ingredients. Set to empty array [] if is_usable is false.`;
  } else {
    systemPrompt = `You are a professional eye region appearance analysis AI. Analyze the eye region from the uploaded photo.

CRITICAL RULES:
1. STRICTLY NON-DIAGNOSTIC: Describe only visual appearance traits (e.g. puffiness, dark circles, hydration). Never mention medical conditions or eye diseases (e.g., do NOT mention "conjunctivitis", "jaundice", "anemia", "cataracts", "allergy", "infection"). Instead, use terms like "visible shadow/darkness under eyes", "appearance of minor swelling or puffiness", "dryness/fine lines in the outer eye area".
2. UNBRANDED ACTIVE INGREDIENTS ONLY: Recommend generic actives suitable for the eye area (e.g., "caffeine", "hyaluronic acid", "peptides", "retinol for eye area", "niacinamide"). Do NOT recommend product brands.
3. UNUSABLE PHOTO CHECK: If the photo doesn't clearly contain human eyes, is taken at an unreadable angle, or is of a non-human subject (like a toy, animal, or rabbit), you MUST set "is_usable" to false.

Observations & recommendations schema:
- is_usable: boolean (set to false if photo does not contain a clear eye area).
- observations: Array of { area: string, note: string } describing areas analyzed (descriptive only).
- recommendations: Array of { ingredient: string, why: string, how_to_use: string } for eye area active ingredients. Set to empty array [] if is_usable is false.`;
  }

  const schema = {
    type: "OBJECT",
    properties: {
      is_usable: { type: "BOOLEAN" },
      observations: {
        type: "ARRAY",
        items: {
          type: "OBJECT",
          properties: {
            area: { type: "STRING" },
            note: { type: "STRING" }
          },
          required: ["area", "note"]
        }
      },
      recommendations: {
        type: "ARRAY",
        items: {
          type: "OBJECT",
          properties: {
            ingredient: { type: "STRING" },
            why: { type: "STRING" },
            how_to_use: { type: "STRING" }
          },
          required: ["ingredient", "why", "how_to_use"]
        }
      }
    },
    required: ["is_usable", "observations", "recommendations"]
  };

  // 3. Call generateWithFallback with 20 seconds timeout
  const res = await generateWithFallback(
    [
      { text: systemPrompt },
      { inline_data: { mime_type: mimeType, data: base64 } }
    ],
    schema,
    20000
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

  // 4. Save scan to Database
  const { error: insertErr } = await db.from("wellness_scans").insert({
    user_id: userId,
    scan_type: scanType,
    taken_at: today,
    photo_url: photoUrl,
    is_usable: estimate.is_usable,
    observations: estimate.observations,
    recommendations: estimate.recommendations
  });

  if (insertErr) {
    console.error("Failed to insert wellness scan:", insertErr);
    return NextResponse.json({ error: "Failed to persist scan results in database" }, { status: 500 });
  }

  // 5. Update daily cap, checking the database error
  const { error: upsertErr } = await db.from("ai_suggestions").upsert(
    { user_id: userId, log_date: today, kind: capKind, content: { count: used + 1 } },
    { onConflict: "user_id,log_date,kind" }
  );

  if (upsertErr) {
    console.error("Failed to update daily cap suggestion:", upsertErr);
    return NextResponse.json({ error: "Database error updating daily cap" }, { status: 500 });
  }

  const backendModel = (res as any).selectedModel || "unknown";
  return NextResponse.json({ result: estimate, backend_model: backendModel, photo_url: photoUrl });
}
