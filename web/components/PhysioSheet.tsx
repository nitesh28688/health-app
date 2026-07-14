"use client";
import { useEffect, useRef, useState } from "react";
import { supabase } from "@/lib/supabase";
import { compressImage } from "@/lib/imageCompress";
import { SetTimer } from "./SetTimer";
import {
  X, Loader2, Bot, Camera, Video, CheckCircle2, Circle, AlertTriangle, Stethoscope,
} from "lucide-react";

const BODY_AREAS = ["knee", "shoulder", "back", "neck", "hip", "ankle", "wrist"] as const;
type BodyArea = (typeof BODY_AREAS)[number];

interface PhysioExercise {
  library_id?: number;
  name: string;
  instructions: string;
  sets?: number;
  reps?: string;
  hold_sec?: number;
  source: "library" | "ai";
}

interface Program {
  id: number;
  body_area: BodyArea;
  complaint: string;
  status: "active" | "resolved";
  last_session_at: string | null;
}

interface Session {
  id: number;
  session_number: number;
  exercises: PhysioExercise[];
  rationale?: string;
}

const RED_FLAGS = [
  { key: "severe", label: "Sudden or severe pain (not just soreness)" },
  { key: "numbness", label: "Numbness, tingling, or weakness" },
  { key: "trauma", label: "Recent trauma or suspected fracture" },
  { key: "swellingFever", label: "Significant swelling with fever" },
] as const;

type Screen = "list" | "intake" | "redflag" | "painCheck" | "loading" | "safetyStop" | "session" | "checkin";

