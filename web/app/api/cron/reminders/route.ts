// Daily reminder push, triggered by Vercel Cron (see vercel.json).
// Vercel Hobby's cron only runs once/day, so this single job checks each
// subscribed user's actual activity today (food, water, medications) and
// sends ONE tailored nudge covering whatever's missing — never a blind
// broadcast, never a repeat if they're already done. More frequent or
// time-precise reminders (e.g. "take your 8am pill at 8am") would need a
// paid cron tier; this is a once-daily evening catch-all instead.
import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import webPush from "web-push";

webPush.setVapidDetails(
  "mailto:health@notify.linearventures.in",
  process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY!,
  process.env.VAPID_PRIVATE_KEY!
);

export async function GET(req: NextRequest) {
  const auth = req.headers.get("authorization");
  if (auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { persistSession: false },
  });

  const today = new Date().toISOString().slice(0, 10);
  const todayStart = `${today}T00:00:00Z`;
  const { data: subs } = await db.from("push_subscriptions").select("*");
  if (!subs?.length) return NextResponse.json({ sent: 0 });

  const userIds = [...new Set(subs.map((s) => s.user_id))];
  const [{ data: foodToday }, { data: waterToday }, { data: meds }, { data: medLogsToday }] = await Promise.all([
    db.from("food_logs").select("user_id").eq("log_date", today).in("user_id", userIds),
    db.from("water_logs").select("user_id").eq("log_date", today).in("user_id", userIds),
    db.from("medications").select("id,user_id,name").eq("active", true).in("user_id", userIds),
    db.from("medication_logs").select("medication_id").gte("taken_at", todayStart),
  ]);
  const loggedFood = new Set((foodToday ?? []).map((r) => r.user_id));
  const loggedWater = new Set((waterToday ?? []).map((r) => r.user_id));
  const takenMedIds = new Set((medLogsToday ?? []).map((r) => r.medication_id));
  const medsByUser = new Map<string, string[]>();
  for (const m of meds ?? []) {
    if (takenMedIds.has(m.id)) continue;
    medsByUser.set(m.user_id, [...(medsByUser.get(m.user_id) ?? []), m.name]);
  }

  let sent = 0;
  for (const userId of userIds) {
    const hasFood = loggedFood.has(userId);
    const hasWater = loggedWater.has(userId);
    const pendingMeds = medsByUser.get(userId) ?? [];
    if (hasFood && hasWater && pendingMeds.length === 0) continue; // already on top of things today

    const parts: string[] = [];
    if (!hasFood) parts.push("log today's meals");
    if (!hasWater) parts.push("drink some water");
    if (pendingMeds.length) parts.push(`take ${pendingMeds.join(", ")}`);
    const body = `Don't forget to ${parts.join(" and ")} 💚`;

    const userSubs = subs.filter((s) => s.user_id === userId);
    for (const s of userSubs) {
      try {
        await webPush.sendNotification(
          { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
          JSON.stringify({ title: "Health App", body, url: "/" })
        );
        sent++;
      } catch (err: unknown) {
        const statusCode = (err as { statusCode?: number }).statusCode;
        if (statusCode === 404 || statusCode === 410) {
          await db.from("push_subscriptions").delete().eq("id", s.id); // expired/revoked
        }
      }
    }
  }
  return NextResponse.json({ sent, users: userIds.length });
}
