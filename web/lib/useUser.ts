"use client";
import { useEffect, useState } from "react";
import type { Session } from "@supabase/supabase-js";
import { supabase } from "./supabase";

export interface Profile {
  id: string;
  username: string | null;
  display_name: string | null;
  is_admin: boolean;
  height_cm: number | null;
  birth_date: string | null;
  sex: "male" | "female" | "other" | null;
  activity_level: string | null;
  target_kcal: number;
  target_protein: number;
  target_carbs: number;
  target_fat: number;
  target_fiber: number;
  target_water_ml: number;
  share_diary: boolean;
  share_weight: boolean;
  share_workouts: boolean;
  active_plan_id: number | null;
  phone: string | null;
  avatar_url: string | null;
  conditions: string[];
  ai_tone: string;
  ai_name: string | null;
  ai_name_wellness: string | null;
  diet_type: "balanced" | "high_protein" | "low_carb" | "keto" | "diabetic_friendly";
  target_weight_kg: number | null;
  terms_accepted_at: string | null;
  terms_version: string | null;
}

export function useUser() {
  const [session, setSession] = useState<Session | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      setLoading(false);
    });
    const { data: sub } = supabase.auth.onAuthStateChange((_e, s) => setSession(s));
    return () => sub.subscription.unsubscribe();
  }, []);

  const userId = session?.user?.id;
  useEffect(() => {
    // Keyed on user id, not the whole session object: Supabase fires
    // onAuthStateChange with a NEW session object on token refresh / tab
    // visibility changes even for the same logged-in user. Re-running this
    // effect on every such event was refetching the profile unnecessarily
    // and briefly nulling it (see below) on a real sign-out — this pattern
    // means neither happens for a same-user token refresh.
    if (!userId) { setProfile(null); return; }
    (async () => {
      const { data } = await supabase.from("profiles").select("*").eq("id", userId).single();
      // First login: copy username/display_name/phone from signup metadata into the profile row
      if (data && !data.username && session!.user.user_metadata?.username) {
        let username = session!.user.user_metadata.username as string;
        const patch = {
          username,
          display_name: (session!.user.user_metadata.display_name as string) ?? null,
          phone: (session!.user.user_metadata.phone as string) ?? null,
        };
        let { data: updated, error } = await supabase.from("profiles").update(patch)
          .eq("id", userId).select().single();
        // Username collision (race: two people picked the same handle at once).
        // Retry once with a short random suffix rather than silently pretending
        // the original name was saved.
        if (error?.code === "23505") {
          username = `${username}${Math.floor(1000 + Math.random() * 9000)}`;
          ({ data: updated, error } = await supabase.from("profiles")
            .update({ ...patch, username }).eq("id", userId).select().single());
        }
        setProfile(updated ?? (error ? data : { ...data, ...patch, username }));
      } else {
        setProfile(data);
      }
    })();
  }, [userId]); // eslint-disable-line react-hooks/exhaustive-deps

  return { session, profile, setProfile, loading };
}
