"use client";
import { useEffect, useRef, useState } from "react";
import { supabase } from "@/lib/supabase";
import { X, Video, AlertTriangle, CheckCircle, Loader2, RefreshCw } from "lucide-react";

interface Observation {
  type: "good" | "issue";
  note: string;
}

interface FormCheckResult {
  exercise_guess: string;
  observations: Observation[];
}

interface FormCheckSheetProps {
  exerciseName?: string;
  onClose: () => void;
}

export function FormCheckSheet({ exerciseName, onClose }: FormCheckSheetProps) {
  const [supported, setSupported] = useState<boolean | null>(null);
  const [status, setStatus] = useState<"idle" | "recording" | "analyzing" | "result" | "error">("idle");
  const [seconds, setSeconds] = useState(0);
  const [result, setResult] = useState<FormCheckResult | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const recordingTimerRef = useRef<NodeJS.Timeout | null>(null);
  const secondsTimerRef = useRef<NodeJS.Timeout | null>(null);

  // Check MediaRecorder & getUserMedia support on mount
  useEffect(() => {
    const isSupported = 
      typeof window !== "undefined" &&
      !!navigator.mediaDevices?.getUserMedia &&
      typeof MediaRecorder !== "undefined";
    setSupported(isSupported);
    if (!isSupported) {
      setErrorMsg("Video form check is not supported on this device or browser. (iOS Safari may require enabling MediaRecorder in Advanced experimental settings).");
      setStatus("error");
    }
  }, []);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      stopCamera();
      clearTimers();
    };
  }, []);

  function clearTimers() {
    if (recordingTimerRef.current) clearTimeout(recordingTimerRef.current);
    if (secondsTimerRef.current) clearInterval(secondsTimerRef.current);
  }

  function stopCamera() {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    }
    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }
  }

  async function startRecordingFlow() {
    if (!navigator.onLine) {
      setErrorMsg("You are offline. Form check requires an active internet connection.");
      setStatus("error");
      return;
    }

    setErrorMsg(null);
    setStatus("recording");
    setSeconds(0);
    chunksRef.current = [];

    try {
      // 1. Request camera permission and set stream
      const constraints = {
        video: {
          width: { ideal: 640 },
          height: { ideal: 480 },
          facingMode: "environment" // rear camera preferred for filming self
        },
        audio: false // only need video for form analysis
      };

      const stream = await navigator.mediaDevices.getUserMedia(constraints);
      streamRef.current = stream;

      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        videoRef.current.play().catch(() => {});
      }

      // 2. Determine mime type support
      let mimeType = "video/webm";
      if (!MediaRecorder.isTypeSupported(mimeType)) {
        mimeType = "video/mp4";
      }

      // 3. Initialize MediaRecorder with explicit bitrate limitation
      const recorder = new MediaRecorder(stream, {
        mimeType,
        videoBitsPerSecond: 1000000 // 1 Mbps target (capping payload size for serverless)
      });
      mediaRecorderRef.current = recorder;

      recorder.ondataavailable = (e) => {
        if (e.data && e.data.size > 0) {
          chunksRef.current.push(e.data);
        }
      };

      recorder.onstop = async () => {
        stopCamera();
        await analyzeRecordedVideo(mimeType);
      };

      // 4. Start recording
      recorder.start();

      // Start elapsed seconds counter
      secondsTimerRef.current = setInterval(() => {
        setSeconds((s) => {
          if (s >= 7) {
            // Hard cap at 8s total
            stopRecording();
            return 8;
          }
          return s + 1;
        });
      }, 1000);

      // Auto-stop at 8s hard cap
      recordingTimerRef.current = setTimeout(() => {
        stopRecording();
      }, 8000);

    } catch (err: any) {
      stopCamera();
      clearTimers();
      setErrorMsg(err.message || "Failed to access camera. Please check permissions.");
      setStatus("error");
    }
  }

  function stopRecording() {
    clearTimers();
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== "inactive") {
      mediaRecorderRef.current.stop();
    }
  }

  async function analyzeRecordedVideo(mimeType: string) {
    if (chunksRef.current.length === 0) {
      setErrorMsg("No video chunks were recorded. Please try again.");
      setStatus("error");
      return;
    }

    const videoBlob = new Blob(chunksRef.current, { type: mimeType });
    if (videoBlob.size < 100) {
      setErrorMsg("Recorded video is empty. Please check your camera permissions.");
      setStatus("error");
      return;
    }

    // Target 5-8 seconds, enforce minimum 4 seconds to be safe
    if (seconds < 4) {
      setErrorMsg("Video is too short. Please record for at least 5 seconds.");
      setStatus("error");
      return;
    }

    setStatus("analyzing");

    try {
      // Convert Blob to Base64 data URL
      const base64Data = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onloadend = () => resolve(reader.result as string);
        reader.onerror = () => reject(new Error("Failed to read video file"));
        reader.readAsDataURL(videoBlob);
      });

      const { data: { session } } = await supabase.auth.getSession();
      if (!session) {
        throw new Error("You must be logged in to use this feature.");
      }

      const res = await fetch("/api/ai/form-check", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${session.access_token}`
        },
        body: JSON.stringify({ videoDataUrl: base64Data })
      });

      const body = await res.json();
      if (!res.ok) {
        throw new Error(body.error || "Form analysis failed");
      }

      setResult(body.result);
      setStatus("result");
    } catch (err: any) {
      setErrorMsg(err.message || "An unexpected error occurred during form analysis.");
      setStatus("error");
    }
  }

  return (
    <div className="fixed inset-0 z-[60] flex flex-col justify-end">
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={status !== "recording" && status !== "analyzing" ? onClose : undefined} />

      {/* Sheet Container */}
      <div className="relative bg-white dark:bg-neutral-900 rounded-t-3xl shadow-2xl max-h-[90vh] flex flex-col max-w-md w-full mx-auto overflow-hidden animate-in slide-in-from-bottom-8 duration-200">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-neutral-100 dark:border-neutral-800 shrink-0">
          <div>
            <h2 className="font-bold text-lg text-neutral-900 dark:text-white">AI Posture / Form Check</h2>
            <p className="text-xs text-neutral-500">
              {status === "recording" ? "Recording active set..." : "Video analysis"}
            </p>
          </div>
          {status !== "recording" && status !== "analyzing" && (
            <button
              onClick={onClose}
              className="w-9 h-9 flex items-center justify-center rounded-full bg-neutral-100 dark:bg-neutral-800 text-neutral-500 hover:text-neutral-800 dark:hover:text-white transition-colors"
              aria-label="Close form check"
            >
              <X className="w-5 h-5" />
            </button>
          )}
        </div>

        {/* Content Body */}
        <div className="flex-1 overflow-y-auto p-5 flex flex-col min-h-[250px]">
          {status === "idle" && (
            <div className="flex-1 flex flex-col justify-center items-center text-center py-6">
              <div className="w-16 h-16 bg-indigo-50 dark:bg-indigo-900/30 rounded-2xl flex items-center justify-center text-indigo-600 mb-4 animate-pulse">
                <Video className="w-8 h-8" />
              </div>
              <h3 className="font-semibold text-neutral-900 dark:text-white mb-2">Check Your Exercise Technique</h3>
              <p className="text-sm text-neutral-500 max-w-xs mb-6">
                Record a quick <strong className="text-neutral-700 dark:text-neutral-300">5 to 8 second</strong> video of your set from the side or front to evaluate posture.
              </p>
              {exerciseName && (
                <div className="mb-8 px-4 py-2 bg-indigo-50 dark:bg-indigo-950/40 border border-indigo-100 dark:border-indigo-900/50 rounded-full text-xs font-semibold text-indigo-600 dark:text-indigo-400">
                  Target exercise: {exerciseName}
                </div>
              )}
            </div>
          )}

          {status === "recording" && (
            <div className="flex-1 flex flex-col items-center">
              {/* Camera Preview Box */}
              <div className="relative w-full aspect-video bg-black rounded-2xl overflow-hidden mb-6 shadow-inner border border-neutral-200 dark:border-neutral-800">
                <video
                  ref={videoRef}
                  muted
                  playsInline
                  className="w-full h-full object-cover scale-x-[-1]" // mirror for user feedback
                />
                <div className="absolute top-3 left-3 bg-black/60 backdrop-blur-md px-3 py-1 rounded-full flex items-center gap-1.5 text-xs font-bold text-white uppercase tracking-wider">
                  <span className="w-2.5 h-2.5 rounded-full bg-red-500 animate-ping" />
                  <span>Rec</span>
                </div>
                <div className="absolute bottom-3 right-3 bg-black/60 backdrop-blur-md px-3 py-1 rounded-full text-xs font-mono font-bold text-white">
                  {seconds}s / 8s
                </div>
              </div>
              <p className="text-sm text-neutral-500 text-center mb-6">
                Perform 1-2 slow reps. We will auto-stop at 8 seconds.
              </p>
            </div>
          )}

          {status === "analyzing" && (
            <div className="flex-1 flex flex-col justify-center items-center py-12">
              <Loader2 className="w-10 h-10 text-indigo-600 animate-spin mb-4" />
              <h3 className="font-semibold text-neutral-900 dark:text-white mb-2">Analyzing posture...</h3>
              <p className="text-sm text-neutral-500 text-center max-w-xs">
                Gemini is evaluating your form against injury risk benchmarks. This may take up to 15 seconds.
              </p>
            </div>
          )}

          {status === "result" && result && (
            <div className="flex-1 flex flex-col gap-4 animate-in fade-in duration-300">
              <div className="bg-neutral-50 dark:bg-neutral-800/40 p-4 rounded-2xl border border-neutral-100 dark:border-neutral-800">
                <span className="text-xs font-bold uppercase tracking-wider text-neutral-400 block mb-1">Identified Exercise</span>
                <span className="text-lg font-bold text-neutral-900 dark:text-white">{result.exercise_guess}</span>
              </div>

              <div className="space-y-2.5">
                <span className="text-xs font-bold uppercase tracking-wider text-neutral-400 block mb-1">Form Observations</span>
                {result.observations && result.observations.length > 0 ? (
                  result.observations.map((obs, idx) => (
                    <div
                      key={idx}
                      className={`flex items-start gap-3 p-3.5 rounded-2xl border ${
                        obs.type === "good"
                          ? "bg-emerald-50/50 dark:bg-emerald-950/10 border-emerald-100 dark:border-emerald-950/30 text-emerald-800 dark:text-emerald-300"
                          : "bg-amber-50/50 dark:bg-amber-950/10 border-amber-100 dark:border-amber-950/30 text-amber-800 dark:text-amber-300"
                      }`}
                    >
                      {obs.type === "good" ? (
                        <CheckCircle className="w-5 h-5 shrink-0 text-emerald-500 mt-0.5" />
                      ) : (
                        <AlertTriangle className="w-5 h-5 shrink-0 text-amber-500 mt-0.5" />
                      )}
                      <span className="text-sm leading-relaxed">{obs.note}</span>
                    </div>
                  ))
                ) : (
                  <p className="text-sm text-neutral-500 text-center py-4">No specific form observations returned.</p>
                )}
              </div>

              {/* Persistent Disclaimer */}
              <div className="mt-4 p-3 bg-neutral-50 dark:bg-neutral-800/20 rounded-xl border border-neutral-100 dark:border-neutral-800 text-center">
                <p className="text-[11px] font-medium text-neutral-400 dark:text-neutral-500 leading-normal">
                  ⚠️ AI observation, not a substitute for a qualified trainer.
                </p>
              </div>
            </div>
          )}

          {status === "error" && (
            <div className="flex-1 flex flex-col justify-center items-center text-center py-6">
              <div className="w-12 h-12 bg-red-50 dark:bg-red-950/20 rounded-full flex items-center justify-center text-red-500 mb-4">
                <AlertTriangle className="w-6 h-6" />
              </div>
              <h3 className="font-semibold text-neutral-900 dark:text-white mb-2">Something went wrong</h3>
              <p className="text-sm text-neutral-500 max-w-xs mb-6">{errorMsg}</p>
            </div>
          )}
        </div>

        {/* Footer / Action */}
        <div className="p-5 bg-white dark:bg-neutral-900 border-t border-neutral-100 dark:border-neutral-800 pb-[calc(1.25rem+env(safe-area-inset-bottom))] shrink-0 flex flex-col gap-2">
          {status === "idle" && (
            <button
              onClick={startRecordingFlow}
              className="w-full bg-gradient-to-r from-indigo-600 to-violet-600 hover:from-indigo-700 hover:to-violet-700 text-white font-bold py-4 rounded-2xl active:scale-[0.98] transition-all flex items-center justify-center gap-2 shadow-lg shadow-indigo-600/10 cursor-pointer"
            >
              <Video className="w-5 h-5" />
              Start Recording
            </button>
          )}

          {status === "recording" && (
            <button
              onClick={stopRecording}
              disabled={seconds < 4}
              className="w-full bg-red-600 hover:bg-red-700 disabled:opacity-40 disabled:pointer-events-none text-white font-bold py-4 rounded-2xl active:scale-[0.98] transition-all flex items-center justify-center gap-2 cursor-pointer"
            >
              Stop Recording ({seconds}s)
            </button>
          )}

          {(status === "result" || status === "error") && (
            <div className="flex gap-2">
              <button
                onClick={startRecordingFlow}
                className="flex-1 bg-indigo-50 dark:bg-indigo-950/40 text-indigo-600 dark:text-indigo-400 font-bold py-4 rounded-2xl active:scale-[0.98] transition-all flex items-center justify-center gap-2 cursor-pointer border border-indigo-100/50 dark:border-indigo-950/80"
              >
                <RefreshCw className="w-4 h-4" />
                Retry
              </button>
              <button
                onClick={onClose}
                className="flex-1 bg-neutral-100 dark:bg-neutral-800 text-neutral-800 dark:text-neutral-200 font-bold py-4 rounded-2xl active:scale-[0.98] transition-all cursor-pointer text-center"
              >
                Done
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
