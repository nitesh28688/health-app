// Shared Gemini call with a model fallback chain. "gemini-flash-latest" occasionally
// 503s under Google's "high demand" throttling (confirmed 2026-07-09) — falling back
// to pinned, separately-deployed model versions means a spike on the newest model
// doesn't take down AI logging entirely. All three are free-tier on the same
// GEMINI_API_KEY, no extra setup.
const MODEL_FALLBACK_CHAIN = ["gemini-flash-latest", "gemini-2.5-flash", "gemini-2.0-flash"];

export async function generateWithFallback(parts: object[], responseSchema?: object) {
  let lastStatus = 0;
  for (const model of MODEL_FALLBACK_CHAIN) {
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${process.env.GEMINI_API_KEY}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{ parts }],
          ...(responseSchema ? { generationConfig: { responseMimeType: "application/json", responseSchema } } : {}),
        }),
      }
    );
    if (res.ok) return res;
    lastStatus = res.status;
    // 503 = overloaded, worth trying the next model. Other errors (bad key, bad
    // request) will fail identically on every model — don't waste the retries.
    if (res.status !== 503) return res;
  }
  return new Response(JSON.stringify({ error: `all models unavailable (last: ${lastStatus})` }), { status: 503 });
}
