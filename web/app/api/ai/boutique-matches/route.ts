import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

const admin = () =>
  createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { persistSession: false },
  });

export async function POST(req: NextRequest) {
  const jwt = req.headers.get("authorization")?.replace("Bearer ", "");
  if (!jwt) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const db = admin();
  const { data: userData } = await db.auth.getUser(jwt);
  if (!userData.user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const userId = userData.user.id;

  try {
    const { data: cacheRow } = await db
      .from("wellness_discover_feed_cache")
      .select("boutique_matches")
      .eq("user_id", userId)
      .maybeSingle();

    const matches = cacheRow?.boutique_matches || [];

    return NextResponse.json({ matches });
  } catch (err: any) {
    console.error("Boutique Matches Error:", err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
