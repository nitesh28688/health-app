// Shared Gemini call with a model fallback chain. "gemini-flash-latest" occasionally
// 503s under Google's "high demand" throttling (confirmed 2026-07-09) — falling back
// to pinned, separately-deployed model versions means a spike on the newest model
// doesn't take down AI logging entirely. All three are free-tier on the same
// GEMINI_API_KEY, no extra setup.
//
// Per-model timeout (2026-07-09): a 503 fails fast, but an overloaded model can also
// just hang without ever responding — confirmed "keeps waiting, then falls back to
// 2.5" on gemini-flash-latest. Without a timeout that hang ate the caller's entire
// budget before the chain ever reached a healthy model. 9s/model keeps 3 attempts
// under the client's 30s abort (app/add/page.tsx) with room to spare. A timeout must
// be treated the same as a 503 (try the next model), not left to throw uncaught.
const MODEL_FALLBACK_CHAIN = ["gemini-flash-latest", "gemini-2.5-flash", "gemini-2.0-flash"];
const PER_MODEL_TIMEOUT_MS = 9000;

export async function generateWithFallback(parts: object[], responseSchema?: object) {
  let lastStatus = 0;
  for (const model of MODEL_FALLBACK_CHAIN) {
    const controller = new AbortController();
    const killer = setTimeout(() => controller.abort(), PER_MODEL_TIMEOUT_MS);
    try {
      const res = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${process.env.GEMINI_API_KEY}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            contents: [{ parts }],
            ...(responseSchema ? { generationConfig: { responseMimeType: "application/json", responseSchema } } : {}),
          }),
          signal: controller.signal,
        }
      );
      if (res.ok) return res;
      lastStatus = res.status;
      // 503 = overloaded, worth trying the next model. Other errors (bad key, bad
      // request) will fail identically on every model — don't waste the retries.
      if (res.status !== 503) return res;
    } catch (e) {
      // Timeout (our own abort) or a network-level failure — same treatment as a
      // 503: this model isn't answering, move on to the next one in the chain.
      lastStatus = e instanceof DOMException && e.name === "AbortError" ? 504 : 599;
    } finally {
      clearTimeout(killer);
    }
  }
  return new Response(JSON.stringify({ error: `all models unavailable (last: ${lastStatus})` }), { status: 503 });
}
