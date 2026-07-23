// Uploads a client-compressed photo (profile avatar or before/after progress
// photo) to Cloudflare R2 (S3-compatible, genuinely free at this scale — no
// egress fees, 10GB storage on the free tier). Images arrive already resized/
// compressed by lib/imageCompress.ts; this route just stores bytes and never
// re-encodes, keeping it a thin, cheap proxy.
import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { S3Client, PutObjectCommand, DeleteObjectCommand } from "@aws-sdk/client-s3";

const r2 = () =>
  new S3Client({
    region: "auto",
    endpoint: `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
    credentials: {
      accessKeyId: process.env.R2_ACCESS_KEY_ID!,
      secretAccessKey: process.env.R2_SECRET_ACCESS_KEY!,
    },
  });

const admin = () =>
  createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { persistSession: false },
  });

export async function POST(req: NextRequest) {
  const jwt = req.headers.get("authorization")?.replace("Bearer ", "");
  if (!jwt) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const { imageDataUrl, kind, takenAt, note } = await req.json();
  if (typeof imageDataUrl !== "string" || !imageDataUrl.startsWith("data:image/")) {
    return NextResponse.json({ error: "bad image" }, { status: 400 });
  }
  if (kind !== "avatar" && kind !== "progress" && kind !== "wellness") {
    return NextResponse.json({ error: "bad kind" }, { status: 400 });
  }
  const match = imageDataUrl.match(/^data:(image\/\w+);base64,(.+)$/);
  if (!match) return NextResponse.json({ error: "bad image" }, { status: 400 });
  const [, mimeType, base64] = match;
  const buffer = Buffer.from(base64, "base64");
  if (buffer.length > 2_000_000) return NextResponse.json({ error: "image too large" }, { status: 413 });

  const db = admin();
  const { data: userData } = await db.auth.getUser(jwt);
  if (!userData.user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const userId = userData.user.id;
  const email = userData.user.email || "unknown";
  const safeEmail = email.replace(/[^a-zA-Z0-9@.\-_]/g, '');

  const ext = mimeType.split("/")[1] === "jpeg" ? "jpg" : mimeType.split("/")[1];
  const key = kind === "avatar"
    ? `avatars/${safeEmail}_${userId}.${ext}`
    : kind === "wellness"
    ? `wellness/${safeEmail}_${userId}/${Date.now()}.${ext}`
    : `progress/${safeEmail}_${userId}/${Date.now()}.${ext}`;

  await r2().send(new PutObjectCommand({
    Bucket: process.env.R2_BUCKET_NAME!,
    Key: key,
    Body: buffer,
    ContentType: mimeType,
    CacheControl: "public, max-age=31536000, immutable",
  }));

  const url = `${process.env.R2_PUBLIC_URL}/${key}`;

  if (kind === "avatar") {
    await db.from("profiles").update({ avatar_url: url }).eq("id", userId);
  } else if (kind === "progress") {
    await db.from("progress_photos").insert({
      user_id: userId, url, taken_at: takenAt || new Date().toISOString().slice(0, 10),
      note: note || null,
    });
  }
  return NextResponse.json({ ok: true, url });
}

export async function DELETE(req: NextRequest) {
  const jwt = req.headers.get("authorization")?.replace("Bearer ", "");
  if (!jwt) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const { id } = await req.json();

  const db = admin();
  const { data: userData } = await db.auth.getUser(jwt);
  if (!userData.user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const { data: photo } = await db.from("progress_photos").select("url,user_id").eq("id", id).single();
  if (!photo || photo.user_id !== userData.user.id) return NextResponse.json({ error: "not found" }, { status: 404 });

  const key = photo.url.replace(`${process.env.R2_PUBLIC_URL}/`, "");
  await r2().send(new DeleteObjectCommand({ Bucket: process.env.R2_BUCKET_NAME!, Key: key })).catch(() => {});
  await db.from("progress_photos").delete().eq("id", id);
  return NextResponse.json({ ok: true });
}
