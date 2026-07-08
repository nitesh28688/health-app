// Admin: activity summary for one user (food/workout/water logs, streak-ish stats).
// Same admin-gate pattern as /api/admin/users.
import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

const admin = () =>
  createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { persistSession: false },
  });

export async function GET(req: NextRequest) {
  const jwt = req.headers.get("authorization")?.replace("Bearer ", "");
  const targetId = req.nextUrl.searchParams.get("id");
  if (!jwt || !targetId) return NextResponse.json({ error: "bad request" }, { status: 400 });

  const db = admin();
  const { data: userData } = await db.auth.getUser(jwt);
  if (!userData.user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const { data: caller } = await db.from("profiles").select("is_admin").eq("id", userData.user.id).single();
  if (!caller?.is_admin) return NextResponse.json({ error: "admin only" }, { status: 403 });

  const { data: authUser } = await db.auth.admin.getUserById(targetId);
  const { data: profile } = await db.from("profiles").select("*").eq("id", targetId).single();

  const [{ count: foodLogs }, { data: recentFood }, { count: workoutLogs }, { data: recentWorkout },
    { count: waterLogs }, { data: recentWeight }, { count: friendCount }] = await Promise.all([
    db.from("food_logs").select("id", { count: "exact", head: true }).eq("user_id", targetId),
    db.from("food_logs").select("log_date").eq("user_id", targetId).order("log_date", { ascending: false }).limit(1),
    db.from("workout_logs").select("id", { count: "exact", head: true }).eq("user_id", targetId),
    db.from("workout_logs").select("log_date").eq("user_id", targetId).order("log_date", { ascending: false }).limit(1),
    db.from("water_logs").select("id", { count: "exact", head: true }).eq("user_id", targetId),
    db.from("body_metrics").select("log_date,weight_kg").eq("user_id", targetId).order("log_date", { ascending: false }).limit(1),
    db.from("friendships").select("requester_id", { count: "exact", head: true })
      .eq("status", "accepted").or(`requester_id.eq.${targetId},addressee_id.eq.${targetId}`),
  ]);

  return NextResponse.json({
    id: targetId,
    email: authUser.user?.email,
    email_confirmed: !!authUser.user?.email_confirmed_at,
    created_at: authUser.user?.created_at,
    last_sign_in: authUser.user?.last_sign_in_at,
    profile,
    stats: {
      food_logs: foodLogs ?? 0,
      last_food_log: recentFood?.[0]?.log_date ?? null,
      workout_logs: workoutLogs ?? 0,
      last_workout: recentWorkout?.[0]?.log_date ?? null,
      water_logs: waterLogs ?? 0,
      last_weight: recentWeight?.[0] ?? null,
      friend_count: friendCount ?? 0,
    },
  });
}
