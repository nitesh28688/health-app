// Core nutrition math. Pure functions — the single source of truth for all
// client-side calculations. DB stores everything per 100 g.

export interface FoodNutrients {
  kcal: number;
  protein_g: number;
  carbs_g: number;
  fat_g: number;
  fiber_g: number;
  // sparse micros, per 100 g (nulls dropped)
  [k: string]: number | null | undefined;
}

const MICRO_KEYS = [
  "sat_fat_g", "sugar_g", "cholesterol_mg", "sodium_mg", "potassium_mg",
  "calcium_mg", "iron_mg", "zinc_mg", "magnesium_mg", "phosphorus_mg",
  "vit_a_ug", "vit_c_mg", "vit_d_ug", "vit_b12_ug", "folate_ug",
] as const;

const r2 = (x: number) => Math.round(x * 100) / 100;

/** Snapshot for a food_logs insert: scale per-100g values to qty_g.
 *  Returns { kcal, protein_g, carbs_g, fat_g, fiber_g, micros } matching the table. */
export function logSnapshot(food: FoodNutrients, qtyG: number) {
  const f = qtyG / 100;
  const micros: Record<string, number> = {};
  for (const k of MICRO_KEYS) {
    const v = food[k];
    if (v !== null && v !== undefined) micros[k] = r2(v * f);
  }
  return {
    qty_g: qtyG,
    kcal: r2(food.kcal * f),
    protein_g: r2(food.protein_g * f),
    carbs_g: r2(food.carbs_g * f),
    fat_g: r2(food.fat_g * f),
    fiber_g: r2(food.fiber_g * f),
    micros,
  };
}

/** BMR via Mifflin-St Jeor (kcal/day). */
export function bmr(weightKg: number, heightCm: number, age: number, sex: "male" | "female" | "other") {
  const base = 10 * weightKg + 6.25 * heightCm - 5 * age;
  return Math.round(sex === "male" ? base + 5 : base - 161); // 'other' uses female formula
}

export const ACTIVITY_FACTORS = {
  sedentary: 1.2, light: 1.375, moderate: 1.55, active: 1.725, very_active: 1.9,
} as const;

/** Maintenance calories. Suggest target = tdee - 400 (fat loss) / + 300 (muscle gain). */
export function tdee(bmrKcal: number, activity: keyof typeof ACTIVITY_FACTORS) {
  return Math.round(bmrKcal * ACTIVITY_FACTORS[activity]);
}

export function ageFromBirthDate(birthDate: string): number {
  const b = new Date(birthDate);
  const now = new Date();
  let age = now.getFullYear() - b.getFullYear();
  if (now.getMonth() < b.getMonth() || (now.getMonth() === b.getMonth() && now.getDate() < b.getDate())) age--;
  return age;
}

export function bmi(weightKg: number, heightCm: number) {
  return Math.round((weightKg / Math.pow(heightCm / 100, 2)) * 10) / 10;
}

export function bmiCategory(v: number) {
  // WHO Asian-Indian cutoffs (lower than Western — appropriate for this audience)
  if (v < 18.5) return "Underweight";
  if (v < 23) return "Healthy";
  if (v < 25) return "Overweight";
  return "Obese";
}

/** Workout calorie estimate: MET formula. */
export function kcalBurned(met: number, weightKg: number, durationMin: number) {
  return Math.round(met * weightKg * (durationMin / 60));
}

/** Local calendar date as YYYY-MM-DD (never toISOString — that's UTC and
 *  shifts the date for IST users before 5:30 am). */
export function todayLocal(d = new Date()) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
