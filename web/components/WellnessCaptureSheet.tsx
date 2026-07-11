"use client";
import { useEffect, useRef, useState } from "react";
import { X, Camera, RefreshCw, AlertTriangle, CheckCircle, Loader2 } from "lucide-react";

interface WellnessCaptureSheetProps {
  scanType: "skin" | "eye";
  onClose: () => void;
  onCapture: (imageDataUrl: string) => void;
}

// Module-level cache for the Face Landmarker to prevent re-downloads/re-initializations
let cachedLandmarker: any = null;
let cachedVision: any = null;
let isModelLoading = false;

export function WellnessCaptureSheet({ scanType, onClose, onCapture }: WellnessCaptureSheetProps) {
  const [modelStatus, setModelStatus] = useState<"loading" | "ready" | "fallback">("loading");
  const [cameraStatus, setCameraStatus] = useState<"init" | "active" | "error">("init");
  const [alignment, setAlignment] = useState<"red" | "green">("red");
  const [guideMsg, setGuideMsg] = useState("Positioning face...");
  const [autoCaptureSecs, setAutoCaptureSecs] = useState<number | null>(null);

  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const activeRef = useRef(true);
  const alignRef = useRef<"red" | "green">("red");
  const greenTimerRef = useRef<NodeJS.Timeout | null>(null);

  // 1. Load MediaPipe Face Landmarker lazily and cache it
  useEffect(() => {
    activeRef.current = true;
    let modelTimeout: NodeJS.Timeout;

    async function loadModel() {
      if (cachedLandmarker) {
        setModelStatus("ready");
        startCameraFlow();
        return;
      }

      if (isModelLoading) {
        // Wait and check again
        const checkInterval = setInterval(() => {
          if (cachedLandmarker) {
            clearInterval(checkInterval);
            setModelStatus("ready");
            startCameraFlow();
          } else if (!isModelLoading && !cachedLandmarker) {
            clearInterval(checkInterval);
            setModelStatus("fallback");
            startCameraFlow();
          }
        }, 100);
        return;
      }

      isModelLoading = true;

      // Fail-safe timeout: if MediaPipe takes > 6 seconds, fall back to manual capture
      modelTimeout = setTimeout(() => {
        if (!cachedLandmarker && activeRef.current) {
          console.warn("MediaPipe load timed out. Falling back to manual capture.");
          isModelLoading = false;
          setModelStatus("fallback");
          startCameraFlow();
        }
      }, 6000);

      try {
        const { FilesetResolver, FaceLandmarker } = await import("@mediapipe/tasks-vision");
        
        cachedVision = await FilesetResolver.forVisionTasks(
          "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.8/wasm"
        );
        
        cachedLandmarker = await FaceLandmarker.createFromOptions(cachedVision, {
          baseOptions: {
            modelAssetPath: "https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task",
            delegate: "GPU"
          },
          runningMode: "VIDEO",
          numFaces: 1
        });

        clearTimeout(modelTimeout);
        isModelLoading = false;
        if (activeRef.current) {
          setModelStatus("ready");
          startCameraFlow();
        }
      } catch (err) {
        console.error("Failed to load Face Landmarker. Falling back to manual capture.", err);
        clearTimeout(modelTimeout);
        isModelLoading = false;
        if (activeRef.current) {
          setModelStatus("fallback");
          startCameraFlow();
        }
      }
    }

    loadModel();

    return () => {
      activeRef.current = false;
      clearTimeout(modelTimeout);
      stopCamera();
      if (greenTimerRef.current) clearTimeout(greenTimerRef.current);
    };
  }, []);

  // 2. Start Camera stream
  async function startCameraFlow() {
    if (!navigator.onLine) {
      setCameraStatus("error");
      setGuideMsg("You are offline. Scans require internet to capture.");
      return;
    }

    try {
      const constraints = {
        video: {
          width: { ideal: 640 },
          height: { ideal: 480 },
          facingMode: "user" // Selfie camera default
        },
        audio: false
      };

      const stream = await navigator.mediaDevices.getUserMedia(constraints);
      streamRef.current = stream;

      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        videoRef.current.onloadedmetadata = () => {
          if (videoRef.current) {
            videoRef.current.play().catch(() => {});
            setCameraStatus("active");
            if (modelStatus === "ready" || cachedLandmarker) {
              startTrackingLoop();
            }
          }
        };
      }
    } catch (err) {
      console.error("Camera access failed:", err);
      setCameraStatus("error");
    }
  }

  function stopCamera() {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    }
  }

  // 3. MediaPipe tracking loops
  function startTrackingLoop() {
    const video = videoRef.current;
    const canvas = canvasRef.current;
    if (!video || !canvas) return;

    const ctx = canvas.getContext("2d")!;
    let lastVideoTime = -1;

    function renderLoop() {
      const v = videoRef.current;
      const c = canvasRef.current;
      if (!v || !c || !activeRef.current || v.paused || v.ended || !streamRef.current) return;

      // Make sure canvas dimensions match video display dimensions
      if (c.width !== v.videoWidth || c.height !== v.videoHeight) {
        c.width = v.videoWidth;
        c.height = v.videoHeight;
      }

      ctx.clearRect(0, 0, c.width, c.height);

      if (v.currentTime !== lastVideoTime && cachedLandmarker) {
        lastVideoTime = v.currentTime;
        try {
          const results = cachedLandmarker.detectForVideo(v, performance.now());
          
          if (results.faceLandmarks && results.faceLandmarks.length > 0) {
            const landmarks = results.faceLandmarks[0];
            processLandmarks(landmarks, c.width, c.height, ctx);
          } else {
            updateAlignment("red", "No face detected");
          }
        } catch (e) {
          console.error("Tracking frame processing error", e);
        }
      }

      requestAnimationFrame(renderLoop);
    }

    requestAnimationFrame(renderLoop);
  }

  // 4. Calculate Face/Eye placement
  function processLandmarks(landmarks: any[], width: number, height: number, ctx: CanvasRenderingContext2D) {
    // Get bounding box
    let minX = 1, maxX = 0, minY = 1, maxY = 0;
    landmarks.forEach((pt) => {
      if (pt.x < minX) minX = pt.x;
      if (pt.x > maxX) maxX = pt.x;
      if (pt.y < minY) minY = pt.y;
      if (pt.y > maxY) maxY = pt.y;
    });

    const boxWidth = maxX - minX;
    const boxHeight = maxY - minY;
    const centerX = minX + boxWidth / 2;
    const centerY = minY + boxHeight / 2;

    // Check Centered (center coordinate should be within 18% of frame center: 0.5)
    const isCentered = Math.abs(centerX - 0.5) < 0.18 && Math.abs(centerY - 0.5) < 0.18;

    // Check Size (face width should cover between 25% and 65% of screen width)
    const isSizeOk = boxWidth >= 0.25 && boxWidth <= 0.65;

    // Draw helper guide lines on canvas (mirrored)
    ctx.strokeStyle = alignRef.current === "green" ? "rgba(16, 185, 129, 0.4)" : "rgba(239, 68, 68, 0.3)";
    ctx.lineWidth = 3;
    ctx.beginPath();
    // Draw outer guide oval
    ctx.ellipse(width / 2, height / 2, width * 0.25, height * 0.35, 0, 0, 2 * Math.PI);
    ctx.stroke();

    if (scanType === "skin") {
      if (!isCentered) {
        updateAlignment("red", "Center your face in the oval");
      } else if (boxWidth < 0.25) {
        updateAlignment("red", "Move closer to the camera");
      } else if (boxWidth > 0.65) {
        updateAlignment("red", "Move slightly further back");
      } else {
        updateAlignment("green", "Position correct! Hold still...");
      }
    } else {
      // Eye Scan constraints: eyes must be visible
      // Landmark indexes for eyes: Left eye center/iris around 468-472, Right eye around 473-477
      // In Face Landmarker, left eye centers and right eye centers are tracked
      const leftEye = landmarks[33]; // Corner of left eye
      const rightEye = landmarks[263]; // Corner of right eye

      const eyesTracked = leftEye && rightEye;
      const eyesDistance = eyesTracked ? Math.abs(rightEye.x - leftEye.x) : 0;
      
      // Eyes should be relatively horizontal and close enough (distance > 0.08)
      const eyesAligned = eyesTracked && Math.abs(leftEye.y - rightEye.y) < 0.08;
      const eyesCloseEnough = eyesDistance > 0.08;

      if (!eyesTracked) {
        updateAlignment("red", "Eyes not detected");
      } else if (!eyesCloseEnough) {
        updateAlignment("red", "Move closer to scan eyes");
      } else if (!eyesAligned) {
        updateAlignment("red", "Keep your head straight");
      } else {
        updateAlignment("green", "Eyes aligned! Hold still...");
      }
    }
  }

  // 5. Update alignment zone & handle auto-capture logic
  function updateAlignment(zone: "red" | "green", msg: string) {
    setGuideMsg(msg);
    if (alignRef.current !== zone) {
      alignRef.current = zone;
      setAlignment(zone);

      if (zone === "green") {
        // Start 1.5s auto-capture timer
        setAutoCaptureSecs(2);
        greenTimerRef.current = setTimeout(() => {
          captureSnapshot();
        }, 1500);
      } else {
        // Cancel timer
        if (greenTimerRef.current) {
          clearTimeout(greenTimerRef.current);
          greenTimerRef.current = null;
        }
        setAutoCaptureSecs(null);
      }
    }
  }

  // 6. Capture photo
  function captureSnapshot() {
    if (greenTimerRef.current) {
      clearTimeout(greenTimerRef.current);
      greenTimerRef.current = null;
    }

    const video = videoRef.current;
    if (!video) return;

    // Standard high-quality canvas snapshot
    const captureCanvas = document.createElement("canvas");
    captureCanvas.width = video.videoWidth || 640;
    captureCanvas.height = video.videoHeight || 480;

    const ctx = captureCanvas.getContext("2d")!;
    // Draw mirrored video frame for final photo
    ctx.translate(captureCanvas.width, 0);
    ctx.scale(-1, 1);
    ctx.drawImage(video, 0, 0, captureCanvas.width, captureCanvas.height);

    const base64Data = captureCanvas.toDataURL("image/jpeg", 0.85);
    stopCamera();
    onCapture(base64Data);
  }

  return (
    <div className="fixed inset-0 z-[60] flex flex-col justify-end">
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />

      {/* Capture Container */}
      <div className="relative bg-neutral-900 rounded-t-3xl shadow-2xl max-h-[92vh] flex flex-col max-w-md w-full mx-auto overflow-hidden animate-in slide-in-from-bottom-8 duration-200 text-white">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-neutral-800 shrink-0">
          <div>
            <h2 className="font-bold text-lg text-white">
              {scanType === "skin" ? "Facial Skin Capture" : "Eye Region Capture"}
            </h2>
            <p className="text-xs text-neutral-400">
              {modelStatus === "loading" ? "Initializing tracking AI..." : "Align camera"}
            </p>
          </div>
          <button
            onClick={onClose}
            className="w-9 h-9 flex items-center justify-center rounded-full bg-neutral-800 text-neutral-400 hover:text-white transition-colors"
            aria-label="Close capture"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Viewfinder Body */}
        <div className="flex-1 p-5 flex flex-col items-center justify-center min-h-[300px]">
          {modelStatus === "loading" && (
            <div className="flex flex-col items-center justify-center text-center py-12">
              <Loader2 className="w-10 h-10 text-indigo-500 animate-spin mb-4" />
              <h3 className="font-semibold text-white mb-2">Loading Smart Guides</h3>
              <p className="text-xs text-neutral-400 max-w-xs">
                Downloading face landmarker model (~5MB). This only happens once.
              </p>
            </div>
          )}

          {modelStatus !== "loading" && cameraStatus === "init" && (
            <div className="flex flex-col items-center justify-center text-center py-12">
              <Loader2 className="w-10 h-10 text-indigo-500 animate-spin mb-4" />
              <h3 className="font-semibold text-white mb-2">Opening camera...</h3>
            </div>
          )}

          {cameraStatus === "error" && (
            <div className="flex flex-col items-center justify-center text-center py-8">
              <div className="w-12 h-12 bg-red-950/40 border border-red-900 rounded-full flex items-center justify-center text-red-500 mb-4">
                <AlertTriangle className="w-6 h-6" />
              </div>
              <h3 className="font-semibold text-white mb-2">Camera Error</h3>
              <p className="text-xs text-neutral-400 max-w-xs mb-6">
                Please make sure camera access is allowed in settings and you are online.
              </p>
              <button
                onClick={startCameraFlow}
                className="px-5 py-2.5 bg-neutral-800 hover:bg-neutral-700 text-white text-xs font-bold rounded-xl flex items-center gap-1.5 cursor-pointer"
              >
                <RefreshCw className="w-4 h-4" />
                Retry
              </button>
            </div>
          )}

          {cameraStatus === "active" && (
            <div className="w-full flex flex-col items-center">
              {/* Viewfinder box */}
              <div
                className={`relative w-full aspect-[4/3] bg-black rounded-2xl overflow-hidden border-3 shadow-2xl transition-all duration-300 ${
                  modelStatus === "fallback"
                    ? "border-neutral-700"
                    : alignment === "green"
                    ? "border-emerald-500 shadow-emerald-500/10"
                    : "border-red-500/80 shadow-red-500/10"
                }`}
              >
                <video
                  ref={videoRef}
                  muted
                  playsInline
                  className="w-full h-full object-cover scale-x-[-1]"
                />
                
                {/* Canvas Overlay for tracking guides */}
                {modelStatus === "ready" && (
                  <canvas ref={canvasRef} className="absolute inset-0 w-full h-full pointer-events-none scale-x-[-1]" />
                )}

                {/* Auto Capture Indicator overlay */}
                {alignment === "green" && autoCaptureSecs !== null && (
                  <div className="absolute inset-0 bg-emerald-500/10 flex items-center justify-center pointer-events-none">
                    <div className="bg-black/80 px-4 py-2 rounded-2xl text-center border border-emerald-500/30">
                      <span className="text-2xl font-black text-emerald-400 animate-pulse">CAPTURING</span>
                      <p className="text-[10px] text-neutral-400 mt-0.5">Hold perfectly still</p>
                    </div>
                  </div>
                )}
              </div>

              {/* Instructions Banner */}
              <div className="w-full mt-4 flex items-center gap-2 px-4 py-3 bg-neutral-950/50 rounded-xl border border-neutral-800">
                {modelStatus === "fallback" ? (
                  <div className="flex-1 text-center text-xs text-neutral-400">
                    ℹ️ Manual mode. Center yourself and press capture when ready.
                  </div>
                ) : (
                  <>
                    <span className={`w-2.5 h-2.5 rounded-full shrink-0 ${alignment === "green" ? "bg-emerald-500 animate-pulse" : "bg-red-500 animate-ping"}`} />
                    <span className="text-xs text-neutral-300 font-semibold leading-relaxed">
                      {guideMsg}
                    </span>
                  </>
                )}
              </div>
            </div>
          )}
        </div>

        {/* Footer actions */}
        <div className="p-5 bg-neutral-950/80 border-t border-neutral-850 pb-[calc(1.25rem+env(safe-area-inset-bottom))] shrink-0 flex flex-col gap-2">
          {cameraStatus === "active" && (
            <button
              onClick={captureSnapshot}
              className={`w-full py-4 rounded-2xl font-bold active:scale-[0.98] transition-all flex items-center justify-center gap-2 cursor-pointer shadow-lg ${
                alignment === "green" || modelStatus === "fallback"
                  ? "bg-gradient-to-r from-emerald-500 to-teal-600 text-white shadow-emerald-500/10"
                  : "bg-neutral-800 text-neutral-400 hover:bg-neutral-750"
              }`}
            >
              <Camera className="w-5 h-5" />
              Capture Photo
            </button>
          )}
          <button
            onClick={onClose}
            className="w-full bg-neutral-900 border border-neutral-800 text-neutral-400 hover:text-white py-3.5 rounded-2xl text-sm font-semibold active:scale-[0.98] transition-all cursor-pointer text-center"
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}
