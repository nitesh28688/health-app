// Generates a home physio/rehab routine for a stated body-area complaint.
// Two modes: "initial" (new program — body_area + complaint + optional photo/
// video) and "followup" (existing program — server pulls the real session
// history itself, never trusts client-supplied pain/difficulty numbers, so a
// tampered request can't game the adaptive difficulty).
//
// Client-side red-flag screening (sudden severe pain, numbness, recent trauma,
// swelling+fever) happens BEFORE this route is ever called — if the user
// flags any of those, the UI stops and tells them to see a doctor instead of
// calling this endpoint at all. This route additionally instructs the model
// to bail with a safety_note if the complaint text itself reads as something
// beyond home exercise, as a second line of defense.
import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { generateWithFallback } from "@/lib/gemini";

const DAILY_USER_CAP = 5; // matches form-check's cap — video-capable route
const BODY_AREAS = ["knee", "shoulder", "back", "neck", "hip", "ankle", "wrist"] as const;

const admin = () =>
  createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { persistSession: false },
  });

const SCHEMA = {
  type: "OBJECT",
  properties: {
    safety_note: { type: "STRING" }, // set if the model believes this needs an in-person professional instead
    rationale: { type: "STRING" },
    exercises: {
      type: "ARRAY",
      items: {
        type: "OBJECT",
        properties: {
          library_id: { type: "INTEGER" }, // set when picked from the provided library list, omitted for AI-generated fallback
          name: { type: "STRING" },
          instructions: { type: "STRING" },
          sets: { type: "INTEGER" },
          reps: { type: "STRING" },
          hold_sec: { type: "INTEGER" },
          source: { type: "STRING", enum: ["library", "ai"] },
        },
        required: ["name", "instructions", "source"],
      },
    },
  },
  required: ["exercises", "rationale"],
};

export async function POST(req: NextRequest) {
  try {
    return await handlePost(req);
  } catch (e) {
    // Catch-all so an unexpected exception (e.g. a malformed upstream
    // response) never leaks a raw JS error message to the client — every
    // other AI route in this app is narrow enough not to need this, but
    // this one has more branching, so a blanket safety net earns its keep.
    console.error("[physio-plan] unhandled error:", e);
    return NextResponse.json({ error: "something went wrong — try again" }, { status: 500 });
  }
}

