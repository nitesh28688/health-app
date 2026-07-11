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

    // Use service role to bypass the RLS that prevents viewing pending request profiles
    const { data, error } = await supabaseAdmin
      .from("profiles")
      .select("id,username,display_name")
      .in("id", ids);

    if (error) {
      console.error("Error fetching profiles:", error);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json(data);
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 400 });
  }
}
