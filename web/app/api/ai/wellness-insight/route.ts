import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { generateWithFallback } from "@/lib/gemini";

const admin = () =>
  createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { persistSession: false },
  });

const DAILY_USER_CAP = 5;

interface CachedInsight {
  text: string;
  calls_today: number;
  total_scans: number;
  skin_score: number | null;
  eye_score: number | null;
  hair_score: number | null;
}

export async function POST(req: NextRequest) {
  const jwt = req.headers.get("authorization")?.replace("Bearer ", "");
  if (!jwt) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const db = admin();
  const { data: userData, error: authErr } = await db.auth.getUser(jwt);
  if (authErr || !userData.user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const userId = userData.user.id;

  const today = new Date().toISOString().slice(0, 10);

  // 1. Fetch current wellness state
  const { data: scans } = await db.from("wellness_scans").select("*").eq("user_id", userId);
  
  const activeScans = (scans ?? []).filter((s: any) => s.is_usable && s.overall_score != null);
  
  const latestScores: Record<string, number | null> = { skin: null, eye: null, hair: null };
  const sortedScans = [...activeScans].sort((a, b) => new Date(b.taken_at).getTime() - new Date(a.taken_at).getTime());
  
  for (const s of sortedScans) {
    if (latestScores[s.scan_type] === null) {
      latestScores[s.scan_type] = s.overall_score;
    }
  }

  const currentMonthScansCount = scans
    ? scans.filter((s: any) => {
        const scanDate = new Date(s.taken_at + "T12:00:00");
        const t = new Date();
        return scanDate.getFullYear() === t.getFullYear() && scanDate.getMonth() === t.getMonth();
      }).length
    : 0;

  // 2. Fetch today's cached insight (if any)
  const { data: existing } = await db.from("ai_suggestions")
    .select("content")
    .eq("user_id", userId)
    .eq("log_date", today)
    .eq("kind", "wellness_insight")
    .maybeSingle();

  const cached = existing?.content as CachedInsight | undefined;
  
  const stateUnchanged =
    cached &&
    cached.total_scans === currentMonthScansCount &&
    cached.skin_score === latestScores.skin &&
    cached.eye_score === latestScores.eye &&
    cached.hair_score === latestScores.hair;

  if (stateUnchanged && cached?.text) {
    return NextResponse.json({ insight: cached.text });
  }

  const callsToday = cached?.calls_today ?? 0;
  
  // 3. Apply daily regeneration cap
  if (callsToday >= DAILY_USER_CAP) {
    if (cached?.text) return NextResponse.json({ insight: cached.text });
    return NextResponse.json({ error: "daily AI limit reached" }, { status: 429 });
  }

  // 4. Generate new insight
  let prompt = `You are "Core Insights", an AI health coach with real personality — witty, a little cheeky, and deeply reactive to this specific person's wellness journey. Never generic.
User's Wellness Data:
Total scans this month: ${currentMonthScansCount}.`;

  if (activeScans.length === 0) {
    prompt += `\nThey have never completed a successful wellness scan. Give a 2-sentence motivating, playful nudge encouraging them to run their first Skin, Eye, or Hair scan right below. No hashtags, no markdown, no medical language.`;
  } else {
    prompt += `\nLatest scores (out of 100): Skin: ${latestScores.skin ?? 'Not scanned'}, Eye: ${latestScores.eye ?? 'Not scanned'}, Hair: ${latestScores.hair ?? 'Not scanned'}.
Give a 2-sentence reactive message about their wellness journey, taking their specific scores into account. 
If they have a high score, hype them up. 
If they're missing a scan type (e.g. they did Skin but not Hair), playfully nudge them to try the missing one. 
If they've done a lot of scans this month, acknowledge their consistency. 
Never use diagnostic or medical language (no 'diagnosis', 'treatment', 'disease', etc).
Keep it punchy, funny, and engaging. No hashtags, no markdown, no generic filler like "keep up the good work".`;
  }

  const aiRes = await generateWithFallback([{ text: prompt }]);
  if (!aiRes.ok) {
    if (cached?.text) return NextResponse.json({ insight: cached.text });
    return NextResponse.json({ error: "AI unavailable" }, { status: 503 });
  }

  const aiBody = await aiRes.json();
  const text = aiBody.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!text) {
    if (cached?.text) return NextResponse.json({ insight: cached.text });
    return NextResponse.json({ error: "bad AI response" }, { status: 500 });
  }

  const insight = text.trim();

  // 5. Store the new insight with state snapshot
  await db.from("ai_suggestions").upsert({
    user_id: userId,
    log_date: today,
    kind: "wellness_insight",
    content: { 
      text: insight, 
      calls_today: callsToday + 1,
      total_scans: currentMonthScansCount,
      skin_score: latestScores.skin,
      eye_score: latestScores.eye,
      hair_score: latestScores.hair
    } satisfies CachedInsight,
  }, { onConflict: "user_id,log_date,kind" });

  return NextResponse.json({ insight });
}
