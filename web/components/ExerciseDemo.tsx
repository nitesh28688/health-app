"use client";
import { useEffect, useState } from "react";

// Two real photos per exercise (start/end position, from the public-domain
// free-exercise-db seed — see scripts/seed-exercise-images.mjs), not a true
// video. Crossfading between them on a loop reads as a simple animated demo
// without needing real video or a paid GIF API. Renders nothing if the
// exercise has no images (yoga poses and user/AI-added custom exercises
// don't have a source photo) — callers don't need to check first.
export function ExerciseDemo({ urls, size = 56 }: { urls: string[] | null | undefined; size?: number }) {
  const [frame, setFrame] = useState(0);
  const hasTwo = urls && urls.length >= 2;

  useEffect(() => {
    if (!hasTwo) return;
    const t = setInterval(() => setFrame((f) => (f === 0 ? 1 : 0)), 900);
    return () => clearInterval(t);
  }, [hasTwo]);

  if (!urls || urls.length === 0) return null;

  return (
    <div className="relative shrink-0 rounded-lg overflow-hidden bg-neutral-100 dark:bg-neutral-800" style={{ width: size, height: size }}>
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
    </div>
  );
}
