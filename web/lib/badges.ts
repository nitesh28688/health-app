export interface BadgeDef {
  code: string;
  name: string;
  description: string;
  icon: string;
}

export const BADGES: BadgeDef[] = [
  {
    code: "streak_7",
    name: "7-Day Streak",
    description: "Logged activity for 7 consecutive days.",
    icon: "🔥",
  },
  {
    code: "streak_30",
    name: "30-Day Streak",
    description: "Logged activity for 30 consecutive days.",
    icon: "☄️",
  },
  {
    code: "first_recipe",
    name: "First Recipe",
    description: "Created your first custom recipe.",
    icon: "👨‍🍳",
  },
  {
    code: "hydration_hero",
    name: "Hydration Hero",
    description: "Hit your daily water goal.",
    icon: "💧",
  },
  {
    code: "challenge_won",
    name: "Challenge Champion",
    description: "Won a group challenge.",
    icon: "🏆",
  },
  {
    code: "wellness_first_scan",
    name: "First Scan",
    description: "Completed your first Wellness scan.",
    icon: "✨",
  },
  {
    code: "wellness_full_spectrum",
    name: "Full Spectrum",
    description: "Scanned Skin, Eye, and Hair at least once.",
    icon: "🌈",
  },
  {
    code: "wellness_glow_up",
    name: "Glow Up",
    description: "Improved a Wellness score by 10+ points since your last scan.",
    icon: "📈",
  },
];

import { supabase } from "./supabase";

export async function awardBadge(userId: string, code: string) {
  // RLS (badges_insert) and PK constraint handles idempotency silently
  await supabase.from("user_badges").upsert(
    { user_id: userId, badge_code: code },
    { onConflict: "user_id,badge_code" }
  );
}
