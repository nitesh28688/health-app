// Same-origin proxy for R2-hosted wellness scan photos.
//
// html2canvas (PDF export) and any <canvas> draw of these photos needs to read
// pixel data, which the browser blocks for a cross-origin image unless the R2
// bucket sends CORS headers — Cloudflare R2 doesn't by default, and we don't
// control that without a bucket-config change. Proxying the bytes through our
// own origin sidesteps the CORS requirement entirely: same-origin images are
// always canvas-readable, no bucket config needed.
import { NextRequest, NextResponse } from "next/server";

export async function GET(req: NextRequest) {
  const url = req.nextUrl.searchParams.get("url");
  if (!url || !process.env.R2_PUBLIC_URL || !url.startsWith(process.env.R2_PUBLIC_URL)) {
    return NextResponse.json({ error: "invalid url" }, { status: 400 });
  }

  const upstream = await fetch(url);
  if (!upstream.ok || !upstream.body) {
    return NextResponse.json({ error: "fetch failed" }, { status: 502 });
  }

  return new NextResponse(upstream.body, {
    headers: {
      "Content-Type": upstream.headers.get("content-type") || "image/jpeg",
      "Cache-Control": "public, max-age=31536000, immutable",
    },
  });
}
