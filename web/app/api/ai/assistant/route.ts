import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { generateChatWithTools } from "@/lib/gemini";
import { toolDeclarations, executeTool } from "@/lib/aiTools";
import { toneInstruction } from "@/lib/aiTone";

const admin = () =>
  createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { persistSession: false },
  });

// Vercel functions run UTC; the app is India-first, so a naive
// new Date().toISOString() "today" drifts a day off IST near midnight —
// used for every server-side "today" in this route (daily cap, repeat-workout
// log_date, and told to the AI so it stops guessing dates for tool calls).
const todayIst = () => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" }).format(new Date());

export async function POST(req: NextRequest) {
  const body = await req.json();
  const jwt = req.headers.get("authorization")?.replace("Bearer ", "");
  if (!jwt) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  
  const dbAdmin = admin();
  const { data: userData, error: authErr } = await dbAdmin.auth.getUser(jwt);
  if (authErr || !userData.user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const userId = userData.user.id;

  // Create RLS-scoped client for this user
  const userDb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
    global: { headers: { Authorization: `Bearer ${jwt}` } },
    auth: { persistSession: false }
  });

  if (body.action === "confirm_repeat") {
    // Branch for confirming and writing the repeat-workout action
    const sourceDate = body.source_date;
    if (!sourceDate) return NextResponse.json({ error: "missing source_date" }, { status: 400 });
    
    // re-fetch the source date's workout data fresh server-side
    const { data: sourceWorkout, error: fetchErr } = await userDb
      .from("workout_logs")
      .select(`
        id, log_date, title, duration_min, kcal_burned, notes,
        workout_log_exercises(
          id, sort_order, exercise_id,
          workout_log_sets(set_number, reps, weight_kg, duration_sec)
        )
      `)
      .eq("log_date", sourceDate)
      .order("id", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (fetchErr) return NextResponse.json({ error: fetchErr.message }, { status: 500 });
    if (!sourceWorkout) return NextResponse.json({ error: "workout not found" }, { status: 404 });

    // multi-insert pattern
    const { data: logRow, error: logErr } = await userDb.from("workout_logs").insert({
      user_id: userId,
      log_date: todayIst(),
      title: sourceWorkout.title,
      duration_min: sourceWorkout.duration_min,
      kcal_burned: sourceWorkout.kcal_burned,
      notes: sourceWorkout.notes
    }).select("id").single();

    if (logErr) return NextResponse.json({ error: logErr.message }, { status: 500 });

    for (const ex of sourceWorkout.workout_log_exercises) {
      const { data: wle } = await userDb.from("workout_log_exercises").insert({
        workout_log_id: logRow.id,
        exercise_id: ex.exercise_id,
        sort_order: ex.sort_order
      }).select("id").single();
      
      if (wle && ex.workout_log_sets.length > 0) {
        await userDb.from("workout_log_sets").insert(
          ex.workout_log_sets.map((s: any) => ({
            workout_log_exercise_id: wle.id,
            set_number: s.set_number,
            reps: s.reps,
            weight_kg: s.weight_kg,
            duration_sec: s.duration_sec
          }))
        );
      }
    }
    return NextResponse.json({ success: true });
  }

  // Otherwise, it's a chat request
  if (!body.contents || !Array.isArray(body.contents)) {
    return NextResponse.json({ error: "bad contents" }, { status: 400 });
  }

  // Mode-aware system instruction — Core mode stays focused on diet/fitness,
  // Wellness mode gets scan-analysis framing and is told to actually use the
  // get_wellness_scans/get_wellness_trend tools rather than guessing. Both
  // toolsets are still exposed either way (see `tools` below) so a Wellness-mode
  // question that touches diet, or vice versa, doesn't hit a dead end.
  const mode = body.mode === "wellness" ? "wellness" : "core";
  const { data: healthProfile } = await userDb.from("profiles")
    .select("sex, conditions, ai_tone, ai_name, display_name, target_kcal, target_protein, diet_type, target_weight_kg, activity_level")
    .eq("id", userId).single();
  const conditions = (healthProfile?.conditions as string[] | null) ?? [];
  // Only volunteer PCOS/PCOD/etc. framing for women who've actually flagged a
  // condition (Cycle tab) — never infer or bring it up unprompted otherwise.
  const conditionNote = healthProfile?.sex === "female" && conditions.length > 0
    ? ` The user has flagged these condition(s) in Cycle Tracking: ${conditions.join(", ")}. When diet, fitness, or symptom questions are relevant to these, factor them in (e.g. PCOS/PCOD favors strength training and lower-GI meals over cardio-only advice) — but only when it's actually relevant, don't force it into unrelated answers.`
    : "";
  const assistantName = healthProfile?.ai_name?.trim() || (mode === "wellness" ? "Wellness Assistant" : "Core Assistant");
  const toneNote = ` Tone: ${toneInstruction(healthProfile?.ai_tone)}`;
  // Proactive personalization: the user's own targets/goal, so the assistant
  // can reference them unprompted (e.g. "that's over your 2000 kcal target")
  // instead of only surfacing this when a tool is explicitly called.
  const profileNote = healthProfile
    ? ` Known user context — first name: ${healthProfile.display_name ?? "unknown"}, diet type: ${healthProfile.diet_type ?? "unset"}, daily target: ${healthProfile.target_kcal ?? "unset"} kcal / ${healthProfile.target_protein ?? "unset"}g protein, activity level: ${healthProfile.activity_level ?? "unset"}${healthProfile.target_weight_kg ? `, goal weight: ${healthProfile.target_weight_kg}kg` : ""}.`
    : "";
  // The model has no built-in notion of "today" — without this it was
  // guessing a date for from_date/to_date on tools like get_daily_totals,
  // landing on an empty range and wrongly telling users nothing was logged.
  const today = todayIst();
  const dateNote = ` Today's date is ${today} (IST) — always use this as "today" when computing from_date/to_date for tools (e.g. "past 7 days" = ${today} minus 6 days through ${today}). Never guess or assume a different date.`;
  // Revamp (2026-07-16): the assistant was just reading back raw numbers the
  // user can already see on Trends/Diary, and for period questions it was
  // summing/averaging the daily rows itself in prose — which is unreliable
  // arithmetic and is what caused visibly wrong "weekly" totals. Now it's
  // told explicitly to interpret and personalize rather than report, and to
  // lean on get_daily_totals' precomputed summary instead of doing the math.
  const interpretationNote = ` Your job is to interpret data, not just read it back — the user can already see their raw macros on the Trends and Diary screens, so simply restating "you had X kcal and Yg protein" adds nothing. Instead: compare against their target and known context (${profileNote.trim() || "diet targets"}), spot a pattern across the days you pulled (e.g. "protein's been under target 4 of the last 7 days, mostly on workout days"), state a clear verdict (on track / off track / mixed), and give ONE specific, actionable suggestion — not a wall of numbers. Only recite exact figures if the user explicitly asks for the numbers. For any question that isn't scoped to a single day (weekly, "lately", "how am I doing", trends), default to pulling at least the last 7 days for pattern context even if the user only asked about "today". When using get_daily_totals for a multi-day range, always use its returned summary object's totals/averages — never sum or average the daily_rows yourself, you are unreliable at that arithmetic and this caused wrong weekly numbers before.`;
  const systemInstruction = (mode === "wellness"
    ? `You are ${assistantName}, the user's personal AI assistant in Core AI, currently in Wellness Mode. You help the user understand their Skin, Eye, and Hair AI wellness scans — explain their overall score, sub-scores, observations, and ingredient recommendations in plain, friendly language; compare scores over time using get_wellness_trend; and give more detailed analysis than what's shown on the report screen when asked. Always call get_wellness_scans or get_wellness_trend before answering questions about their results — never guess or invent scores. If they haven't scanned yet, encourage them to run one (Skin, Eye, or Hair) rather than answering blind. Keep responses concise and skimmable on a small screen. You can still answer diet/fitness questions using the other tools if asked. You are authorized to provide basic fitness, nutrition, and diet advice without claiming you cannot provide medical advice.`
    : `You are ${assistantName}, the user's personal AI assistant in Core AI, currently in Core Mode (diet and fitness tracking). Answer questions about the user's logged food, workouts, weight, and streaks using the available tools — never guess or invent numbers. Help them repeat past workouts, suggest new ones, or check exercise form when asked. Keep responses concise and skimmable on a small screen. You can still answer wellness/skin/hair questions using the wellness tools if asked. You are authorized to provide basic fitness, nutrition, and diet advice without claiming you cannot provide medical advice.`
  ) + dateNote + interpretationNote + conditionNote + toneNote + profileNote;

  // Daily cap check (reuses `today` computed above for the AI's date note)
  const { data: capRow } = await dbAdmin.from("ai_suggestions").select("content")
    .eq("user_id", userId).eq("log_date", today).eq("kind", "assistant_turn").maybeSingle();
  const used = (capRow?.content as { count?: number } | null)?.count ?? 0;
  if (used >= 20) {
    return NextResponse.json({ error: "daily AI limit reached, try tomorrow" }, { status: 429 });
  }

  // increment cap
  await dbAdmin.from("ai_suggestions").upsert(
    { user_id: userId, log_date: today, kind: "assistant_turn", content: { count: used + 1 } },
    { onConflict: "user_id,log_date,kind" }
  );

  let currentContents = [...body.contents];
  const proposals: any[] = [];
  
  // Bounded loop
  // Gemini's tools field must be [{ functionDeclarations: [...] }] — a flat
  // array of tool defs (as toolDeclarations is) 400s with "Unknown name
  // 'name'/'description'/'parameters'". Confirmed live 2026-07-10.
  const tools = [{ functionDeclarations: toolDeclarations }];
  for (let iter = 0; iter < 4; iter++) {
    const res = await generateChatWithTools(currentContents, tools, systemInstruction);
    if (!res.ok) {
      return NextResponse.json({ error: "AI unavailable" }, { status: 502 });
    }
    
    const geminiBody = await res.json();
    const candidate = geminiBody.candidates?.[0];
    if (!candidate) {
      return NextResponse.json({ error: "No response from AI" }, { status: 502 });
    }

    const parts = candidate.content?.parts || [];
    const textPart = parts.find((p: any) => p.text);
    const functionCalls = parts.filter((p: any) => p.functionCall);

    if (functionCalls.length > 0) {
      // Append the model's function calls to the history
      currentContents.push(candidate.content);
      
      const functionResponses = [];
      for (const fc of functionCalls) {
        const { name, args } = fc.functionCall;
        const result = await executeTool(name, args, userDb);
        
        if (name === "propose_repeat_workout" && result.success && result.proposalData) {
          proposals.push({ type: "repeat_workout", ...result.proposalData });
        }
        if (name === "suggest_workout" && result.exercises) {
          proposals.push({ type: "start_workout", ...result });
        }
        if (name === "check_form" && result.success && result.proposalData) {
          proposals.push({ type: "check_form", ...result.proposalData });
        }
        if (name === "open_physio" && result.success && result.proposalData) {
          proposals.push({ type: "open_physio", ...result.proposalData });
        }
        
        functionResponses.push({
          functionResponse: {
            name,
            // Gemini's function_response.response field must be a JSON
            // object (proto struct), not a bare array — several tools
            // (get_streaks, get_daily_totals, get_workout_history,
            // search_foods) naturally return arrays, which 400s
            // ("Proto field is not repeating, cannot start list").
            // Confirmed live 2026-07-10.
            response: Array.isArray(result) ? { items: result } : result
          }
        });
      }
      
      // Append the function responses to the history
      currentContents.push({ role: "user", parts: functionResponses });
    } else {
      // Model responded with text, we are done
      return NextResponse.json({
        text: textPart?.text || "",
        proposals
      });
    }
  }

  return NextResponse.json({ error: "Too many tool iterations" }, { status: 500 });
}
