"use client";

/** Resize + JPEG-compress an image file client-side before it ever leaves the
 *  device — keeps uploads small and cheap regardless of the source photo's
 *  resolution. Returns a base64 data URL (small enough to POST as JSON). */
export async function compressImage(file: File, maxDim = 1024, quality = 0.7): Promise<string> {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, maxDim / Math.max(bitmap.width, bitmap.height));
  const w = Math.round(bitmap.width * scale);
  const h = Math.round(bitmap.height * scale);

  const canvas = document.createElement("canvas");
  canvas.width = w; canvas.height = h;
  const ctx = canvas.getContext("2d")!;
  ctx.drawImage(bitmap, 0, 0, w, h);

  return new Promise((resolve) => {
    canvas.toBlob(
      (blob) => {
        const reader = new FileReader();
        reader.onloadend = () => resolve(reader.result as string);
        reader.readAsDataURL(blob!);
      },
      "image/jpeg",
      quality
    );
  });
}
