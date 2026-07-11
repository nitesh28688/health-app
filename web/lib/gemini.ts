// Shared Gemini call with a model fallback chain.
//
// 2026-07-10: migrated primary path to Vertex AI (billed against the user's own GCP
// credit, project `health-app-502004`) so the app isn't capped by AI Studio's shared
// free-tier 20-requests/day/model/project quota (confirmed live 2026-07-09 — that cap
// is shared across every family member and every AI feature, not per-user). AI Studio
// (GEMINI_API_KEY) is kept as a final fallback tier for resilience if Vertex itself
// has an outage or the service account/billing ever breaks.
//
// Verified live against Vertex (2026-07-10) before wiring this in: gemini-2.5-flash
// and gemini-2.5-flash-lite both respond; gemini-2.0-flash(-001) and
// gemini-flash-latest — the old AI-Studio-era model IDs — 404 on Vertex, they don't
// exist as publisher models in this project/region. Also confirmed Vertex requires an
// explicit `role: "user"` on each contents entry (AI Studio defaults this silently,
// Vertex 400s without it), and that multimodal snake_case `inline_data`/`mime_type`
// fields work unchanged on Vertex — no changes needed in photo-estimate/route.ts.
//
// Per-model timeout: a 503 fails fast, but an overloaded model can also just hang
// without ever responding. Without a timeout that hang ate the caller's entire budget
// before the chain ever reached a healthy model. A timeout must be treated the same as
// a 503 (try the next model), not left to throw uncaught.
const VERTEX_MODEL_CHAIN = ["gemini-2.5-flash", "gemini-2.5-flash-lite"];
const AI_STUDIO_FALLBACK_CHAIN = ["gemini-2.5-flash", "gemini-flash-latest", "gemini-2.0-flash"];
const PER_MODEL_TIMEOUT_MS = 9000;

const GOOGLE_CLOUD_PROJECT = process.env.GOOGLE_CLOUD_PROJECT;
const GOOGLE_CLOUD_LOCATION = process.env.GOOGLE_CLOUD_LOCATION || "us-central1";

// Lazily constructed — avoids crashing module load if the service account env var
// isn't set (e.g. local dev without Vertex configured, falls straight to AI Studio).
let vertexAuth: import("google-auth-library").GoogleAuth | null = null;
function getVertexAuth() {
  if (!vertexAuth) {
    const { GoogleAuth } = require("google-auth-library");
    vertexAuth = new GoogleAuth({
      credentials: JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_JSON!),
      scopes: ["https://www.googleapis.com/auth/cloud-platform"],
    });
  }
  return vertexAuth!;
}

// Every call this app makes is a structured, single-shot task (nutrition
// estimates, tips, Smart Log parsing, tool selection) — none of them need
// Gemini 2.5's extended "thinking" reasoning mode, which is ON by default
// with a dynamic token budget unless explicitly disabled. Confirmed via a
// live billing SKU breakdown (2026-07-11): "Thinking" output-token SKUs were
// ~70% of this app's Vertex spend on their own, dwarfing plain text I/O.
// thinkingBudget: 0 turns it off on both 2.5 Flash and Flash Lite.
const NO_THINKING = { thinkingConfig: { thinkingBudget: 0 } };

async function callVertex(model: string, parts: object[], responseSchema: object | undefined, signal: AbortSignal) {
  const client = await getVertexAuth().getClient();
  const { token } = await client.getAccessToken();
  const url = `https://${GOOGLE_CLOUD_LOCATION}-aiplatform.googleapis.com/v1/projects/${GOOGLE_CLOUD_PROJECT}/locations/${GOOGLE_CLOUD_LOCATION}/publishers/google/models/${model}:generateContent`;
  return fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify({
      contents: [{ role: "user", parts }],
      generationConfig: {
        ...NO_THINKING,
        ...(responseSchema ? { responseMimeType: "application/json", responseSchema } : {}),
      },
    }),
    signal,
  });
}