async function handlePost(req: NextRequest) {
  const jwt = req.headers.get("authorization")?.replace("Bearer ", "");
  if (!jwt) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const body = await req.json().catch(() => ({}));
  const db = admin();
  const { data: userData } = await db.auth.getUser(jwt);
  if (!userData.user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const userId = userData.user.id;

  const today = new Date().toISOString().slice(0, 10);
  const { data: capRow } = await db.from("ai_suggestions").select("content")
    .eq("user_id", userId).eq("log_date", today).eq("kind", "physio_plan").maybeSingle();
  const used = (capRow?.content as { count?: number } | null)?.count ?? 0;
  if (used >= DAILY_USER_CAP) {
    return NextResponse.json({ error: "daily AI limit reached, try tomorrow" }, { status: 429 });
  }

  let bodyArea: string;
  let complaint: string;
  // For initial mode the program row is only inserted AFTER the AI returns a
  // usable routine — creating it up front left an orphaned zero-session
  // program behind whenever the AI bailed (safety_note, invalid data, 502),
  // which then showed in the user's list as a dead "Continue session" entry.
  let programId: number | null = null;
  let sessionNumber: number;
  let historyPrompt = "";

  if (body.mode === "followup") {
    const { data: program } = await db.from("physio_programs")
      .select("id,user_id,body_area,complaint,status").eq("id", body.program_id).maybeSingle();
    if (!program || program.user_id !== userId) return NextResponse.json({ error: "not found" }, { status: 404 });
    if (program.status !== "active") return NextResponse.json({ error: "program is resolved" }, { status: 400 });

    const { data: sessions } = await db.from("physio_program_sessions")
      .select("session_number,pain_before,pain_after,difficulty,completed_at")
      .eq("program_id", program.id).order("session_number", { ascending: false }).limit(5);
    const completed = (sessions ?? []).filter((s) => s.completed_at);
    if (completed.length === 0) {
      return NextResponse.json({ error: "no completed session yet to adapt from" }, { status: 400 });
    }
    sessionNumber = Math.max(...(sessions ?? []).map((s) => s.session_number)) + 1;
    bodyArea = program.body_area;
    complaint = program.complaint;
    programId = program.id;
    historyPrompt = `This is a FOLLOW-UP session (number ${sessionNumber}) for an existing program. ` +
      `Recent session history (most recent first): ${JSON.stringify(completed.map((s) => ({
        session: s.session_number, pain_before: s.pain_before, pain_after: s.pain_after, difficulty: s.difficulty,
      })))}. Adjust intensity based on this trend: if pain is stable/improving and difficulty was "too_easy" or "right", ` +
      `progress slightly (more reps/sets/hold time, or a modestly harder variant). If pain is worsening or difficulty was ` +
      `"too_hard", ease off — reduce volume or swap to a gentler exercise for the same area. Never introduce a dramatic jump.`;
  } else {
    bodyArea = String(body.body_area ?? "");
    complaint = String(body.complaint ?? "").slice(0, 500);
    if (!BODY_AREAS.includes(bodyArea as any)) return NextResponse.json({ error: "bad body_area" }, { status: 400 });
    if (!complaint.trim()) return NextResponse.json({ error: "describe the issue" }, { status: 400 });
    sessionNumber = 1;
  }

  const { data: library } = await db.from("physio_exercises")
    .select("id,name,instructions,default_sets,default_reps,hold_sec,contraindication_notes")
    .eq("body_area", bodyArea).limit(20);

  const prompt = `You are a physiotherapy assistant building a SAFE, conservative home exercise routine for a "${bodyArea}" complaint: "${complaint}".

${historyPrompt}

Prefer picking 3-5 exercises from this curated library (set library_id and source:"library", copy its instructions/sets/reps/hold_sec, adjust only if progressing/easing per the history above):
${JSON.stringify(library ?? [])}

Only if the library genuinely has nothing suitable for this specific complaint, you may add ONE original bodyweight-only exercise with source:"ai" — keep it conservative, no equipment, no high-impact or advanced moves, and write clear step-by-step instructions.

If the complaint text describes something beyond a home exercise routine (e.g. mentions a fracture, suspected tear, RECENT surgery (within the last ~6 months), severe/sudden onset, numbness, or anything requiring in-person diagnosis), do NOT generate exercises — instead set safety_note to a short message telling the user to see a doctor or licensed physiotherapist, and return an empty exercises array. A surgery years in the past with mild residual symptoms is NOT a reason to refuse — that is a normal home-physio case.

Otherwise return 3-5 exercises, a short one-sentence rationale, and leave safety_note empty.`;

  const parts: object[] = [{ text: prompt }];
  if (typeof body.photoDataUrl === "string" && body.photoDataUrl.startsWith("data:image/")) {
    const [, mimeType, base64] = body.photoDataUrl.match(/^data:(image\/\w+);base64,(.+)$/) ?? [];
    if (base64) parts.push({ inline_data: { mime_type: mimeType, data: base64 } });
  } else if (typeof body.videoDataUrl === "string" && body.videoDataUrl.startsWith("data:video/")) {
    const [, mimeType, base64] = body.videoDataUrl.match(/^data:(video\/\w+);base64,(.+)$/) ?? [];
    if (base64) parts.push({ inline_data: { mime_type: mimeType, data: base64 } });
  }

  const hasVideo = parts.length > 1 && (parts[1] as any).inline_data?.mime_type?.startsWith("video/");
  const res = await generateWithFallback(parts, SCHEMA, hasVideo ? 25000 : undefined);
  if (!res.ok) {
    return NextResponse.json({ error: "AI unavailable — try again shortly" }, { status: 502 });
  }
  const resBody = await res.json();
  let plan: { safety_note?: string; rationale: string; exercises: any[] };
  try { plan = JSON.parse(resBody.candidates[0].content.parts[0].text); }
  catch { return NextResponse.json({ error: "AI returned invalid data" }, { status: 502 }); }

  await db.from("ai_suggestions").upsert(
    { user_id: userId, log_date: today, kind: "physio_plan", content: { count: used + 1 } },
    { onConflict: "user_id,log_date,kind" });

  if (plan.safety_note && plan.safety_note.trim()) {
    return NextResponse.json({ safety_note: plan.safety_note });
  }
  if (!Array.isArray(plan.exercises) || plan.exercises.length === 0) {
    return NextResponse.json({ error: "AI couldn't generate a routine — try rephrasing" }, { status: 502 });
  }

  const isNewProgram = programId === null;
  if (isNewProgram) {
    const { data: program, error } = await db.from("physio_programs")
      .insert({ user_id: userId, body_area: bodyArea, complaint }).select("id").single();
    if (error || !program) return NextResponse.json({ error: "couldn't create program" }, { status: 500 });
    programId = program.id;
  }

  const painBefore = Number.isInteger(body.pain_before) && body.pain_before >= 0 && body.pain_before <= 10
    ? body.pain_before : null;
  const { data: session, error: sessErr } = await db.from("physio_program_sessions").insert({
    program_id: programId, session_number: sessionNumber, exercises: plan.exercises, pain_before: painBefore,
  }).select("id,session_number,exercises").single();
  if (sessErr || !session) {
    // Don't leave a zero-session program behind if the session write failed.
    if (isNewProgram) await db.from("physio_programs").delete().eq("id", programId!);
    return NextResponse.json({ error: "couldn't save session" }, { status: 500 });
  }

  await db.from("physio_programs").update({ last_session_at: new Date().toISOString() }).eq("id", programId);

  return NextResponse.json({
    program_id: programId, session_id: session.id, session_number: session.session_number,
    exercises: session.exercises, rationale: plan.rationale,
  });
}
