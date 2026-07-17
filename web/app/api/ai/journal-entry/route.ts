import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { generateWithFallback, generateEmbedding } from "@/lib/gemini";
import { toneInstruction } from "@/lib/aiTone";

const admin = () =>
  createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { persistSession: false },
  });

// AI comments are capped, journal WRITES are not — an entry always saves even
// past the cap or with the AI down; it just goes in without a comment.
const DAILY_COMMENT_CAP = 20;

const todayIst = () => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" }).format(new Date());

// NUL bytes in text 500 postgres jsonb/text writes (see the physio launch
// incident in HANDOFF) — scrub both user input and AI output.
const stripNulls = (s: string) => s.split(String.fromCharCode(0)).join("");

export async function POST(req: NextRequest) {
  const body = await req.json();
  const jwt = req.headers.get("authorization")?.replace("Bearer ", "");
  if (!jwt) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const dbAdmin = admin();
  const { data: userData, error: authErr } = await dbAdmin.auth.getUser(jwt);
  if (authErr || !userData.user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const userId = userData.user.id;

  const entryText = stripNulls(String(body.entry_text ?? "")).trim();
  if (!entryText) return NextResponse.json({ error: "empty entry" }, { status: 400 });
  if (entryText.length > 2000) return NextResponse.json({ error: "entry too long (max 2000 chars)" }, { status: 400 });

  const userDb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
    global: { headers: { Authorization: `Bearer ${jwt}` } },
    auth: { persistSession: false },
  });

  // 1. Save the entry first — the AI comment is best-effort garnish; a Gemini
  // outage must never lose a journal entry.
  const { data: entry, error: insErr } = await userDb
    .from("wellness_journal")
    .insert({ user_id: userId, entry_text: entryText, ...(body.entry_at ? { entry_at: body.entry_at } : {}) })
    .select("id, entry_text, entry_at")
    .single();
  if (insErr || !entry) return NextResponse.json({ error: "couldn't save entry" }, { status: 500 });

  // 1b. Embedding for semantic recall (search_journal_hybrid) — generated
  // unconditionally, independent of the AI-comment daily cap below, so
  // search quality doesn't degrade once a heavy user hits that cap. Cheap
  // non-generative call; best-effort (generateEmbedding returns null on
  // failure rather than throwing).
  const embeddingPromise = generateEmbedding(entryText);

  // 2. Cap check for the AI comment only
  const today = todayIst();
  const { data: capRow } = await dbAdmin.from("ai_suggestions").select("content")
    .eq("user_id", userId).eq("log_date", today).eq("kind", "journal_comment").maybeSingle();
  const used = (capRow?.content as { count?: number } | null)?.count ?? 0;
  if (used >= DAILY_COMMENT_CAP) {
    const embedding = await embeddingPromise;
    if (embedding) await userDb.from("wellness_journal").update({ embedding }).eq("id", entry.id);
    return NextResponse.json({ entry, ai_comment: null, category: null, tags: [] });
  }

  // 3. One Gemini call: extract category/tags for indexing + a tone-matched
  // companion comment. Tone comes from the same setting as the assistant.
  const { data: profile } = await userDb.from("profiles")
    .select("ai_tone, ai_name_wellness, sex, conditions").eq("id", userId).single();
  const assistantName = profile?.ai_name_wellness?.trim() || "Wellness Assistant";

  const prompt = `You are ${assistantName}, a wellness companion inside the Core AI app. The user just wrote this dated journal entry about themselves (a treatment, skincare/hair event, habit, mood, or health note):

"${entryText}"

Return strict JSON:
- category: one of treatment | skincare | hair | mood | habit | health | other
- tags: 1-4 short lowercase search tags (e.g. ["laser", "hair removal"]) — think "what words would they search for later to find this entry"
- comment: your short companion response (2-3 sentences max). ${toneInstruction(profile?.ai_tone)} React to what they actually wrote: practical aftercare/next-step advice if it's a treatment (e.g. laser → skip actives 48h, moisturize, SPF), honest feedback if it's a habit (good or bad), warmth if it's a mood entry. Never medical diagnosis. No markdown, no hashtags.
- is_usable: true unless this entry has essentially no real content to act on (a single stray word, gibberish, a test entry like "test" or "asdf") — the vast majority of entries should be true, only mark false for genuinely empty/noise entries.`;

  let category: string | null = null;
  let tags: string[] = [];
  let aiComment: string | null = null;
  let isUsable = true;

  const aiRes = await generateWithFallback([{ text: prompt }], {
    type: "OBJECT",
    properties: {
      category: { type: "STRING", enum: ["treatment", "skincare", "hair", "mood", "habit", "health", "other"] },
      tags: { type: "ARRAY", items: { type: "STRING" } },
      comment: { type: "STRING" },
      is_usable: { type: "BOOLEAN" },
    },
    required: ["category", "tags", "comment"],
  });

  if (aiRes.ok) {
    try {
      const aiBody = await aiRes.json();
      const parsed = JSON.parse(aiBody.candidates[0].content.parts[0].text);
      category = parsed.category ?? null;
      tags = Array.isArray(parsed.tags) ? parsed.tags.slice(0, 4).map((t: unknown) => stripNulls(String(t)).toLowerCase()) : [];
      aiComment = parsed.comment ? stripNulls(String(parsed.comment)) : null;
      isUsable = parsed.is_usable !== false;
    } catch {
      // Bad AI JSON — entry stays saved without enrichment, that's fine.
    }
  }

  // 4. Enrich the saved row (embedding + category/tags/comment/usability) + bump the cap
  const embedding = await embeddingPromise;
  await userDb.from("wellness_journal")
    .update({ category, tags, ai_comment: aiComment, is_usable: isUsable, ...(embedding ? { embedding } : {}) })
    .eq("id", entry.id);
  if (category || tags.length > 0 || aiComment) {
    await dbAdmin.from("ai_suggestions").upsert(
      { user_id: userId, log_date: today, kind: "journal_comment", content: { count: used + 1 } },
      { onConflict: "user_id,log_date,kind" }
    );
  }

  return NextResponse.json({ entry: { ...entry, category, tags, ai_comment: aiComment }, ai_comment: aiComment, category, tags });
}
