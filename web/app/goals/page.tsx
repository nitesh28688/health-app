"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { AppShell } from "../AppShell";
import { supabase } from "@/lib/supabase";
import { estimateGoalProgress, todayLocal } from "@/lib/nutrition";
import { PageSkeleton } from "@/lib/Skeleton";
import type { Profile } from "@/lib/useUser";
import { PartyPopper } from "lucide-react";

function Goals({ profile }: { profile: Profile }) {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [progress, setProgress] = useState<ReturnType<typeof estimateGoalProgress> | null>(null);

  useEffect(() => {
    if (!profile.target_weight_kg) {
      setLoading(false);
      return;
    }
    supabase.rpc("get_bmi_series", { p_from: "2000-01-01", p_to: todayLocal() })
      .then(({ data }) => {
        if (data) {
          setProgress(estimateGoalProgress(data as any, profile.target_weight_kg!));
        }
        setLoading(false);
      });
  }, [profile.target_weight_kg]);

  if (loading) return <PageSkeleton />;

  return (
    <main className="px-5 pt-6">
      <div className="flex items-center gap-3 mb-6">
        <button onClick={() => router.back()} aria-label="Back" className="w-11 h-11 rounded-full border border-neutral-200 dark:border-neutral-800 text-lg">←</button>
        <h1 className="text-2xl font-bold">Goal Progress</h1>
      </div>

      {!profile.target_weight_kg ? (
        <div className="text-center mt-10">
          <p className="text-neutral-500 mb-4">You haven't set a goal weight yet.</p>
          <button onClick={() => router.push("/profile")}
            className="rounded-xl bg-gradient-to-r from-indigo-600 to-violet-600 text-white shadow-md shadow-indigo-500/20 transition-all hover:shadow-lg hover:shadow-indigo-500/30 px-6 py-3 font-semibold active:scale-[0.98]">
            Set it in Profile
          </button>
        </div>
      ) : !progress ? (
        <div className="text-center mt-10 text-neutral-500">
          <p>Not enough check-ins yet to estimate progress.</p>
          <p className="text-sm mt-2">Log your weight a few more times to see your trajectory.</p>
        </div>
      ) : (
        <div className="flex flex-col gap-5">
          <div className="rounded-2xl border border-neutral-200/60 dark:border-neutral-800/60 bg-white/50 dark:bg-neutral-900/50 backdrop-blur-md shadow-sm p-5">
            <h2 className="text-lg font-bold mb-4">Current vs. Goal</h2>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <p className="text-sm text-neutral-500">Current</p>
                <p className="text-2xl font-bold">{progress.currentWeight} kg</p>
              </div>
              <div>
                <p className="text-sm text-neutral-500">Goal</p>
                <p className="text-2xl font-bold">{profile.target_weight_kg} kg</p>
              </div>
              <div>
                <p className="text-sm text-neutral-500">Change so far</p>
                <p className="text-xl font-medium">{Math.abs(progress.kgLost).toFixed(1)} kg {progress.kgLost > 0 ? "lost" : "gained"}</p>
              </div>
              <div>
                <p className="text-sm text-neutral-500">Remaining</p>
                <p className="text-xl font-medium">{Math.abs(progress.kgToGo).toFixed(1)} kg</p>
              </div>
            </div>
          </div>

          <div className="rounded-2xl border border-neutral-200/60 dark:border-neutral-800/60 bg-white/50 dark:bg-neutral-900/50 backdrop-blur-md shadow-sm p-5">
            <h2 className="text-lg font-bold mb-4">Projection</h2>
            {progress.reached ? (
              <p className="text-indigo-600 dark:text-indigo-400 font-bold text-lg flex items-center gap-2"><PartyPopper className="w-5 h-5" /> You've reached your goal!</p>
            ) : progress.estimatedDate ? (
              <>
                <p className="text-sm text-neutral-500 mb-1">Estimated date to reach goal:</p>
                <p className="text-2xl font-bold text-indigo-600 dark:text-indigo-400 mb-4">
                  {new Date(progress.estimatedDate + "T12:00:00").toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" })}
                </p>
                <p className="text-sm text-neutral-500">
                  Current rate: {Math.abs(progress.ratePerWeek).toFixed(2)} kg {progress.ratePerWeek > 0 ? "lost" : "gained"} per week
                </p>
              </>
            ) : (
              <p className="text-neutral-500">
                Your weight is currently trending away from your goal or plateauing.
                Keep checking in to update your projection.
              </p>
            )}
          </div>
        </div>
      )}
    </main>
  );
}

export default function GoalsPage() {
  return (
    <AppShell>
      {({ profile }) => profile ? <Goals profile={profile} /> : <PageSkeleton />}
    </AppShell>
  );
}
