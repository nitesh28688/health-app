import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export async function POST(req: Request) {
  const authHeader = req.headers.get("Authorization");
  if (!authHeader) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const supabaseAdmin = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } }
  );

  const token = authHeader.replace("Bearer ", "");
  const { data: { user }, error: authErr } = await supabaseAdmin.auth.getUser(token);
  if (authErr || !user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  try {
    const { ids } = await req.json();
    if (!ids || !Array.isArray(ids) || ids.length === 0) {
      return NextResponse.json([]);
    }

    // This route uses the service role specifically to bypass the RLS that
    // hides pending-request profiles — it must not become an open profile
    // lookup. Only return profiles for ids that actually have a friendship
    // row (any status) connecting them to the authenticated caller.
    const { data: links, error: linkErr } = await supabaseAdmin
      .from("friendships")
      .select("requester_id,addressee_id")
      .or(`requester_id.eq.${user.id},addressee_id.eq.${user.id}`);

    if (linkErr) {
      console.error("Error checking friendship links:", linkErr);
      return NextResponse.json({ error: linkErr.message }, { status: 500 });
    }

    const allowedIds = new Set<string>();
    for (const l of links || []) {
      if (l.requester_id === user.id) allowedIds.add(l.addressee_id);
      if (l.addressee_id === user.id) allowedIds.add(l.requester_id);
    }
    const scopedIds = ids.filter((id: string) => allowedIds.has(id));
    if (scopedIds.length === 0) return NextResponse.json([]);

    const { data, error } = await supabaseAdmin
      .from("profiles")
      .select("id,username,display_name")
      .in("id", scopedIds);

    if (error) {
      console.error("Error fetching profiles:", error);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json(data);
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 400 });
  }
}