export function PhysioSheet({ onClose, initialBodyAreaHint }: { onClose: () => void; initialBodyAreaHint?: string }) {
  const hintedArea = BODY_AREAS.find((a) => a === initialBodyAreaHint?.toLowerCase());
  const [screen, setScreen] = useState<Screen>(hintedArea ? "intake" : "list");
  const [programs, setPrograms] = useState<Program[] | null>(null);
  const [activeProgram, setActiveProgram] = useState<Program | null>(null);
  const [pendingMode, setPendingMode] = useState<"initial" | "followup">("initial");

  const [bodyArea, setBodyArea] = useState<BodyArea | null>(hintedArea ?? null);
  const [complaint, setComplaint] = useState("");
  const [media, setMedia] = useState<{ kind: "image" | "video"; dataUrl: string } | null>(null);
  const [redFlags, setRedFlags] = useState<Record<string, boolean>>({});
  const [painBefore, setPainBefore] = useState(5);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [safetyNote, setSafetyNote] = useState<string | null>(null);

  const [session, setSession] = useState<Session | null>(null);
  const [done, setDone] = useState<Record<number, boolean>>({});
  const [painAfter, setPainAfter] = useState(5);
  const [difficulty, setDifficulty] = useState<"too_easy" | "right" | "too_hard">("right");
  const [saving, setSaving] = useState(false);

  const photoInput = useRef<HTMLInputElement>(null);
  const [recording, setRecording] = useState(false);
  const [recSeconds, setRecSeconds] = useState(0);
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);

  useEffect(() => { loadPrograms(); }, []);

  async function loadPrograms() {
    const { data } = await supabase.from("physio_programs")
      .select("id,body_area,complaint,status,last_session_at").eq("status", "active")
      .order("last_session_at", { ascending: false, nullsFirst: false });
    setPrograms((data as Program[]) ?? []);
  }

  function startNewComplaint() {
    setPendingMode("initial");
    setActiveProgram(null);
    setBodyArea(null);
    setComplaint("");
    setMedia(null);
    setRedFlags({});
    setErrorMsg(null);
    setScreen("intake");
  }

  function continueProgram(p: Program) {
    setPendingMode("followup");
    setActiveProgram(p);
    setMedia(null);
    setRedFlags({});
    setErrorMsg(null);
    setScreen("redflag");
  }

  async function resolveProgram(p: Program) {
    await supabase.from("physio_programs").update({ status: "resolved" }).eq("id", p.id);
    loadPrograms();
  }

  function onIntakeNext() {
    if (!bodyArea) { setErrorMsg("Pick a body area."); return; }
    if (!complaint.trim()) { setErrorMsg("Describe what's going on."); return; }
    setErrorMsg(null);
    setScreen("redflag");
  }

  function onRedFlagNext() {
    if (RED_FLAGS.some((f) => redFlags[f.key])) return; // button is disabled in this case anyway
    setScreen("painCheck");
  }

  async function onPhotoPicked(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    const dataUrl = await compressImage(file, 1024, 0.7);
    setMedia({ kind: "image", dataUrl });
  }

  function stopCamera() {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    if (videoRef.current) videoRef.current.srcObject = null;
  }

  async function startVideoCapture() {
    setMedia(null);
    setRecording(true);
    setRecSeconds(0);
    chunksRef.current = [];
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { width: { ideal: 640 }, height: { ideal: 480 }, facingMode: "environment" }, audio: false,
      });
      streamRef.current = stream;
      if (videoRef.current) { videoRef.current.srcObject = stream; videoRef.current.play().catch(() => {}); }
      const mimeType = MediaRecorder.isTypeSupported("video/webm") ? "video/webm" : "video/mp4";
      const recorder = new MediaRecorder(stream, { mimeType, videoBitsPerSecond: 1_000_000 });
      mediaRecorderRef.current = recorder;
      recorder.ondataavailable = (e) => { if (e.data.size > 0) chunksRef.current.push(e.data); };
      recorder.onstop = async () => {
        stopCamera();
        const blob = new Blob(chunksRef.current, { type: mimeType });
        const dataUrl: string = await new Promise((resolve) => {
          const reader = new FileReader();
          reader.onloadend = () => resolve(reader.result as string);
          reader.readAsDataURL(blob);
        });
        setMedia({ kind: "video", dataUrl });
        setRecording(false);
      };
      recorder.start();
      const tick = setInterval(() => setRecSeconds((s) => {
        if (s >= 7) { clearInterval(tick); recorder.stop(); return 8; }
        return s + 1;
      }), 1000);
    } catch {
      setRecording(false);
      setErrorMsg("Couldn't access the camera.");
    }
  }

  async function generatePlan() {
    setScreen("loading");
    setErrorMsg(null);
    try {
      const { data: { session: authSession } } = await supabase.auth.getSession();
      const payload: any = pendingMode === "initial"
        ? { mode: "initial", body_area: bodyArea, complaint, pain_before: painBefore }
        : { mode: "followup", program_id: activeProgram!.id, pain_before: painBefore };
      if (media?.kind === "image") payload.photoDataUrl = media.dataUrl;
      if (media?.kind === "video") payload.videoDataUrl = media.dataUrl;

      const res = await fetch("/api/ai/physio-plan", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${authSession?.access_token}` },
        body: JSON.stringify(payload),
      });
      const b = await res.json().catch(() => ({}));
      if (!res.ok) { setErrorMsg(b.error ?? "couldn't generate a routine"); setScreen(pendingMode === "initial" ? "intake" : "list"); return; }
      if (b.safety_note) { setSafetyNote(b.safety_note); setScreen("safetyStop"); return; }
      setSession({ id: b.session_id, session_number: b.session_number, exercises: b.exercises, rationale: b.rationale });
      setDone({});
      setScreen("session");
    } catch {
      setErrorMsg("Couldn't reach AI — try again.");
      setScreen(pendingMode === "initial" ? "intake" : "list");
    }
  }

  async function submitCheckin() {
    if (!session) return;
    setSaving(true);
    await supabase.from("physio_program_sessions")
      .update({ pain_after: painAfter, difficulty, completed_at: new Date().toISOString() })
      .eq("id", session.id);
    setSaving(false);
    setSession(null);
    setScreen("list");
    loadPrograms();
  }

  const redFlagged = RED_FLAGS.some((f) => redFlags[f.key]);

  return (
    <div className="fixed inset-0 z-[60] flex flex-col justify-end bg-black/40" onClick={screen !== "session" && screen !== "loading" ? onClose : undefined}>
      <div onClick={(e) => e.stopPropagation()}
        className="rounded-t-3xl bg-white dark:bg-neutral-950 p-5 pb-[calc(1.25rem+env(safe-area-inset-bottom))] max-w-md w-full mx-auto max-h-[90vh] overflow-y-auto">
        <div className="flex items-start justify-between gap-2 mb-4">
          <div>
            <h2 className="font-bold text-lg flex items-center gap-1.5"><Stethoscope className="w-5 h-5 text-teal-500" /> Physio</h2>
            <p className="text-xs text-neutral-500">AI-guided home exercise, not a substitute for a licensed physiotherapist</p>
          </div>
          {screen !== "session" && screen !== "loading" && (
            <button onClick={onClose} aria-label="Close" className="w-11 h-11 -mt-2 -mr-2 flex items-center justify-center text-neutral-400 shrink-0">✕</button>
          )}
        </div>

        {screen === "list" && (
          <div className="flex flex-col gap-3">
            {programs === null ? (
              <p className="text-sm text-neutral-400">Loading…</p>
            ) : programs.length === 0 ? (
              <p className="text-sm text-neutral-400">No active physio programs yet.</p>
            ) : (
              programs.map((p) => (
                <div key={p.id} className="rounded-2xl border border-neutral-200 dark:border-neutral-800 p-3.5">
                  <p className="font-semibold capitalize">{p.body_area}</p>
                  <p className="text-sm text-neutral-500 line-clamp-2">{p.complaint}</p>
                  <div className="flex gap-2 mt-3">
                    <button onClick={() => continueProgram(p)}
                      className="flex-1 rounded-xl bg-gradient-to-r from-teal-600 to-emerald-600 text-white py-2.5 font-semibold text-sm active:scale-[0.98]">
                      Continue session
                    </button>
                    <button onClick={() => resolveProgram(p)}
                      className="rounded-xl border border-neutral-300 dark:border-neutral-700 px-3.5 text-sm font-medium active:scale-[0.98]">
                      Resolve
                    </button>
                  </div>
                </div>
              ))
            )}
            <button onClick={startNewComplaint}
              className="mt-2 w-full rounded-xl border-2 border-dashed border-teal-400 text-teal-600 dark:text-teal-400 py-3 font-semibold active:scale-[0.98]">
              + New complaint
            </button>
          </div>
        )}

        {screen === "intake" && (
          <div className="flex flex-col gap-3">
            <p className="text-xs font-semibold text-neutral-400 uppercase">Body area</p>
            <div className="flex flex-wrap gap-2">
              {BODY_AREAS.map((a) => (
                <button key={a} onClick={() => setBodyArea(a)}
                  className={`rounded-full border px-3.5 py-2 text-sm font-medium capitalize ${
                    bodyArea === a ? "border-teal-600 text-teal-600 bg-teal-600/10" : "border-neutral-300 dark:border-neutral-700"}`}>
                  {a}
                </button>
              ))}
            </div>
            <p className="text-xs font-semibold text-neutral-400 uppercase mt-2">What's going on?</p>
            <textarea value={complaint} onChange={(e) => setComplaint(e.target.value)} rows={3}
              placeholder="e.g. my knee hurts when I climb stairs, started about a week ago"
              className="rounded-xl border border-neutral-300 dark:border-neutral-700 bg-white dark:bg-neutral-900 px-3 py-2.5 text-sm" />

            <p className="text-xs font-semibold text-neutral-400 uppercase mt-2">Optional: show the AI (photo or short video)</p>
            <div className="flex gap-2">
              <button onClick={() => photoInput.current?.click()}
                className="flex-1 flex items-center justify-center gap-1.5 rounded-xl border border-neutral-300 dark:border-neutral-700 text-sm font-medium py-2.5 active:scale-[0.98]">
                <Camera className="w-4 h-4" /> Photo
              </button>
              <input ref={photoInput} type="file" accept="image/*" capture="environment" onChange={onPhotoPicked} className="hidden" />
              <button onClick={startVideoCapture} disabled={recording}
                className="flex-1 flex items-center justify-center gap-1.5 rounded-xl border border-neutral-300 dark:border-neutral-700 text-sm font-medium py-2.5 active:scale-[0.98] disabled:opacity-50">
                <Video className="w-4 h-4" /> {recording ? `Recording ${recSeconds}s…` : "Video"}
              </button>
            </div>
            {recording && (
              <video ref={videoRef} muted playsInline className="w-full aspect-video bg-black rounded-xl object-cover scale-x-[-1]" />
            )}
            {media && <p className="text-xs text-emerald-600">{media.kind === "image" ? "Photo" : "Video"} attached.</p>}

            {errorMsg && <p className="text-xs text-amber-600">{errorMsg}</p>}
            <button onClick={onIntakeNext}
              className="mt-2 w-full rounded-xl bg-gradient-to-r from-teal-600 to-emerald-600 text-white py-3 font-semibold active:scale-[0.98]">
              Next
            </button>
          </div>
        )}

        {screen === "redflag" && (
          <div className="flex flex-col gap-3">
            <p className="text-sm">Quick safety check before we build a routine:</p>
            {RED_FLAGS.map((f) => (
              <label key={f.key} className="flex items-start gap-2.5 rounded-xl border border-neutral-200 dark:border-neutral-800 p-3">
                <input type="checkbox" checked={!!redFlags[f.key]}
                  onChange={(e) => setRedFlags((r) => ({ ...r, [f.key]: e.target.checked }))}
                  className="mt-0.5 w-4 h-4 accent-teal-600" />
                <span className="text-sm">{f.label}</span>
              </label>
            ))}
            {redFlagged && (
              <div className="rounded-xl border border-red-200 dark:border-red-900 bg-red-50 dark:bg-red-950/20 p-3 flex gap-2">
                <AlertTriangle className="w-5 h-5 text-red-500 shrink-0" />
                <p className="text-sm text-red-700 dark:text-red-400">
                  Please see a doctor or licensed physiotherapist in person instead — this isn't something a home routine should address.
                </p>
              </div>
            )}
            <button onClick={onRedFlagNext} disabled={redFlagged}
              className="mt-2 w-full rounded-xl bg-gradient-to-r from-teal-600 to-emerald-600 text-white py-3 font-semibold active:scale-[0.98] disabled:opacity-40">
              None of these apply — continue
            </button>
          </div>
        )}

        {screen === "painCheck" && (
          <div className="flex flex-col gap-3">
            <p className="text-sm">How's it feeling right now? (0 = no pain, 10 = worst pain)</p>
            <input type="range" min={0} max={10} value={painBefore} onChange={(e) => setPainBefore(Number(e.target.value))}
              className="w-full accent-teal-600" />
            <p className="text-center text-2xl font-bold">{painBefore}</p>
            <button onClick={generatePlan}
              className="mt-2 w-full rounded-xl bg-gradient-to-r from-teal-600 to-emerald-600 text-white py-3 font-semibold active:scale-[0.98] flex items-center justify-center gap-2">
              <Bot className="w-4 h-4" /> Generate routine
            </button>
          </div>
        )}

        {screen === "loading" && (
          <div className="flex flex-col items-center justify-center py-16 gap-3">
            <Loader2 className="w-8 h-8 text-teal-600 animate-spin" />
            <p className="text-sm text-neutral-500">Building your routine…</p>
          </div>
        )}

        {screen === "safetyStop" && (
          <div className="flex flex-col gap-3">
            <div className="rounded-xl border border-red-200 dark:border-red-900 bg-red-50 dark:bg-red-950/20 p-4 flex gap-2.5">
              <AlertTriangle className="w-6 h-6 text-red-500 shrink-0" />
              <p className="text-sm text-red-700 dark:text-red-400">{safetyNote}</p>
            </div>
            <button onClick={() => setScreen("list")}
              className="w-full rounded-xl border border-neutral-300 dark:border-neutral-700 py-3 font-semibold active:scale-[0.98]">
              Back
            </button>
          </div>
        )}

        {screen === "session" && session && (
          <div className="flex flex-col gap-3">
            {session.rationale && <p className="text-xs text-neutral-500">{session.rationale}</p>}
            {session.exercises.map((ex, i) => (
              <div key={i} className="rounded-2xl border border-neutral-200 dark:border-neutral-800 p-3.5">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="font-semibold flex items-center gap-1.5">
                      {ex.name}
                      {ex.source === "ai" && <Bot className="w-3.5 h-3.5 text-violet-500 shrink-0" />}
                    </p>
                    <p className="text-xs text-neutral-500 mt-0.5">{ex.instructions}</p>
                    <p className="text-xs text-neutral-400 mt-1">
                      {ex.hold_sec ? `Hold ${ex.hold_sec}s × ${ex.sets ?? 1}` : `${ex.sets ?? "—"} sets × ${ex.reps ?? "—"}`}
                    </p>
                  </div>
                  {ex.hold_sec ? (
                    <SetTimer targetSeconds={ex.hold_sec} onStop={() => setDone((d) => ({ ...d, [i]: true }))} />
                  ) : (
                    <button onClick={() => setDone((d) => ({ ...d, [i]: !d[i] }))} className="shrink-0">
                      {done[i] ? <CheckCircle2 className="w-7 h-7 text-emerald-500" /> : <Circle className="w-7 h-7 text-neutral-300 dark:text-neutral-700" />}
                    </button>
                  )}
                </div>
              </div>
            ))}
            <p className="text-[11px] text-neutral-400 text-center mt-1">
              ⚠️ AI-generated routine, not a substitute for a licensed physiotherapist. Stop if anything causes sharp pain.
            </p>
            <button onClick={() => setScreen("checkin")}
              className="w-full rounded-xl bg-gradient-to-r from-teal-600 to-emerald-600 text-white py-3.5 font-semibold active:scale-[0.98]">
              Finish session
            </button>
          </div>
        )}

        {screen === "checkin" && (
          <div className="flex flex-col gap-3">
            <p className="text-sm">How's it feeling now?</p>
            <input type="range" min={0} max={10} value={painAfter} onChange={(e) => setPainAfter(Number(e.target.value))}
              className="w-full accent-teal-600" />
            <p className="text-center text-2xl font-bold">{painAfter}</p>
            <p className="text-sm mt-2">How did the routine feel?</p>
            <div className="flex gap-2">
              {(["too_easy", "right", "too_hard"] as const).map((d) => (
                <button key={d} onClick={() => setDifficulty(d)}
                  className={`flex-1 rounded-xl border px-2 py-2.5 text-sm font-medium capitalize ${
                    difficulty === d ? "border-teal-600 text-teal-600 bg-teal-600/10" : "border-neutral-300 dark:border-neutral-700"}`}>
                  {d.replace("_", " ")}
                </button>
              ))}
            </div>
            <button onClick={submitCheckin} disabled={saving}
              className="mt-2 w-full rounded-xl bg-gradient-to-r from-teal-600 to-emerald-600 text-white py-3 font-semibold active:scale-[0.98] disabled:opacity-60">
              {saving ? "Saving…" : "Done"}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
