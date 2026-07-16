export const AI_TONES = [
  { key: "balanced", label: "Balanced", instruction: "Warm, encouraging, and straightforward — the default tone." },
  { key: "blunt", label: "Blunt", instruction: "Direct and no-fluff. Skip encouragement and pleasantries, lead with the fact or answer, keep it short." },
  { key: "gentle", label: "Gentle", instruction: "Extra patient and encouraging. Soften any hard numbers or setbacks, celebrate small wins." },
  { key: "hype", label: "Hype", instruction: "High-energy and motivational — but never sacrifice accuracy for enthusiasm." },
] as const;
export type AiToneKey = (typeof AI_TONES)[number]["key"];

export function toneInstruction(tone: string | null | undefined): string {
  return AI_TONES.find((t) => t.key === tone)?.instruction ?? AI_TONES[0].instruction;
}