async function callAiStudio(model: string, parts: object[], responseSchema: object | undefined, signal: AbortSignal) {
  return fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${process.env.GEMINI_API_KEY}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ parts }],
        generationConfig: {
          ...NO_THINKING,
          ...(responseSchema ? { responseMimeType: "application/json", responseSchema } : {}),
        },
      }),
      signal,
    }
  );
}

export async function generateWithFallback(parts: object[], responseSchema?: object, timeoutMs: number = PER_MODEL_TIMEOUT_MS) {
  const useVertex = !!process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
  const attempts: { model: string; call: (signal: AbortSignal) => Promise<Response> }[] = [];
  if (useVertex) {
    for (const model of VERTEX_MODEL_CHAIN) {
      attempts.push({ model, call: (signal) => callVertex(model, parts, responseSchema, signal) });
    }
  }
  for (const model of AI_STUDIO_FALLBACK_CHAIN) {
    attempts.push({ model, call: (signal) => callAiStudio(model, parts, responseSchema, signal) });
  }

  let lastStatus = 0;
  for (const { model, call } of attempts) {
    const controller = new AbortController();
    const killer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await call(controller.signal);
      if (res.ok) {
        console.log(`[Gemini] Model ${model} succeeded`);
        (res as any).selectedModel = model;
        return res;
      }
      lastStatus = res.status;
      // 503 = overloaded, 429 = quota exceeded, 404 = model not available on this
      // backend — all worth trying the next entry in the chain rather than failing
      // the whole request. Confirmed 2026-07-09: Gemini's free-tier quota is scoped
      // "PerProjectPerModel", not per-project-total, so one model being exhausted
      // says nothing about the others.
      if (res.status !== 503 && res.status !== 429 && res.status !== 404) return res;
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

async function callVertexChat(model: string, contents: object[], tools: object[] | undefined, systemInstruction: string | undefined, signal: AbortSignal) {
  const client = await getVertexAuth().getClient();
  const { token } = await client.getAccessToken();
  const url = `https://${GOOGLE_CLOUD_LOCATION}-aiplatform.googleapis.com/v1/projects/${GOOGLE_CLOUD_PROJECT}/locations/${GOOGLE_CLOUD_LOCATION}/publishers/google/models/${model}:generateContent`;
  return fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify({
      contents,
      generationConfig: NO_THINKING,
      ...(tools ? { tools } : {}),
      ...(systemInstruction ? { systemInstruction: { parts: [{ text: systemInstruction }] } } : {}),
    }),
    signal,
  });
}

async function callAiStudioChat(model: string, contents: object[], tools: object[] | undefined, systemInstruction: string | undefined, signal: AbortSignal) {
  return fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${process.env.GEMINI_API_KEY}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents,
        generationConfig: NO_THINKING,
        ...(tools ? { tools } : {}),
        ...(systemInstruction ? { systemInstruction: { parts: [{ text: systemInstruction }] } } : {}),
      }),
      signal,
    }
  );
}

export async function generateChatWithTools(contents: object[], tools?: object[], systemInstruction?: string) {
  const useVertex = !!process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
  const attempts: { model: string; call: (signal: AbortSignal) => Promise<Response> }[] = [];
  if (useVertex) {
    for (const model of VERTEX_MODEL_CHAIN) {
      attempts.push({ model, call: (signal) => callVertexChat(model, contents, tools, systemInstruction, signal) });
    }
  }
  for (const model of AI_STUDIO_FALLBACK_CHAIN) {
    attempts.push({ model, call: (signal) => callAiStudioChat(model, contents, tools, systemInstruction, signal) });
  }

  let lastStatus = 0;
  for (const { call } of attempts) {
    const controller = new AbortController();
    const killer = setTimeout(() => controller.abort(), PER_MODEL_TIMEOUT_MS);
    try {
      const res = await call(controller.signal);
      if (res.ok) return res;
      lastStatus = res.status;
      if (res.status !== 503 && res.status !== 429 && res.status !== 404) return res;
    } catch (e) {
      lastStatus = e instanceof DOMException && e.name === "AbortError" ? 504 : 599;
    } finally {
      clearTimeout(killer);
    }
  }
  return new Response(JSON.stringify({ error: `all models unavailable (last: ${lastStatus})` }), { status: 503 });
}
