// Shared Gemini call with a model fallback chain, all free-tier on the same
// GEMINI_API_KEY, no extra setup.
//
// gemini-2.5-flash goes first (2026-07-09): confirmed live that gemini-flash-latest
// (Google's rolling "newest" alias) is genuinely flaky — 2 of 3 test calls hung with
// no response at all, 1 succeeded in 5.8s — while gemini-2.5-flash answered in ~2s
// on 3 of 3 calls. Nutrition estimation doesn't need the newest model, it needs a
// reliable one; "latest" is now the fallback instead of the first attempt, kept
// around for whenever it's actually up. gemini-2.0-flash is the last-resort fallback.
//
// Per-model timeout: a 503 fails fast, but an overloaded model can also just hang
// without ever responding. Without a timeout that hang ate the caller's entire budget
// before the chain ever reached a healthy model. 9s/model keeps 3 attempts under the
// client's 30s abort (app/add/page.tsx) with room to spare. A timeout must be treated
// the same as a 503 (try the next model), not left to throw uncaught.
const MODEL_FALLBACK_CHAIN = ["gemini-2.5-flash", "gemini-flash-latest", "gemini-2.0-flash"];
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
