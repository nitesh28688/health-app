"use client";
import { useEffect, useRef, useState } from "react";
import { X, Camera, RefreshCw, AlertTriangle, CheckCircle, Loader2 } from "lucide-react";

interface WellnessCaptureSheetProps {
  scanType: "skin" | "eye" | "hair";
  onClose: () => void;
  onCapture: (imageDataUrl: string) => void;
}

// Module-level caches for MediaPipe models
let cachedLandmarker: any = null;
let cachedSegmenter: any = null;
let cachedVision: any = null;
let isModelLoading = false;

export function WellnessCaptureSheet({ scanType, onClose, onCapture }: WellnessCaptureSheetProps) {
  const [modelStatus, setModelStatus] = useState<"loading" | "ready" | "fallback">("loading");
  const [cameraStatus, setCameraStatus] = useState<"init" | "active" | "error">("init");
  const [alignment, setAlignment] = useState<"red" | "green">("red");
  const [guideMsg, setGuideMsg] = useState("Positioning scan area...");
  const [autoCaptureSecs, setAutoCaptureSecs] = useState<number | null>(null);
  const [facingMode, setFacingMode] = useState<"user" | "environment">("user");
  const [isCapturing, setIsCapturing] = useState(false);

  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const activeRef = useRef(true);
  const alignRef = useRef<"red" | "green">("red");
  const greenTimerRef = useRef<NodeJS.Timeout | null>(null);

  // 1. Load MediaPipe models lazily and cache them
  useEffect(() => {
    activeRef.current = true;
    let modelTimeout: NodeJS.Timeout;

    async function loadModel() {
      const isHair = scanType === "hair";
      const cached = isHair ? cachedSegmenter : cachedLandmarker;

      if (cached) {
        setModelStatus("ready");
        return;
      }

      if (isModelLoading) {
        const checkInterval = setInterval(() => {
          const loaded = isHair ? cachedSegmenter : cachedLandmarker;
          if (loaded) {
            clearInterval(checkInterval);
            setModelStatus("ready");
          } else if (!isModelLoading && !loaded) {
            clearInterval(checkInterval);
            setModelStatus("fallback");
          }
        }, 100);
        return;
      }

      isModelLoading = true;

      // Fail-safe timeout: if MediaPipe takes > 6 seconds, fall back to manual capture
      modelTimeout = setTimeout(() => {
        const loaded = isHair ? cachedSegmenter : cachedLandmarker;
        if (!loaded && activeRef.current) {
          console.warn("MediaPipe load timed out. Falling back to manual capture.");
          isModelLoading = false;
          setModelStatus("fallback");
        }
      }, 6000);

      try {
        const { FilesetResolver, FaceLandmarker, ImageSegmenter } = await import("@mediapipe/tasks-vision");
        
        cachedVision = await FilesetResolver.forVisionTasks(
          "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.8/wasm"
        );
        
        // "CPU" delegate, not "GPU" — GPU delegate support for MediaPipe
        // Tasks Vision is inconsistent across mobile browsers, notably
        // Samsung Internet: model creation can succeed (so this never falls
        // back to "fallback" mode) while every actual detectForVideo/
        // segmentForVideo call throws afterward, silently caught below —
        // leaving the UI stuck on its default guide text forever with no
        // visible failure. CPU is slower but universally supported, and
        // detection is already throttled to 10fps so the cost is fine.
        if (isHair) {
          cachedSegmenter = await ImageSegmenter.createFromOptions(cachedVision, {
            baseOptions: {
              modelAssetPath: "https://storage.googleapis.com/mediapipe-models/image_segmenter/hair_segmenter/float32/1/hair_segmenter.task",
              delegate: "CPU"
            },
            runningMode: "VIDEO",
            outputCategoryMask: true,
            outputConfidenceMasks: false
          });
        } else {
          cachedLandmarker = await FaceLandmarker.createFromOptions(cachedVision, {
            baseOptions: {
              modelAssetPath: "https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task",
              delegate: "CPU"
            },
            runningMode: "VIDEO",
            numFaces: 1
          });
        }

        clearTimeout(modelTimeout);
        isModelLoading = false;
        if (activeRef.current) {
          setModelStatus("ready");
        }
      } catch (err) {
        console.error("Failed to load MediaPipe model. Falling back to manual capture.", err);
        clearTimeout(modelTimeout);
        isModelLoading = false;
        if (activeRef.current) {
          setModelStatus("fallback");
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
  }, [scanType]);

  // 2. Restart camera stream whenever facingMode changes or model becomes ready
  useEffect(() => {
    if (modelStatus !== "loading") {
      startCameraFlow();
    }
    return () => {
      stopCamera();
    };
  }, [facingMode, modelStatus]);

  async function startCameraFlow() {
    if (!navigator.onLine) {
      setCameraStatus("error");
      setGuideMsg("You are offline. Scans require internet to capture.");
      return;
    }

    // Stop current stream before restarting
    stopCamera();
    setCameraStatus("init");

    // Fail-safe: getUserMedia() has no built-in timeout. If the permission
    // prompt gets swallowed (a known issue in installed PWAs / some webviews)
    // or the device just never resolves the promise, the UI would otherwise
    // spin on "Opening camera..." forever with no way out. Same pattern as
    // the MediaPipe model-load timeout above.
    let settled = false;
    const openTimeout = setTimeout(() => {
      if (!settled && activeRef.current) {
        settled = true;
        console.warn("Camera open timed out after 10s.");
        setCameraStatus("error");
        setGuideMsg("Camera took too long to open. Check camera permissions for this app/browser, then try again.");
      }
    }, 10000);

    try {
      const constraints = {
        video: {
          width: { ideal: 640 },
          height: { ideal: 480 },
          // `ideal` (a preference), not an exact match — a hard facingMode
          // constraint can fail to resolve at all on devices without a
          // camera matching it exactly (e.g. some desktops/webcams), which
          // was one likely cause of the open hanging indefinitely.
          facingMode: { ideal: facingMode }
        },
        audio: false
      };

      const stream = await navigator.mediaDevices.getUserMedia(constraints);
      if (settled || !activeRef.current) {
        // Timed out (or unmounted) before this resolved — don't act on a
        // stale stream, just release it immediately.
        stream.getTracks().forEach((track) => track.stop());
        return;
      }
      // Deliberately NOT clearing openTimeout here. Obtaining the stream is
      // only half the job — the UI stays on "Opening camera..." until
      // `onloadedmetadata` fires below and flips cameraStatus to "active".
      // That event not firing (video element not ready right after the
      // sheet's mount animation, some mobile browser quirks) is a real,
      // separate failure mode from getUserMedia() itself never resolving —
      // clearing the timeout too early here was the actual bug: it left
      // nothing to catch a hang in this second stage, since "settled" also
      // guards the setTimeout callback but nothing was left running.
      streamRef.current = stream;

      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        videoRef.current.onloadedmetadata = () => {
          if (videoRef.current && !settled) {
            settled = true;
            clearTimeout(openTimeout);
            videoRef.current.play().catch(() => {});
            setCameraStatus("active");
            const loaded = scanType === "hair" ? cachedSegmenter : cachedLandmarker;
            if (modelStatus === "ready" || loaded) {
              startTrackingLoop();
            }
          }
        };
      } else {
        // No video element to attach to (shouldn't normally happen) — let
        // the fail-safe timeout below catch this rather than hanging silently.
      }
    } catch (err) {
      if (settled) return;
      settled = true;
      clearTimeout(openTimeout);
      console.error("Camera access failed:", err);
      setCameraStatus("error");
      setGuideMsg("Couldn't access the camera. Check camera permissions for this app/browser.");
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
    let lastProcessedTime = 0;
    let consecutiveFailures = 0;

    function renderLoop() {
      const v = videoRef.current;
      const c = canvasRef.current;
      if (!activeRef.current || !streamRef.current) return; // Stop permanently if unmounted or camera stopped

      // Note: Do NOT check v.paused. On Samsung Internet, a MediaStream can visually 
      // play and provide live frames even if its internal paused state remains true 
      // due to auto-play policies. We only care that it has valid dimensions and data.
      if (!v || !c || v.ended || v.videoWidth === 0 || v.videoHeight === 0 || v.readyState < 2) {
        requestAnimationFrame(renderLoop);
        return;
      }

      // Make sure canvas dimensions match video display dimensions
      if (c.width !== v.videoWidth || c.height !== v.videoHeight) {
        c.width = v.videoWidth;
        c.height = v.videoHeight;
      }

      ctx.clearRect(0, 0, c.width, c.height);

      const now = performance.now();
      // Throttle analysis to 10 FPS (every 100ms) for smooth mobile performance
      // Note: Removed v.currentTime !== lastVideoTime check because Samsung Internet 
      // sometimes fails to update v.currentTime for live MediaStreams, causing the 
      // loop to freeze on the very first frame and get stuck in "positioning" mode.
      if (now - lastProcessedTime > 100 && consecutiveFailures < 20) {
        lastVideoTime = v.currentTime;
        lastProcessedTime = now;
        try {
          if (scanType === "hair") {
            if (cachedSegmenter) {
              cachedSegmenter.segmentForVideo(v, now, (results: any) => {
                if (results.categoryMask) {
                  const mask = results.categoryMask.getAsUint8Array();
                  processHairMask(mask, c.width, c.height, ctx);
                  // MPMask is backed by WASM/GPU memory, not GC'd by JS — must be
                  // closed explicitly or every ~100ms frame at 10fps leaks a mask
                  // allocation (200-300+ over a 20-30s capture session).
                  results.categoryMask.close();
                } else {
                  updateAlignment("red", "No hair detected");
                }
              });
            }
          } else {
            if (cachedLandmarker) {
              const results = cachedLandmarker.detectForVideo(v, now);
              if (results.faceLandmarks && results.faceLandmarks.length > 0) {
                const landmarks = results.faceLandmarks[0];
                processLandmarks(landmarks, c.width, c.height, ctx);
              } else {
                updateAlignment("red", "No face detected");
              }
            }
          }
          consecutiveFailures = 0;
        } catch (e) {
          consecutiveFailures++;
          console.error(`Tracking frame processing error (${consecutiveFailures}/20)`, e);
          if (consecutiveFailures >= 20) {
            // Detection is genuinely broken on this device (e.g. a GPU/WASM
            // delegate issue) rather than just a bad single frame — stop
            // pretending live guidance is coming and drop to manual capture
            // instead of leaving the UI stuck on stale guide text forever.
            console.warn("Live tracking failed repeatedly — falling back to manual capture.");
            setModelStatus("fallback");
            updateAlignment("green", "Live guide unavailable — center yourself and capture manually.");
          } else {
            updateAlignment("red", "Positioning...");
          }
        }
      }

      requestAnimationFrame(renderLoop);
    }

    requestAnimationFrame(renderLoop);
  }

  // 4. Calculate Face/Eye placement
  function processLandmarks(landmarks: any[], width: number, height: number, ctx: CanvasRenderingContext2D) {
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

    const isCentered = Math.abs(centerX - 0.5) < 0.18 && Math.abs(centerY - 0.5) < 0.18;
    const isSizeOk = boxWidth >= 0.25 && boxWidth <= 0.65;

    // Draw helper guide oval
    ctx.strokeStyle = alignRef.current === "green" ? "rgba(16, 185, 129, 0.4)" : "rgba(239, 68, 68, 0.3)";
    ctx.lineWidth = 3;
    ctx.beginPath();
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
    } else if (scanType === "eye") {
      const leftEye = landmarks[33]; 
      const rightEye = landmarks[263]; 

      const eyesTracked = leftEye && rightEye;
      const eyesDistance = eyesTracked ? Math.abs(rightEye.x - leftEye.x) : 0;
      
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

  // 5. Hair Segmenter Mask Processing
  function processHairMask(mask: Uint8Array, width: number, height: number, ctx: CanvasRenderingContext2D) {
    let hairPixels = 0;
    for (let i = 0; i < mask.length; i++) {
      if (mask[i] === 1) {
        hairPixels++;
      }
    }
    const coverageRatio = hairPixels / mask.length;

    // Draw transparent green segmentation overlay on detected hair pixels to wow the user
    const imgData = ctx.createImageData(width, height);
    for (let i = 0; i < mask.length; i++) {
      const idx = i * 4;
      if (mask[i] === 1) {
        imgData.data[idx] = 99;     // R
        imgData.data[idx+1] = 102;  // G
        imgData.data[idx+2] = 241;  // B (indigo tint)
        imgData.data[idx+3] = 75;   // ~30% Alpha
      } else {
        imgData.data[idx+3] = 0;    // Transparent
      }
    }
    ctx.putImageData(imgData, 0, 0);

    // Green zone when coverage is between 12% and 75%
    const isCoverageOk = coverageRatio >= 0.12 && coverageRatio <= 0.75;

    if (!isCoverageOk) {
      if (coverageRatio < 0.12) {
        updateAlignment("red", "Frame your hair clearly (move closer/adjust angle)");
      } else {
        updateAlignment("red", "Move slightly back");
      }
    } else {
      updateAlignment("green", "Hair coverage optimal! Hold still...");
    }
  }

  // 6. Update alignment zone & handle auto-capture logic
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

  // 7. Capture photo
  function captureSnapshot() {
    if (greenTimerRef.current) {
      clearTimeout(greenTimerRef.current);
      greenTimerRef.current = null;
    }

    const video = videoRef.current;
    if (!video) return;

    setIsCapturing(true);

    const captureCanvas = document.createElement("canvas");
    captureCanvas.width = video.videoWidth || 640;
    captureCanvas.height = video.videoHeight || 480;

    const ctx = captureCanvas.getContext("2d")!;
    // Draw mirrored video frame for final photo
    ctx.translate(captureCanvas.width, 0);
    ctx.scale(-1, 1);
    ctx.drawImage(video, 0, 0, captureCanvas.width, captureCanvas.height);

    const base64Data = captureCanvas.toDataURL("image/jpeg", 0.85);
    
    if (videoRef.current) {
      videoRef.current.pause(); // Freeze frame for animation
    }

    // Allow 1.5s for the scanning animation to play
    setTimeout(() => {
      stopCamera();
      onCapture(base64Data);
    }, 1500);
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
              {scanType === "skin" ? "Facial Skin Capture" : scanType === "eye" ? "Eye Region Capture" : "Hair & Scalp Capture"}
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
              <Loader2 className="w-10 h-10 text-rose-500 animate-spin mb-4" />
              <h3 className="font-semibold text-white mb-2">Loading Smart Guides</h3>
              <p className="text-xs text-neutral-400 max-w-xs">
                Downloading MediaPipe vision model (~5MB). This only happens once.
              </p>
            </div>
          )}

          {cameraStatus === "error" && (
            <div className="flex flex-col items-center justify-center text-center py-8">
              <div className="w-12 h-12 bg-red-950/40 border border-red-900 rounded-full flex items-center justify-center text-red-500 mb-4">
                <AlertTriangle className="w-6 h-6" />
              </div>
              <h3 className="font-semibold text-white mb-2">Camera Error</h3>
              <p className="text-xs text-neutral-400 max-w-xs mb-6">
                {guideMsg || "Please make sure camera access is allowed in settings and you are online."}
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

          {(cameraStatus === "init" || cameraStatus === "active") && (
            <div className="w-full flex flex-col items-center">
              {/* Viewfinder box — the <video> element must exist in the DOM
                  from "init" onward, not only once "active": startCameraFlow()
                  attaches the stream via videoRef.current, and cameraStatus can
                  only ever BECOME "active" from inside that same video
                  element's onloadedmetadata handler. Rendering it only when
                  already "active" was a chicken-and-egg bug — the stream had
                  nowhere to attach to, so it silently went nowhere (confirmed
                  live: the browser's own camera-access log showed the stream
                  was obtained, but the UI never left "Opening camera..."). */}
              <div
                className={`relative w-full aspect-[4/3] bg-black rounded-2xl overflow-hidden border-3 shadow-2xl transition-all duration-300 ${
                  cameraStatus !== "active"
                    ? "border-neutral-700"
                    : modelStatus === "fallback"
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

                {cameraStatus === "init" && (
                  <div className="absolute inset-0 bg-black/70 flex flex-col items-center justify-center text-center">
                    <Loader2 className="w-8 h-8 text-rose-500 animate-spin mb-3" />
                    <h3 className="font-semibold text-white text-sm">Opening camera...</h3>
                  </div>
                )}

                {cameraStatus === "active" && (
                  <>
                    {/* Scanning Animation Overlay */}
                    {isCapturing && (
                      <div className="absolute inset-0 z-20 overflow-hidden pointer-events-none">
                        <style>{`
                          @keyframes scannerLine {
                            0% { top: 0%; }
                            50% { top: 100%; }
                            100% { top: 0%; }
                          }
                        `}</style>
                        <div className="absolute inset-0 bg-emerald-500/20 backdrop-brightness-110 transition-all duration-300" />
                        <div 
                          className="absolute left-0 right-0 h-1.5 bg-emerald-400 shadow-[0_0_20px_5px_rgba(52,211,153,0.9)] z-30" 
                          style={{ animation: "scannerLine 1.5s ease-in-out infinite" }} 
                        />
                        <div className="absolute inset-0 flex items-center justify-center z-40">
                          <div className="bg-black/90 px-6 py-4 rounded-3xl border border-emerald-500/40 flex flex-col items-center shadow-2xl shadow-emerald-900/50">
                            <RefreshCw className="w-8 h-8 text-emerald-400 animate-spin mb-3" />
                            <span className="text-sm font-black text-emerald-400 tracking-widest">ANALYZING</span>
                          </div>
                        </div>
                      </div>
                    )}

                    {/* Flip camera overlay button */}
                    <button
                      onClick={() => setFacingMode((prev) => (prev === "user" ? "environment" : "user"))}
                      className="absolute top-4 right-4 z-10 bg-black/60 hover:bg-black/80 border border-neutral-700/50 p-2.5 rounded-full text-white active:scale-95 transition-all shadow-md cursor-pointer"
                      title="Flip camera"
                    >
                      <RefreshCw className="w-4 h-4" />
                    </button>

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
                  </>
                )}
              </div>

              {cameraStatus === "active" && (
                <>
                  {/* Scalp scan tips overlay */}
                  {scanType === "hair" && (
                    <div className="w-full mt-2.5 px-3 py-2 bg-rose-950/20 border border-rose-900/30 rounded-xl text-rose-400 text-[10px] font-bold text-center">
                      💡 Crown/Scalp scan: tilt head down with camera above, or have someone help.
                    </div>
                  )}

                  {/* Instructions Banner */}
                  <div className="w-full mt-3 flex items-center gap-2 px-4 py-3 bg-neutral-950/50 rounded-xl border border-neutral-800">
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
                </>
              )}
            </div>
          )}
        </div>

        {/* Footer actions */}
        <div className="p-5 bg-neutral-950/80 border-t border-neutral-800 pb-[calc(1.25rem+env(safe-area-inset-bottom))] shrink-0 flex flex-col gap-2">
          {cameraStatus === "active" && (
            <button
              onClick={captureSnapshot}
              className={`w-full py-4 rounded-2xl font-bold active:scale-[0.98] transition-all flex items-center justify-center gap-2 cursor-pointer shadow-lg ${
                alignment === "green" || modelStatus === "fallback"
                  ? "bg-gradient-to-r from-emerald-500 to-teal-600 text-white shadow-emerald-500/10"
                  : "bg-neutral-800 text-neutral-400 hover:bg-neutral-700"
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
