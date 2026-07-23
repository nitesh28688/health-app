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
  if (scanType !== "skin" && scanType !== "eye" && scanType !== "hair") {
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

  const capKind = scanType === "skin" ? "skin_scan" : scanType === "eye" ? "eye_scan" : "hair_scan";
  const today = new Date().toISOString().slice(0, 10);

  // 1. Quota Check
  const { data: capRow } = await db.from("ai_suggestions").select("content")
    .eq("user_id", userId).eq("log_date", today).eq("kind", capKind).maybeSingle();
  const used = (capRow?.content as { count?: number } | null)?.count ?? 0;
  if (used >= DAILY_USER_CAP) {
    return NextResponse.json({ error: "daily AI limit reached, try tomorrow" }, { status: 429 });
  }

  // 2. Prepare Prompts
  //
  // Shared calibration rubric — without explicit band anchors the model
  // clusters everything at 70-85 and scores drift wildly between scans of the
  // same face. Sub-scores are scored FIRST and the overall is derived from
  // them, so the two can never contradict each other.
  const RUBRIC = `SCORING CALIBRATION (apply strictly):
- 90-100: exceptional — virtually no visible concerns. Rare; only for genuinely outstanding condition.
- 75-89: good — minor concerns visible only on close inspection.
- 60-74: average — one or two clearly visible concerns; typical of most healthy adults.
- 40-59: below average — multiple clearly visible concerns.
- 0-39: significant concerns dominating the appearance.
Most real-world scans should land between 55 and 85. Use the full width of whichever band the evidence supports — do not cluster at 70-80 by default.
Evaluate the photo step-by-step in the 'analysis_scratchpad' FIRST. Justify every single sub-category score in the scratchpad, then output the sub_scores, then set overall_score to the mean of the sub_scores rounded to the nearest integer. Never pick the overall first.

PHOTO QUALITY & CONFIDENCE:
- photo_quality: grade the photo itself as "good", "fair", or "poor" (focus, lighting, framing, resolution).
- confidence: your confidence in this analysis as "high", "medium", or "low", given photo quality and visibility.
- If photo_quality is "fair" or "poor", score conservatively: avoid extreme scores in either direction (stay within 45-80 unless the evidence is unmistakable) and lower your confidence.
- If the photo is completely unusable, write your reasoning in the scratchpad and set is_usable to false.

TIME OF DAY: every recommendation MUST include time_of_day: "am", "pm", or "both".
- Sunscreen/SPF is always "am". Retinol/retinoids and strong exfoliating acids (AHA/BHA/glycolic/salicylic leave-ons) are always "pm" (they increase sun sensitivity). Vitamin C is typically "am". Cleansers and moisturisers are "both" unless there's a reason otherwise.`;

  let systemPrompt = "";
  if (scanType === "skin") {
    systemPrompt = `You are a professional skincare analysis AI. Analyze the skin condition from the uploaded facial photo.

CRITICAL RULES:
1. STRICTLY NON-DIAGNOSTIC: You must only describe visual characteristics. Never mention medical conditions, syndromes, or diagnoses (e.g., do NOT mention "rosacea", "acne vulgaris", "eczema", "dermatitis", "melasma", "infection"). Instead, use descriptions like "skin appears slightly uneven in tone", "redness visible in cheeks area", "signs of dryness or flaking", "clogged pores or excess shine in T-zone".
2. UNBRANDED ACTIVE INGREDIENTS ONLY: Recommend only generic active ingredients (e.g., "salicylic acid", "AHA", "BHA", "vitamin C", "niacinamide", "hyaluronic acid", "retinol", "peptides"). Do NOT recommend any specific product brands or names.
3. WEIGH CLASSIFICATION: You must classify the user's skin type under "classification" as one of: 'oily', 'dry', 'combination', 'normal', 'sensitive'. This classification MUST directly shape your active ingredient recommendations.
4. GROUNDED SCORING: You must calculate an "overall_score" (0-100) and an array of five "sub_scores" (for categories: "Hydration", "Texture", "Radiance", "Pore Visibility", "Evenness"). Each score MUST be grounded strictly in your observations.
5. UNUSABLE PHOTO CHECK: If the photo is highly blurry, does not contain a human face, is taken at an unreadable angle, or is of a non-human subject, you MUST set "is_usable" to false. If is_usable is false, you must set overall_score to 0, sub_scores to [], classification to null, and recommendations to [].

Observations & recommendations schema:
- analysis_scratchpad: Array of strings. Use this to think step-by-step and justify every score before writing them.
- is_usable: boolean (set to false if photo is not a human face or is completely unreadable).
- overall_score: integer (0-100, where 100 is optimal skin health). Set to 0 if is_usable is false.
- classification: string (one of 'oily', 'dry', 'combination', 'normal', 'sensitive'). Set to null if is_usable is false.
- sub_scores: Array of { category: string, score: integer, note: string } for: "Hydration", "Texture", "Radiance", "Pore Visibility", "Evenness".
- observations: Array of { area: string, note: string }. You MUST provide a highly detailed, "full spectrum" analysis of every facial zone (T-zone, cheeks, under-eyes, forehead, chin) covering texture, hydration, pores, elasticity, and tone.
- recommendations: Array of { ingredient: string, why: string, how_to_use: string, time_of_day: "am"|"pm"|"both" }. You MUST provide a comprehensive, multi-step skincare routine (e.g., Cleanser, Exfoliant like AHA/BHA, Treatment like Retinol/Vitamin C, Moisturizer, Sunscreen). Detail exactly how to incorporate them into an AM/PM regimen. Set to empty array [] if is_usable is false.
- skin_age_estimate: integer. Based on your holistic assessment of texture, fine lines, hydration, pore size, and radiance, estimate the visible skin age (e.g. 24, 31, 38). This should reflect the apparent skin condition, not the person's calendar age. Set to null if is_usable is false.

${RUBRIC}`;
  } else if (scanType === "eye") {
    systemPrompt = `You are a professional eye region appearance analysis AI. Analyze the eye region from the uploaded photo.

CRITICAL RULES:
1. STRICTLY NON-DIAGNOSTIC: Describe only visual appearance traits (e.g. puffiness, dark circles, hydration). Never mention medical conditions or eye diseases.
2. UNBRANDED ACTIVE INGREDIENTS ONLY: Recommend generic actives suitable for the eye area (e.g., "caffeine", "hyaluronic acid", "peptides", "retinol for eye area", "niacinamide", "vitamin C"). Do NOT recommend product brands.
3. GROUNDED SCORING: You must calculate an "overall_score" (0-100) and an array of four "sub_scores" (for categories: "Dark Circles", "Puffiness", "Hydration", "Fine Lines"). Each score MUST be grounded strictly in your observations.
4. NO CLASSIFICATION: Since classification is not applicable for eyes, you MUST set "classification" to null.
5. UNUSABLE PHOTO CHECK: If the photo doesn't clearly contain human eyes, is taken at an unreadable angle, or is of a non-human subject, you MUST set "is_usable" to false. If is_usable is false, you must set overall_score to 0, sub_scores to [], classification to null, and recommendations to [].

Observations & recommendations schema:
- analysis_scratchpad: Array of strings. Use this to think step-by-step and justify every score before writing them.
- is_usable: boolean (set to false if photo does not contain a clear eye area).
- overall_score: integer (0-100). Set to 0 if is_usable is false.
- classification: string (always null/absent).
- sub_scores: Array of { category: string, score: integer, note: string } for: "Dark Circles", "Puffiness", "Hydration", "Fine Lines".
- observations: Array of { area: string, note: string }. You MUST provide a highly detailed, "full spectrum" analysis of the eye region (under-eye, eyelids, outer corners/crow's feet) covering texture, hydration, lines, and pigmentation.
- recommendations: Array of { ingredient: string, why: string, how_to_use: string, time_of_day: "am"|"pm"|"both" }. You MUST provide a comprehensive eye care routine detailing exactly what active ingredients to use and how to incorporate them into an AM/PM regimen safely. Set to empty array [] if is_usable is false.

${RUBRIC}`;
  } else {
    systemPrompt = `You are a professional hair and scalp analysis AI. Analyze the hair and scalp condition from the uploaded photo.

CRITICAL RULES:
1. STRICTLY NON-DIAGNOSTIC: Describe only visual traits (e.g., dryness, frizz, thickness, flaking). Never mention medical conditions or scalp diseases.
2. UNBRANDED ACTIVE INGREDIENTS ONLY: Recommend generic hair and scalp actives (e.g., "argan oil", "keratin", "biotin", "tea tree oil", "salicylic acid for scalp", "AHA for scalp", "coconut oil", "peptides"). Do NOT recommend product brands.
3. WEIGH CLASSIFICATION: You must classify the user's hair type under "classification" as one of: 'straight', 'wavy', 'curly', 'coily'. This classification MUST directly shape your active ingredient recommendations.
4. GROUNDED SCORING: You must calculate an "overall_score" (0-100) and an array of four "sub_scores" (for categories: "Scalp Health", "Hair Thickness/Density", "Dryness/Damage", "Frizz"). Each score MUST be grounded strictly in your observations.
5. UNUSABLE PHOTO CHECK: If the photo doesn't clearly contain human hair or scalp, is taken at an unreadable angle, or is of a non-human subject, you MUST set "is_usable" to false. If is_usable is false, you must set overall_score to 0, sub_scores to [], classification to null, and recommendations to [].

Observations & recommendations schema:
- analysis_scratchpad: Array of strings. Use this to think step-by-step and justify every score before writing them.
- is_usable: boolean (set to false if photo does not contain clear hair or scalp).
- overall_score: integer (0-100). Set to 0 if is_usable is false.
- classification: string (one of 'straight', 'wavy', 'curly', 'coily'). Set to null if is_usable is false.
- sub_scores: Array of { category: string, score: integer, note: string } for: "Scalp Health", "Hair Thickness/Density", "Dryness/Damage", "Frizz".
- observations: Array of { area: string, note: string }. You MUST provide a highly detailed, "full spectrum" analysis of the hair and scalp (roots, mid-lengths, ends, scalp condition) covering texture, hydration, density, and damage.
- recommendations: Array of { ingredient: string, why: string, how_to_use: string, time_of_day: "am"|"pm"|"both" }. You MUST provide a comprehensive hair care routine (e.g., clarifying treatments, deep conditioning, leave-in actives, scalp serums) detailing exactly how and when to use them. Set to empty array [] if is_usable is false.

${RUBRIC}`;
  }

  const schema = {
    type: "OBJECT",
    properties: {
      analysis_scratchpad: {
        type: "ARRAY",
        items: { type: "STRING" }
      },
      is_usable: { type: "BOOLEAN" },
      overall_score: { type: "INTEGER" },
      classification: { type: "STRING", nullable: true },
      sub_scores: {
        type: "ARRAY",
        items: {
          type: "OBJECT",
          properties: {
            category: { type: "STRING" },
            score: { type: "INTEGER" },
            note: { type: "STRING" }
          },
          required: ["category", "score", "note"]
        }
      },
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
            how_to_use: { type: "STRING" },
            time_of_day: { type: "STRING", enum: ["am", "pm", "both"] }
          },
          required: ["ingredient", "why", "how_to_use", "time_of_day"]
        }
      },
      skin_age_estimate: { type: "INTEGER", nullable: true },
      photo_quality: { type: "STRING", enum: ["good", "fair", "poor"] },
      confidence: { type: "STRING", enum: ["high", "medium", "low"] }
    },
    required: ["analysis_scratchpad", "is_usable", "overall_score", "sub_scores", "observations", "recommendations", "photo_quality", "confidence"]
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
  const scanRecord: Record<string, unknown> = {
    user_id: userId,
    scan_type: scanType,
    taken_at: today,
    photo_url: photoUrl,
    is_usable: estimate.is_usable,
    observations: estimate.observations,
    recommendations: estimate.recommendations,
    overall_score: estimate.overall_score ?? null,
    sub_scores: estimate.sub_scores ?? null,
    classification: estimate.classification ?? null,
    skin_age_estimate: estimate.skin_age_estimate ?? null,
    photo_quality: estimate.photo_quality ?? null,
    ai_confidence: estimate.confidence ?? null
  };

  let { data: insertedScan, error: insertErr } = await db
    .from("wellness_scans")
    .insert(scanRecord)
    .select("id")
    .single();

  // A deployment can be a migration behind and lack one of the optional
  // presentation columns (this exact gap ran silently for days with
  // skin_age_estimate). Strip whichever column PostgREST names and retry, so
  // the actual scan/report is preserved while the schema catches up.
  for (const optionalCol of ["skin_age_estimate", "photo_quality", "ai_confidence"]) {
    if (insertErr?.code === "PGRST204" && insertErr.message.includes(optionalCol)) {
      delete scanRecord[optionalCol];
      const retry = await db.from("wellness_scans").insert(scanRecord).select("id").single();
      insertedScan = retry.data;
      insertErr = retry.error;
    }
  }

  if (insertErr) {
    console.error("Failed to insert wellness scan:", insertErr);
    return NextResponse.json({ error: "We couldn't save this scan. Please try again in a moment." }, { status: 500 });
  }

  const newScanId = insertedScan?.id;

  // 5. Query prior scan of same scan_type to compute trend/delta. Must exclude
  // unusable scans (bad photo, wrong subject) — otherwise a failed first
  // attempt (score forced to 0) becomes the comparison baseline, producing a
  // huge fake "improvement" the moment the user takes a real photo. Found via
  // a live test showing previous_score: 0 on what should've been a genuine
  // first scan — the prior scan was actually an earlier unusable dog photo.
  let trend = null;
  if (newScanId) {
    const { data: priorScan } = await db.from("wellness_scans")
      .select("overall_score, taken_at")
      .eq("user_id", userId)
      .eq("scan_type", scanType)
      .eq("is_usable", true)
      .neq("id", newScanId)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (priorScan && priorScan.overall_score != null && estimate.overall_score != null) {
      trend = {
        previous_score: priorScan.overall_score,
        score_delta: estimate.overall_score - priorScan.overall_score,
        previous_scan_date: priorScan.taken_at
      };
    }
  }

  // 6. Update daily cap, checking the database error
  const { error: upsertErr } = await db.from("ai_suggestions").upsert(
    { user_id: userId, log_date: today, kind: capKind, content: { count: used + 1 } },
    { onConflict: "user_id,log_date,kind" }
  );

  if (upsertErr) {
    console.error("Failed to update daily cap suggestion:", upsertErr);
    return NextResponse.json({ error: "Database error updating daily cap" }, { status: 500 });
  }

  const backendModel = (res as any).selectedModel || "unknown";
  return NextResponse.json({
    result: estimate,
    trend,
    backend_model: backendModel,
    photo_url: photoUrl
  });
}
