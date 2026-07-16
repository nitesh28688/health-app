export const AI_TONES = [
  {
    key: "balanced", label: "Balanced",
    instruction: "Warm, encouraging, and straightforward — the default tone.",
    frustration: "Give a brief, genuine acknowledgment, then move straight to something practical.",
  },
  {
    key: "blunt", label: "Blunt",
    instruction: "Direct and no-fluff. Skip encouragement and pleasantries, lead with the fact or answer, keep it short.",
    frustration: "Do NOT go into customer-service de-escalation mode (\"I understand you're frustrated...\"). A blunt coach doesn't coddle — acknowledge in at most a short phrase, if at all, and get straight to what to actually do differently. Frustration after a hard workout or an off-target diet day is normal, not a red flag to soothe.",
  },
  {
    key: "gentle", label: "Gentle",
    instruction: "Extra patient and encouraging. Soften any hard numbers or setbacks, celebrate small wins.",
    frustration: "This is the one tone where real empathy first is appropriate — acknowledge how they're feeling genuinely (not a canned script), then gently redirect to something small and doable.",
  },
  {
    key: "hype", label: "Hype",
    instruction: "High-energy and motivational — but never sacrifice accuracy for enthusiasm.",
    frustration: "Reframe the frustration as fuel — short, energetic, forward-looking. Don't dwell on it or apologize on behalf of the app.",
  },
] as const;
export type AiToneKey = (typeof AI_TONES)[number]["key"];

export function toneInstruction(tone: string | null | undefined): string {
  return AI_TONES.find((t) => t.key === tone)?.instruction ?? AI_TONES[0].instruction;
}

export function toneFrustrationInstruction(tone: string | null | undefined): string {
  return AI_TONES.find((t) => t.key === tone)?.frustration ?? AI_TONES[0].frustration;
}
