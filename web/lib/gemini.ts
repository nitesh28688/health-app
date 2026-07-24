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
const VERTEX_MODEL_CHAIN = ["gemini-2.5-flash-lite", "gemini-2.5-flash"];
const AI_STUDIO_FALLBACK_CHAIN = ["gemini-2.5-flash-lite", "gemini-2.5-flash", "gemini-flash-latest", "gemini-2.0-flash"];
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

// text-embedding-004 outputs 768-dim vectors on both Vertex and AI Studio —
// matches the `vector(768)` column on wellness_journal.embedding. Best-effort:
// returns null on any failure so a Gemini outage never blocks saving a journal
// entry (embedding is a search-quality enhancement, not required data).
export async function generateEmbedding(text: string): Promise<number[] | null> {
  const useVertex = !!process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
  try {
    if (useVertex) {
      const client = await getVertexAuth().getClient();
      const { token } = await client.getAccessToken();
      const url = `https://${GOOGLE_CLOUD_LOCATION}-aiplatform.googleapis.com/v1/projects/${GOOGLE_CLOUD_PROJECT}/locations/${GOOGLE_CLOUD_LOCATION}/publishers/google/models/text-embedding-004:predict`;
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ instances: [{ content: text }] }),
      });
      if (!res.ok) throw new Error(`vertex embed ${res.status}`);
      const body = await res.json();
      const values = body?.predictions?.[0]?.embeddings?.values;
      return Array.isArray(values) ? values : null;
    }
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/text-embedding-004:embedContent?key=${process.env.GEMINI_API_KEY}`,
      { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ content: { parts: [{ text }] } }) }
    );
    if (!res.ok) throw new Error(`ai studio embed ${res.status}`);
    const body = await res.json();
    const values = body?.embedding?.values;
    return Array.isArray(values) ? values : null;
  } catch {
    return null;
  }
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

// Best-effort Google Search grounding for a plain-text lookup (no response
// schema — grounding + forced JSON mode isn't reliable together). Used to
// look up real-world facts (e.g. a mainstream product's actual ingredient
// list) the model wouldn't otherwise know from training data alone. Returns
// null on any failure so callers can fall back to ungrounded behavior.
//
// Pairs google_search (find the right page) with url_context (actually fetch
// and read that page's full content, not just the search snippet) — a brand's
// full INCI list is often tucked inside a hidden tab/accordion on the product
// page that a search snippet alone won't surface, but is present in the
// static HTML and readable once the model fetches the page directly.
export async function searchGrounded(prompt: string): Promise<string | null> {
  try {
    // We intentionally bypass VERTEX_MODEL_CHAIN here and hardcode gemini-2.5-flash.
    // flash-lite struggles to follow the strict JSON formatting instructions when 
    // combined with the Search Grounding tool, resulting in parse errors.
    const contents = [{ role: "user", parts: [{ text: prompt }] }];
    const tools = [{ googleSearch: {} }, { url_context: {} }];
    
    let res = null;
    if (!!process.env.GOOGLE_SERVICE_ACCOUNT_JSON) {
      const controller = new AbortController();
      const killer = setTimeout(() => controller.abort(), PER_MODEL_TIMEOUT_MS);
      try {
        res = await callVertexChat("gemini-2.5-flash", contents, tools, undefined, controller.signal);
      } finally {
        clearTimeout(killer);
      }
    }
    
    // Fallback to AI Studio if Vertex fails or is unconfigured
    if (!res || !res.ok) {
      const controller = new AbortController();
      const killer = setTimeout(() => controller.abort(), PER_MODEL_TIMEOUT_MS);
      try {
        res = await callAiStudioChat("gemini-2.5-flash", contents, tools, undefined, controller.signal);
      } finally {
        clearTimeout(killer);
      }
    }

    if (!res || !res.ok) {
      console.error("[searchGrounded] API Error:", res?.status);
      return null;
    }
    const body = await res.json();
    const text = body?.candidates?.[0]?.content?.parts?.map((p: any) => p.text).filter(Boolean).join(" ");
    return text?.trim() || null;
  } catch {
    return null;
  }
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
