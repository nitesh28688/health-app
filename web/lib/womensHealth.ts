export const SYMPTOM_TAGS = [
  "cramps", "bloating", "acne", "headache", "mood swings", "fatigue",
  "tender breasts", "back pain", "nausea", "irregular cycle",
] as const;
export type SymptomTag = (typeof SYMPTOM_TAGS)[number];

export const CONDITIONS = [
  {
    key: "pcos",
    label: "PCOS",
    tips: [
      "Cycles can run long or unpredictable — logging every period (even partial ones) helps spot your actual pattern instead of relying on a 28-day assumption.",
      "Strength training and steady, lower-GI meals help more with PCOS symptom management than cardio alone — see Workout and Diary for logging both.",
      "Track acne and irregular-cycle tags together; a cluster of both across months is worth raising with a doctor.",
    ],
  },
  {
    key: "pcod",
    label: "PCOD",
    tips: [
      "Weight and waist trends (Trends tab) are a useful side-metric for PCOD alongside cycle logging.",
      "Consistent sleep and meal timing tend to steady PCOD cycles more than any single food — Diary's time-stamped logs can help you spot gaps.",
    ],
  },
  {
    key: "endometriosis",
    label: "Endometriosis",
    tips: [
      "Log pain severity via the cramps/back pain tags every cycle — a worsening trend over months is exactly what's useful to bring to a doctor.",
      "Heavy-flow days paired with severe cramps are worth flagging in the symptoms note field so you have specifics for an appointment.",
    ],
  },
  {
    key: "thyroid",
    label: "Thyroid condition",
    tips: [
      "Thyroid issues can shift cycle length and weight — the Weight chart and Cycle prediction together can help you notice a drift over a few months.",
    ],
  },
] as const;
export type ConditionKey = (typeof CONDITIONS)[number]["key"];
