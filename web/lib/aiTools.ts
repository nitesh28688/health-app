import { SupabaseClient } from "@supabase/supabase-js";

export const toolDeclarations = [
  {
    name: "get_daily_totals",
    description: "Get daily calorie and macro totals for a date range (YYYY-MM-DD)",
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
  }
];

export async function executeTool(name: string, args: any, db: SupabaseClient) {
  try {
    switch (name) {
      case "get_daily_totals": {
        const { data, error } = await db.rpc("get_daily_totals", { p_from: args.from_date, p_to: args.to_date });
        if (error) throw error;
        return data;
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
      default:
        return { error: `Unknown tool: ${name}` };
    }
  } catch (e: any) {
    return { error: e.message || String(e) };
  }
}
