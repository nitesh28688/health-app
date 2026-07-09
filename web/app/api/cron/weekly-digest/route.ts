import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export async function GET(req: NextRequest) {
  const auth = req.headers.get("authorization");
  if (auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { persistSession: false },
  });

  // Calculate past 7 days
  const today = new Date();
  const todayStr = today.toISOString().slice(0, 10);
  const lastWeek = new Date(today);
  lastWeek.setDate(today.getDate() - 7);
  const lastWeekStr = lastWeek.toISOString().slice(0, 10);

  const brevoKey = process.env.BREVO_API_KEY;

  if (!brevoKey) {
    console.log("Skipping weekly digest send: BREVO_API_KEY is not set.");
  }

  // Get all users who have an email (auth.users)
  // We'll need to join or fetch profiles and then emails.
  // Actually, auth.users is only accessible via supabase admin API or direct sql if we had an RPC, 
  // but we have service_role key, so we can use supabase.auth.admin.listUsers()
  
  const { data: usersData, error } = await db.auth.admin.listUsers();
  if (error || !usersData?.users) {
    return NextResponse.json({ error: "failed to fetch users" }, { status: 500 });
  }

  const results = [];
  let sent = 0;

  for (const user of usersData.users) {
    if (!user.email) continue;

    // Fetch weekly totals
    const { data: totalsData } = await db.rpc("get_daily_totals", { p_from: lastWeekStr, p_to: todayStr })
      // RPC uses auth.uid() usually! Wait, get_daily_totals is:
      // "where user_id = auth.uid()", since it's a security invoker function?
      // Let's check how we can fetch it for a specific user using service role.
      // If get_daily_totals is tied to auth.uid(), we can't call it easily without switching roles or calling a different RPC.
      // Instead, we can just select directly from food_logs and workout logs since we are service_role and bypass RLS.
      
    const [ { data: foods }, { count: workoutDays }, { data: weightLogs } ] = await Promise.all([
      db.from("food_logs").select("log_date, kcal, protein_g").eq("user_id", user.id).gte("log_date", lastWeekStr).lte("log_date", todayStr),
      db.from("workout_logs").select("log_date", { count: 'exact', head: true }).eq("user_id", user.id).gte("log_date", lastWeekStr).lte("log_date", todayStr),
      db.from("body_metrics").select("weight_kg, log_date").eq("user_id", user.id).gte("log_date", lastWeekStr).lte("log_date", todayStr).order("log_date", { ascending: true })
    ]);

    const activeDays = new Set((foods || []).map(f => f.log_date)).size;
    if (activeDays === 0 && workoutDays === 0) continue; // Inactive user

    const tKcal = (foods || []).reduce((s, f) => s + Number(f.kcal), 0);
    const avgKcal = activeDays > 0 ? Math.round(tKcal / activeDays) : 0;
    
    let weightDiff = "";
    if (weightLogs && weightLogs.length >= 2) {
      const first = weightLogs[0].weight_kg;
      const last = weightLogs[weightLogs.length - 1].weight_kg;
      const diff = last - first;
      weightDiff = `Weight change: ${diff > 0 ? "+" : ""}${diff.toFixed(1)}kg`;
    }

    const emailHtml = `
      <h2>Your Weekly Health Digest</h2>
      <p>Here's a look at your past week (${lastWeekStr} to ${todayStr}):</p>
      <ul>
        <li>Days logged: ${activeDays}/7</li>
        <li>Average daily calories: ${avgKcal} kcal</li>
        <li>Workouts completed: ${workoutDays}</li>
        ${weightDiff ? `<li>${weightDiff}</li>` : ""}
      </ul>
      <p>Keep up the great work!</p>
    `;

    results.push({ email: user.email, activeDays });

    if (brevoKey) {
      try {
        const res = await fetch("https://api.brevo.com/v3/smtp/email", {
          method: "POST",
          headers: {
            "api-key": brevoKey,
            "Content-Type": "application/json",
            "accept": "application/json"
          },
          body: JSON.stringify({
            sender: { name: "Health App", email: "health@notify.linearventures.in" },
            to: [{ email: user.email }],
            subject: "Your Weekly Health Digest",
            htmlContent: emailHtml
          })
        });
        if (res.ok) sent++;
        else console.error(`Failed to send email to ${user.email}`, await res.text());
      } catch (err) {
        console.error(`Error sending email to ${user.email}`, err);
      }
    }
  }

  return NextResponse.json({
    status: brevoKey ? "sent" : "skipped_missing_credential",
    sent,
    processed: results.length
  });
}
