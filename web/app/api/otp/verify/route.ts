// Verify a WhatsApp OTP and mint a Supabase session (via admin magiclink token).
// Env: OTP_PEPPER, SUPABASE_SERVICE_ROLE_KEY
import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { createHash } from "crypto";

const MAX_ATTEMPTS = 5;

const admin = () =>
  createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { persistSession: false },
  });

export async function POST(req: NextRequest) {
  const { phone, code } = await req.json();
  if (typeof phone !== "string" || typeof code !== "string" || !/^\d{6}$/.test(code)) {
    return NextResponse.json({ error: "bad input" }, { status: 400 });
  }
  const db = admin();

  const { data: otp } = await db.from("wa_otps").select("*")
    .eq("phone", phone).order("created_at", { ascending: false }).limit(1).maybeSingle();
  if (!otp || new Date(otp.expires_at) < new Date()) {
    return NextResponse.json({ error: "Code expired — request a new one." }, { status: 400 });
  }
  if (otp.attempts >= MAX_ATTEMPTS) {
    return NextResponse.json({ error: "Too many wrong attempts — request a new code." }, { status: 429 });
  }
  await db.from("wa_otps").update({ attempts: otp.attempts + 1 }).eq("id", otp.id);

  const hash = createHash("sha256").update(code + process.env.OTP_PEPPER!).digest("hex");
  if (hash !== otp.code_hash) {
    return NextResponse.json({ error: "Wrong code." }, { status: 401 });
  }
  // burn the OTP
  await db.from("wa_otps").delete().eq("phone", phone);

  // find the user's email, mint a one-time login token
  const { data: prof } = await db.from("profiles").select("id").eq("phone", phone).single();
  const { data: userData, error: uErr } = await db.auth.admin.getUserById(prof!.id);
  if (uErr || !userData.user?.email) {
    return NextResponse.json({ error: "account lookup failed" }, { status: 500 });
  }
  const { data: link, error: lErr } = await db.auth.admin.generateLink({
    type: "magiclink", email: userData.user.email,
  });
  if (lErr || !link.properties?.hashed_token) {
    return NextResponse.json({ error: "session mint failed" }, { status: 500 });
  }
  // client exchanges this via supabase.auth.verifyOtp({ token_hash, type: 'magiclink' })
  return NextResponse.json({ token_hash: link.properties.hashed_token });
}
