"use client";
import { useEffect, useState } from "react";
import { ZoomIn } from "lucide-react";

// Two real photos per exercise (start/end position, from the public-domain
// free-exercise-db seed — see scripts/seed-exercise-images.mjs), not a true
// video. Crossfading between them on a loop reads as a simple animated demo
// without needing real video or a paid GIF API. Renders nothing if the
// exercise has no images (yoga poses and user/AI-added custom exercises
// don't have a source photo) — callers don't need to check first.
export function ExerciseDemo({ urls, size = 56 }: { urls: string[] | null | undefined; size?: number }) {
  const [frame, setFrame] = useState(0);
  const [fullscreen, setFullscreen] = useState(false);
  const hasTwo = urls && urls.length >= 2;

  useEffect(() => {
    if (!hasTwo) return;
    const t = setInterval(() => setFrame((f) => (f === 0 ? 1 : 0)), 900);
    return () => clearInterval(t);
  }, [hasTwo]);

  if (!urls || urls.length === 0) return null;

  return (
    <>
      <button 
        onClick={(e) => { e.stopPropagation(); e.preventDefault(); setFullscreen(true); }}
        className="relative shrink-0 rounded-lg overflow-hidden bg-neutral-100 dark:bg-neutral-800" 
        style={{ width: size, height: size }}
      >
        {urls.slice(0, 2).map((url, i) => (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            key={url}
            src={url}
            alt=""
            className="absolute inset-0 w-full h-full object-cover transition-opacity duration-300"
            style={{ opacity: hasTwo ? (i === frame ? 1 : 0) : 1 }}
            loading="lazy"
          />
        ))}
        <div className="absolute inset-0 bg-black/0 hover:bg-black/10 transition-colors flex items-center justify-center">
          <ZoomIn className="w-4 h-4 opacity-0 hover:opacity-100 text-white drop-shadow-md" />
        </div>
      </button>

      {fullscreen && (
        <div className="fixed inset-0 z-[100] bg-black/90 backdrop-blur-sm flex items-center justify-center p-4" onClick={(e) => { e.stopPropagation(); setFullscreen(false); }}>
          {/* Explicit z-20 — without it, this button and the image container
              below both sit in the "positioned, z-index:auto" paint layer and
              stack purely by DOM order, so the (later) image container was
              rendering on top of and hiding this button entirely. Also given
              its own onClick instead of relying on bubbling to the backdrop,
              which was the button's only way of actually closing before. */}
          <button onClick={(e) => { e.stopPropagation(); setFullscreen(false); }} aria-label="Close"
            className="absolute top-4 right-4 z-20 w-12 h-12 flex items-center justify-center text-white/70 hover:text-white rounded-full bg-black/60 hover:bg-black/80 text-2xl transition-colors cursor-pointer">✕</button>
          <div className="relative z-10 w-full max-w-2xl aspect-square bg-neutral-900 rounded-2xl overflow-hidden shadow-2xl" onClick={(e) => e.stopPropagation()}>
            {urls.slice(0, 2).map((url, i) => (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                key={url}
                src={url}
                alt=""
                className="absolute inset-0 w-full h-full object-contain transition-opacity duration-300"
                style={{ opacity: hasTwo ? (i === frame ? 1 : 0) : 1 }}
              />
            ))}
          </div>
        </div>
      )}
    </>
  );
}
