// Send a WhatsApp OTP via Meta Cloud API (Nanoliss WABA).
// Env: META_WA_TOKEN, META_PHONE_NUMBER_ID, META_APP_SECRET, OTP_PEPPER, SUPABASE_SERVICE_ROLE_KEY
import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { createHash, createHmac, randomInt } from "crypto";

const TEMPLATE = "health_otp";
const OTP_TTL_MIN = 10;
const MAX_SENDS_PER_HOUR = 3;

const admin = () =>
  createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { persistSession: false },
  });

export async function POST(req: NextRequest) {
  const { phone } = await req.json();
  if (typeof phone !== "string" || !/^\+[1-9][0-9]{7,14}$/.test(phone)) {
    return NextResponse.json({ error: "Enter phone as +91XXXXXXXXXX" }, { status: 400 });
  }
  const db = admin();

  // phone must belong to a registered user (set in Profile) — prevents spraying strangers
  const { data: prof } = await db.from("profiles").select("id").eq("phone", phone).maybeSingle();
  if (!prof) {
    return NextResponse.json(
      { error: "No account with this number. Sign in with email once and add your phone in Profile." },
      { status: 404 });
  }

  // rate limit per phone
  const hourAgo = new Date(Date.now() - 3600_000).toISOString();
  const { count } = await db.from("wa_otps").select("id", { count: "exact", head: true })
    .eq("phone", phone).gte("created_at", hourAgo);
  if ((count ?? 0) >= MAX_SENDS_PER_HOUR) {
    return NextResponse.json({ error: "Too many codes requested — try again in an hour." }, { status: 429 });
  }

  const code = String(randomInt(100000, 1000000));
  const codeHash = createHash("sha256").update(code + process.env.OTP_PEPPER!).digest("hex");
  await db.from("wa_otps").insert({
    phone, code_hash: codeHash,
    expires_at: new Date(Date.now() + OTP_TTL_MIN * 60_000).toISOString(),
  });

  const token = process.env.META_WA_TOKEN!;
  const proof = createHmac("sha256", process.env.META_APP_SECRET!).update(token).digest("hex");
  const res = await fetch(
    `https://graph.facebook.com/v21.0/${process.env.META_PHONE_NUMBER_ID}/messages?appsecret_proof=${proof}`,
    {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        messaging_product: "whatsapp",
        to: phone.slice(1), // Graph API wants no '+'
        type: "template",
        template: {
          name: TEMPLATE,
          language: { code: "en" },
          components: [
            { type: "body", parameters: [{ type: "text", text: code }] },
            { type: "button", sub_type: "url", index: "0", parameters: [{ type: "text", text: code }] },
          ],
        },
      }),
    });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    console.error("WA send failed", JSON.stringify(err));
    return NextResponse.json({ error: "WhatsApp send failed — try the email link instead." }, { status: 502 });
  }
  return NextResponse.json({ ok: true, ttl_min: OTP_TTL_MIN });
}
