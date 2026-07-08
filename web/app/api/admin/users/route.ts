// Admin user management. Uses the service-role key (bypasses RLS entirely) but
// only after verifying the CALLER is an admin via their own JWT — RLS on
// `profiles` stays untouched for everyone else. GET lists all users; DELETE
// removes one (cascades to all their data via FK on delete cascade).
import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

const admin = () =>
  createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { persistSession: false },
  });

async function requireAdmin(req: NextRequest) {
  const jwt = req.headers.get("authorization")?.replace("Bearer ", "");
  if (!jwt) return null;
  const db = admin();
  const { data: userData } = await db.auth.getUser(jwt);
  if (!userData.user) return null;
  const { data: prof } = await db.from("profiles").select("is_admin").eq("id", userData.user.id).single();
  return prof?.is_admin ? db : null;
}

export async function GET(req: NextRequest) {
  const db = await requireAdmin(req);
  if (!db) return NextResponse.json({ error: "admin only" }, { status: 403 });

  const { data: authUsers, error: authErr } = await db.auth.admin.listUsers({ perPage: 1000 });
  if (authErr) return NextResponse.json({ error: authErr.message }, { status: 500 });

  const { data: profiles } = await db.from("profiles")
    .select("id,username,display_name,phone,is_admin,target_kcal,active_plan_id,created_at");
  const byId = new Map((profiles ?? []).map((p) => [p.id, p]));

  const users = authUsers.users.map((u) => ({
    id: u.id,
    email: u.email,
    email_confirmed: !!u.email_confirmed_at,
    last_sign_in: u.last_sign_in_at,
    created_at: u.created_at,
    ...byId.get(u.id),
  }));
  return NextResponse.json({ users });
}

export async function DELETE(req: NextRequest) {
  const db = await requireAdmin(req);
  if (!db) return NextResponse.json({ error: "admin only" }, { status: 403 });
  const { id } = await req.json();
  if (!id) return NextResponse.json({ error: "missing id" }, { status: 400 });

  const { data: userData } = await db.auth.getUser(req.headers.get("authorization")!.replace("Bearer ", ""));
  if (userData.user?.id === id) return NextResponse.json({ error: "can't delete yourself" }, { status: 400 });

  const { error } = await db.auth.admin.deleteUser(id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
