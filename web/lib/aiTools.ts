import { SupabaseClient } from "@supabase/supabase-js";
import { generateWithFallback } from "@/lib/gemini";

export const toolDeclarations = [
  {
    name: "get_daily_totals",
    description: "Get daily calorie/macro totals for a date range (YYYY-MM-DD), plus a precomputed summary (totals, per-day averages, days logged vs days in range). Always use the summary's numbers for anything described as a weekly/period total or average — do not sum or average the daily rows yourself, the model is unreliable at that arithmetic.",
    parameters: {
      type: "OBJECT",
      properties: {
        from_date: { type: "STRING" },
        to_date: { type: "STRING" }
      },
      required: ["from_date", "to_date"]
    }
  },
  {
    name: "get_weight_history",
    description: "Get the user's weight, BMI, and waist measurement history",
    parameters: {
      type: "OBJECT",
      properties: {
        days_back: { type: "NUMBER", description: "Number of days of history to retrieve (e.g. 30, 90)" }
      },
      required: ["days_back"]
    }
  },
  {
    name: "get_streaks",
    description: "Get the user's current and longest streaks for food, workout, and water logging",
    parameters: { type: "OBJECT", properties: {} }
  },
  {
    name: "search_foods",
    description: "Search the food database by name or brand to see nutrition facts",
    parameters: {
      type: "OBJECT",
      properties: {
        query: { type: "STRING" }
      },
      required: ["query"]
    }
  },
  {
    name: "get_workout_history",
    description: "Get the user's logged workouts, including exercises, sets, reps, and weights for a given date range",
    parameters: {
      type: "OBJECT",
      properties: {
        from_date: { type: "STRING", description: "YYYY-MM-DD" },
        to_date: { type: "STRING", description: "YYYY-MM-DD" }
      },
      required: ["from_date", "to_date"]
    }
  },
  {
    name: "get_next_period_prediction",
    description: "Predict the start date of the user's next menstrual period, if they track it",
    parameters: { type: "OBJECT", properties: {} }
  },
  {
    name: "propose_repeat_workout",
    description: "Propose repeating a specific past workout for today. Calling this will ask the user to confirm copying that day's exercises, sets, and weights to today.",
    parameters: {
      type: "OBJECT",
      properties: {
        source_date: { type: "STRING", description: "The past date to copy the workout from (YYYY-MM-DD)" }
      },
      required: ["source_date"]
    }
  },
  {
    name: "suggest_workout",
    description: "Suggest a list of exercises for a live workout based on a requested focus or goal. This does not write to the database, but returns a workout structure.",
    parameters: {
      type: "OBJECT",
      properties: {
        focus: { type: "STRING", description: "Target muscle group or focus (e.g. 'chest and triceps', 'full body hiit')" }
      },
      required: ["focus"]
    }
  },
  {
    name: "check_form",
    description: "When the user asks to check, analyze, review, or get feedback on their exercise form or technique (e.g. 'check my squat form', 'is my deadlift form correct?'), propose opening the form-check video recorder. This does not call any AI itself — it proposes a UI action.",
    parameters: {
      type: "OBJECT",
      properties: {
        exercise_hint: { type: "STRING", description: "The exercise name the user mentioned, if any (e.g. 'squat', 'deadlift')" }
      }
    }
  },
  {
    name: "open_physio",
    description: "When the user describes a physical ache/pain and wants exercises or a routine to help (e.g. 'my knee hurts, what exercises can I do', 'help me with physio for my shoulder'), propose opening Physio Mode, which builds an AI-guided home exercise routine for the affected body area. This does not call any AI itself — it proposes a UI action.",
    parameters: {
      type: "OBJECT",
      properties: {
        body_area_hint: { type: "STRING", description: "The body area the user mentioned, if any (e.g. 'knee', 'shoulder')" }
      }
    }
  },
  {
    name: "get_physio_programs",
    description: "Get the user's physio/rehab programs (active and resolved), including body area, complaint, and session history with pain/difficulty trends. Use this to answer questions about their physio progress.",
    parameters: { type: "OBJECT", properties: {} }
  },
  {
    name: "get_wellness_scans",
    description: "Get the user's past Skin, Eye, or Hair AI wellness scans, including overall score, classification, sub-scores, observations, and ingredient recommendations. Use this to answer questions about their scan results, explain their report, or give more detailed analysis than what's shown on screen.",
    parameters: {
      type: "OBJECT",
      properties: {
        scan_type: { type: "STRING", description: "Filter to one type: 'skin', 'eye', or 'hair'. Omit to get the latest of each type." },
        limit: { type: "NUMBER", description: "How many scans to return, most recent first. Default 5." }
      }
    }
  },
  {
    name: "search_journal",
    description: "Search the user's wellness journal (time-stamped personal entries about treatments, skincare/hair events, habits, moods — e.g. 'laser hair removal', 'started retinol'). Use this whenever the user asks WHEN they did something, what they wrote about a topic, or to recall a past personal event. Returns matching entries with their date.",
    parameters: {
      type: "OBJECT",
      properties: {
        query: { type: "STRING", description: "Search words, e.g. 'laser' or 'retinol'" }
      },
      required: ["query"]
    }
  },
  {
    name: "get_recent_journal",
    description: "Get the user's most recent wellness journal entries (newest first). Use for questions like 'what have I been up to lately' or to ground companion-style conversation in what they've actually logged.",
    parameters: {
      type: "OBJECT",
      properties: {
        limit: { type: "NUMBER", description: "How many entries, default 10, max 30" }
      }
    }
  },
  {
    name: "get_products",
    description: "Get the user's skincare/haircare products (Products tab): each product's name, brand, type, key actives, personalized verdict (good_match/use_carefully/skip), usage time (am/pm), conflict warnings, expiry status, and status (active = currently on their shelf, finished = used up/removed previously). Defaults to active only. Use for 'what's on my shelf', 'which sunscreen do I own', 'can I use X with Y', recommending ingredients (so you don't suggest something they already own or that conflicts), AND for recalling past products ('what did I used to use', 'have I tried X before') — pass include_finished true for anything backward-looking.",
    parameters: {
      type: "OBJECT",
      properties: {
        include_finished: { type: "BOOLEAN", description: "Include products marked finished/removed, not just the current active shelf. Default false." }
      }
    }
  },
  {
    name: "get_wellness_trend",
    description: "Get the score history over time for a specific wellness scan type, to describe whether the user's skin, eye, or hair score is improving, worsening, or stable.",
    parameters: {
      type: "OBJECT",
      properties: {
        scan_type: { type: "STRING", description: "'skin', 'eye', or 'hair'" }
      },
      required: ["scan_type"]
    }
  }
];

