"use client";
import { useEffect, useRef, useState } from "react";
import { AlertTriangle, Camera, RefreshCw, ScanLine, X } from "lucide-react";

interface WellnessCaptureSheetProps {
  scanType: "skin" | "eye" | "hair";
  onClose: () => void;
  onCapture: (imageDataUrl: string) => void;
}

export function WellnessCaptureSheet({ scanType, onClose, onCapture }: WellnessCaptureSheetProps) {
  const [cameraStatus, setCameraStatus] = useState<"init" | "active" | "error">("init");
  const [guideMsg, setGuideMsg] = useState("Open camera to frame your scan.");
  const [facingMode, setFacingMode] = useState<"user" | "environment">("user");
  const [isCapturing, setIsCapturing] = useState(false);
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const activeRef = useRef(true);

  const scanLabel = scanType === "skin" ? "Facial Skin" : scanType === "eye" ? "Eye Region" : "Hair & Scalp";
  const framingHint = scanType === "hair"
    ? "Keep your scalp and hair clearly inside the guide."
    : scanType === "eye"
      ? "Center both eyes inside the guide with even light."
      : "Center your face inside the guide with even light.";

  useEffect(() => {
    activeRef.current = true;
    startCameraFlow();
    return () => {
      activeRef.current = false;
      stopCamera();
    };
  }, [facingMode]);

  async function startCameraFlow() {
    if (!navigator.onLine) {
      setCameraStatus("error");
      setGuideMsg("You are offline. Connect to the internet before starting a scan.");
      return;
    }

    stopCamera();
    setCameraStatus("init");
    setGuideMsg("Preparing the camera...");
    let settled = false;
    const openTimeout = setTimeout(() => {
      if (!settled && activeRef.current) {
        settled = true;
        setCameraStatus("error");
        setGuideMsg("Camera took too long to open. Check camera permissions and try again.");
      }
    }, 10000);

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { width: { ideal: 640 }, height: { ideal: 480 }, facingMode: { ideal: facingMode } },
        audio: false,
      });
      if (settled || !activeRef.current) {
        stream.getTracks().forEach(track => track.stop());
        return;
      }

      streamRef.current = stream;
      const video = videoRef.current;
      if (!video) return;
      video.srcObject = stream;
      video.onloadedmetadata = () => {
        if (settled || !activeRef.current) return;
        settled = true;
        clearTimeout(openTimeout);
        video.play().catch(() => {});
        setCameraStatus("active");
        setGuideMsg(framingHint);
      };
    } catch (err) {
      if (settled) return;
      settled = true;
      clearTimeout(openTimeout);
      console.error("Camera access failed:", err);
      setCameraStatus("error");
      setGuideMsg("Couldn't access the camera. Check permissions for this browser and try again.");
    }
  }

  function stopCamera() {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(track => track.stop());
      streamRef.current = null;
    }
  }

  function captureSnapshot() {
    const video = videoRef.current;
    if (!video || isCapturing) return;

    setIsCapturing(true);
    const captureCanvas = document.createElement("canvas");
    captureCanvas.width = video.videoWidth || 640;
    captureCanvas.height = video.videoHeight || 480;
    const ctx = captureCanvas.getContext("2d");
    if (!ctx) return;

    ctx.translate(captureCanvas.width, 0);
    ctx.scale(-1, 1);
    ctx.drawImage(video, 0, 0, captureCanvas.width, captureCanvas.height);
    const base64Data = captureCanvas.toDataURL("image/jpeg", 0.85);
    video.pause();

    setTimeout(() => {
      stopCamera();
      onCapture(base64Data);
    }, 1350);
  }

  return (
    <div className="fixed inset-0 z-[60] flex flex-col justify-end">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={isCapturing ? undefined : onClose} />
      <div className="relative bg-neutral-900 rounded-t-3xl shadow-2xl max-h-[92vh] flex flex-col max-w-md w-full mx-auto overflow-hidden animate-in slide-in-from-bottom-8 duration-200 text-white">
        <div className="flex items-center justify-between px-5 py-4 border-b border-neutral-800 shrink-0">
          <div>
            <h2 className="font-bold text-lg text-white">{scanLabel} Capture</h2>
            <p className="text-xs text-neutral-400">Manual guided capture</p>
          </div>
          <button onClick={onClose} disabled={isCapturing} className="w-9 h-9 flex items-center justify-center rounded-full bg-neutral-800 text-neutral-400 hover:text-white transition-colors disabled:opacity-40" aria-label="Close capture">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="flex-1 p-5 flex flex-col items-center justify-center min-h-[300px]">
          {cameraStatus === "error" ? (
            <div className="flex flex-col items-center justify-center text-center py-8">
              <div className="w-12 h-12 bg-red-950/40 border border-red-900 rounded-full flex items-center justify-center text-red-500 mb-4"><AlertTriangle className="w-6 h-6" /></div>
              <h3 className="font-semibold text-white mb-2">Camera Error</h3>
              <p className="text-xs text-neutral-400 max-w-xs mb-6">{guideMsg}</p>
              <button onClick={startCameraFlow} className="px-5 py-2.5 bg-neutral-800 hover:bg-neutral-700 text-white text-xs font-bold rounded-xl flex items-center gap-1.5 cursor-pointer"><RefreshCw className="w-4 h-4" />Retry</button>
            </div>
          ) : (
            <div className="w-full flex flex-col items-center">
              <div className="relative w-full aspect-[4/3] bg-black rounded-2xl overflow-hidden border-2 border-cyan-400/70 shadow-[0_0_32px_rgba(34,211,238,0.12)]">
                <video ref={videoRef} muted playsInline className="w-full h-full object-cover scale-x-[-1]" />
                <div className="absolute inset-0 pointer-events-none bg-[linear-gradient(rgba(34,211,238,0.12)_1px,transparent_1px),linear-gradient(90deg,rgba(34,211,238,0.12)_1px,transparent_1px)] bg-[size:28px_28px] opacity-40" />
                <div className={"absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 border-2 border-cyan-300/80 shadow-[0_0_24px_rgba(34,211,238,0.38)] " + (scanType === "hair" ? "w-[76%] h-[66%] rounded-[38%]" : scanType === "eye" ? "w-[76%] h-[34%] rounded-[42%]" : "w-[56%] h-[74%] rounded-[48%]")} />
                <div className="absolute left-4 top-4 rounded-full border border-cyan-300/40 bg-black/55 px-2.5 py-1 text-[9px] font-bold tracking-[0.14em] text-cyan-200">MANUAL SCAN</div>
                {cameraStatus === "init" && <div className="absolute inset-0 bg-black/70 flex flex-col items-center justify-center text-center"><RefreshCw className="w-8 h-8 text-cyan-300 animate-spin mb-3" /><h3 className="font-semibold text-white text-sm">Opening camera...</h3></div>}
                {cameraStatus === "active" && <button onClick={() => setFacingMode(prev => prev === "user" ? "environment" : "user")} disabled={isCapturing} className="absolute top-4 right-4 bg-black/60 hover:bg-black/80 border border-neutral-700/50 p-2.5 rounded-full text-white disabled:opacity-40" title="Flip camera"><RefreshCw className="w-4 h-4" /></button>}
                {isCapturing && (
                  <div className="absolute inset-0 z-20 overflow-hidden pointer-events-none">
                    <style>{`@keyframes manualScanLine { from { top: 0%; } to { top: 100%; } }`}</style>
                    <div className="absolute inset-0 bg-cyan-400/15 backdrop-brightness-110" />
                    <div className="absolute left-0 right-0 h-1.5 bg-cyan-300 shadow-[0_0_24px_7px_rgba(103,232,249,0.9)]" style={{ animation: "manualScanLine 1.35s linear forwards" }} />
                    <div className="absolute inset-0 grid place-items-center"><div className="w-20 h-20 rounded-full border-2 border-cyan-300 bg-black/70 grid place-items-center shadow-[0_0_30px_rgba(34,211,238,0.45)]"><ScanLine className="w-8 h-8 text-cyan-200 animate-pulse" /></div></div>
                  </div>
                )}
              </div>
              {cameraStatus === "active" && <div className="w-full mt-3 flex items-center gap-2 px-4 py-3 bg-neutral-950/50 rounded-xl border border-neutral-800"><span className="w-2 h-2 rounded-full bg-cyan-300 animate-pulse shrink-0" /><span className="text-xs text-neutral-300 font-semibold leading-relaxed">{guideMsg}</span></div>}
            </div>
          )}
        </div>

        <div className="p-5 bg-neutral-950/80 border-t border-neutral-800 pb-[calc(1.25rem+env(safe-area-inset-bottom))] shrink-0 flex flex-col gap-2">
          {cameraStatus === "active" && <button onClick={captureSnapshot} disabled={isCapturing} className="w-full py-4 rounded-2xl font-bold active:scale-[0.98] transition-all flex items-center justify-center gap-2 cursor-pointer shadow-lg bg-gradient-to-r from-cyan-500 to-blue-600 text-white shadow-cyan-500/15 disabled:opacity-60"><Camera className="w-5 h-5" />{isCapturing ? "Capturing scan..." : "Capture Photo"}</button>}
          <button onClick={onClose} disabled={isCapturing} className="w-full bg-neutral-900 border border-neutral-800 text-neutral-400 hover:text-white py-3.5 rounded-2xl text-sm font-semibold transition-all cursor-pointer disabled:opacity-40">Cancel</button>
        </div>
      </div>
    </div>
  );
}