export async function executeTool(name: string, args: any, db: SupabaseClient) {
  try {
    switch (name) {
      case "get_daily_totals": {
        const { data, error } = await db.rpc("get_daily_totals", { p_from: args.from_date, p_to: args.to_date });
        if (error) throw error;
        const rows = (data as { log_date: string; kcal: number; protein_g: number; carbs_g: number; fat_g: number; water_ml: number; kcal_burned: number }[]) ?? [];
        const daysInRange = Math.round((new Date(args.to_date).getTime() - new Date(args.from_date).getTime()) / 86400000) + 1;
        const loggedRows = rows.filter((r) => Number(r.kcal) > 0);
        const sum = (key: keyof typeof rows[number]) => rows.reduce((s, r) => s + Number(r[key] ?? 0), 0);
        const round = (n: number) => Math.round(n * 10) / 10;
        const totals = { kcal: sum("kcal"), protein_g: sum("protein_g"), carbs_g: sum("carbs_g"), fat_g: sum("fat_g"), water_ml: sum("water_ml"), kcal_burned: sum("kcal_burned") };
        return {
          daily_rows: rows,
          summary: {
            days_in_range: daysInRange,
            days_logged: loggedRows.length,
            totals,
            avg_per_day_in_range: Object.fromEntries(Object.entries(totals).map(([k, v]) => [k, round(v / daysInRange)])),
            avg_per_logged_day: loggedRows.length > 0
              ? Object.fromEntries(Object.entries(totals).map(([k, v]) => [k, round(v / loggedRows.length)]))
              : null,
          },
        };
      }
      case "get_weight_history": {
        const p_to = new Date().toISOString().slice(0, 10);
        const p_from = new Date(Date.now() - (args.days_back || 30) * 86400000).toISOString().slice(0, 10);
        const { data, error } = await db.rpc("get_bmi_series", { p_from, p_to });
        if (error) throw error;
        return data;
      }
      case "get_streaks": {
        const { data, error } = await db.rpc("get_streaks");
        if (error) throw error;
        return data;
      }
      case "search_foods": {
        const { data, error } = await db.rpc("search_foods", { q: args.query });
        if (error) throw error;
        return data;
      }
      case "get_workout_history": {
        const { data, error } = await db
          .from("workout_logs")
          .select(`
            id, log_date, title, duration_min, kcal_burned, notes,
            workout_log_exercises(
              id, sort_order,
              exercises(name, category, primary_muscle),
              workout_log_sets(set_number, reps, weight_kg, duration_sec)
            )
          `)
          .gte("log_date", args.from_date)
          .lte("log_date", args.to_date)
          .order("log_date", { ascending: false });
        if (error) throw error;
        return data;
      }
      case "get_next_period_prediction": {
        const { data, error } = await db.rpc("predict_next_period");
        if (error) throw error;
        return data;
      }
      case "propose_repeat_workout": {
        const { data, error } = await db
          .from("workout_logs")
          .select(`
            id, log_date, title, duration_min, kcal_burned,
            workout_log_exercises(
              id, sort_order,
              exercises(id, name, category, primary_muscle, met_value),
              workout_log_sets(set_number, reps, weight_kg, duration_sec)
            )
          `)
          .eq("log_date", args.source_date)
          .order("id", { ascending: false })
          .limit(1)
          .maybeSingle();
        if (error) throw error;
        if (!data) return { error: `No workout found on ${args.source_date}` };
        
        return { 
          success: true, 
          message: `Proposed workout from ${args.source_date} to the user. Waiting for confirmation.`,
          proposalData: data 
        };
      }
      case "suggest_workout": {
        const prompt = `Act as an expert personal trainer. Generate a highly effective workout routine based on:
Target Focus: ${args.focus}

Return a strict JSON object containing:
- title: A catchy name for this routine (e.g. "30 Min Kettlebell Shred")
- exercises: An array of exercises in the order they should be performed. For each:
  - name: Exercise name
  - met_value: Estimated MET value (3.0 to 8.0)
  - instructions: 1-2 short sentences on form
  - sets: Number of sets (number)
  - reps: Reps per set (number, optional if it's duration based)
  - duration_min: Duration in minutes (number, optional if it's rep based)
`;
        const res = await generateWithFallback([{ text: prompt }], {
          type: "OBJECT",
          properties: {
            title: { type: "STRING" },
            exercises: {
              type: "ARRAY",
              items: {
                type: "OBJECT",
                properties: {
                  name: { type: "STRING" },
                  met_value: { type: "NUMBER" },
                  instructions: { type: "STRING" },
                  sets: { type: "NUMBER" },
                  reps: { type: "NUMBER" },
                  duration_min: { type: "NUMBER" },
                },
                required: ["name", "met_value", "instructions", "sets"],
              },
            },
          },
          required: ["title", "exercises"],
        });

        if (!res.ok) throw new Error("AI unavailable");
        const body = await res.json();
        try {
          const result = JSON.parse(body.candidates[0].content.parts[0].text);
          return result;
        } catch {
          throw new Error("AI returned invalid data");
        }
      }
      case "check_form": {
        return {
          success: true,
          message: "Opening the form check camera for you.",
          proposalData: { exercise_hint: args.exercise_hint || "" }
        };
      }
      case "open_physio": {
        return {
          success: true,
          message: "Opening Physio for you.",
          proposalData: { body_area_hint: args.body_area_hint || "" }
        };
      }
      case "get_physio_programs": {
        const { data, error } = await db
          .from("physio_programs")
          .select("id, body_area, complaint, status, created_at, last_session_at, physio_program_sessions(session_number, pain_before, pain_after, difficulty, completed_at)")
          .order("last_session_at", { ascending: false, nullsFirst: false });
        if (error) throw error;
        if (!data?.length) return { message: "No physio programs started yet." };
        return data;
      }
      case "get_wellness_scans": {
        let query = db
          .from("wellness_scans")
          .select("scan_type, taken_at, is_usable, overall_score, classification, sub_scores, observations, recommendations")
          .eq("is_usable", true)
          .order("taken_at", { ascending: false })
          .limit(args.limit || 5);
        if (args.scan_type) query = query.eq("scan_type", args.scan_type);
        const { data, error } = await query;
        if (error) throw error;
        if (!data?.length) return { message: "No usable wellness scans found yet." };
        return data;
      }
      case "search_journal": {
        if (!args.query) return { error: "query is required" };
        const { data, error } = await db.rpc("search_journal", { q: String(args.query) });
        if (error) throw error;
        if (!data?.length) return { message: `No journal entries found matching "${args.query}".` };
        return (data as any[]).map((e) => ({
          entry_at: e.entry_at, entry_text: e.entry_text, category: e.category, tags: e.tags,
        }));
      }
      case "get_recent_journal": {
        const { data, error } = await db
          .from("wellness_journal")
          .select("entry_at, entry_text, category, tags")
          .order("entry_at", { ascending: false })
          .limit(Math.min(Number(args.limit) || 10, 30));
        if (error) throw error;
        if (!data?.length) return { message: "No journal entries yet." };
        return data;
      }
      case "get_products": {
        let query = db
          .from("wellness_products")
          .select("name, brand, product_type, key_actives, verdict, verdict_reason, usage_time, conflicts, pao_months, opened_at, status, created_at")
          .order("created_at", { ascending: false })
          .limit(40);
        if (!args.include_finished) query = query.eq("status", "active");
        const { data, error } = await query;
        if (error) throw error;
        if (!data?.length) return { message: "No products found — they can add one from the Products tab." };
        return data;
      }
      case "get_wellness_trend": {
        if (!args.scan_type) return { error: "scan_type is required" };
        const { data, error } = await db
          .from("wellness_scans")
          .select("taken_at, overall_score")
          .eq("scan_type", args.scan_type)
          .eq("is_usable", true)
          .not("overall_score", "is", null)
          .order("taken_at", { ascending: true });
        if (error) throw error;
        if (!data?.length) return { message: `No usable ${args.scan_type} scans found yet.` };
        return data;
      }
      default:
        return { error: `Unknown tool: ${name}` };
    }
  } catch (e: any) {
    return { error: e.message || String(e) };
  }
}
