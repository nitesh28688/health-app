// Seed natural household serving measures (katori/bowl/piece/...) for INDB foods
// that have none, via Gemini on Vertex AI. Modeled on seed-hindi-names.mjs:
// batched, idempotent (only foods with zero servings), resumable.
// Run: node scripts/seed-servings-ai.mjs [--limit N]
import fs from "node:fs";
import { createRequire } from "node:module";

const require = createRequire(new URL("../web/package.json", import.meta.url));
const { createClient } = require("@supabase/supabase-js");
const { GoogleAuth } = require("google-auth-library");

for (const line of fs.readFileSync(new URL("../web/.env.local", import.meta.url), "utf8").split("\n")) {
  const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
  if (m) process.env[m[1]] = m[2];
}

const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
const auth = new GoogleAuth({
  credentials: JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_JSON),
  scopes: ["https://www.googleapis.com/auth/cloud-platform"],
});
const project = process.env.GOOGLE_CLOUD_PROJECT;
const location = process.env.GOOGLE_CLOUD_LOCATION || "us-central1";

const limitArg = process.argv.indexOf("--limit");
const LIMIT = limitArg > -1 ? parseInt(process.argv[limitArg + 1]) : Infinity;
const BATCH = 30;

// Same fixed vocabulary enforced in the app's AI routes — keep in sync.
const VOCAB = ["piece", "slice", "katori", "bowl", "cup", "glass", "plate", "tbsp", "tsp", "scoop"];

const SCHEMA = {
  type: "array",
  items: {
    type: "object",
    properties: {
      i: { type: "integer" },
      servings: {
        type: "array",
        items: {
          type: "object",
          properties: {
            label: { type: "string", enum: VOCAB },
            grams: { type: "number" },
          },
          required: ["label", "grams"],
        },
      },
    },
    required: ["i", "servings"],
  },
};

async function callGemini(prompt) {
  const client = await auth.getClient();
  const { token } = await client.getAccessToken();
  const res = await fetch(
    `https://${location}-aiplatform.googleapis.com/v1/projects/${project}/locations/${location}/publishers/google/models/gemini-2.5-flash:generateContent`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({
        contents: [{ role: "user", parts: [{ text: prompt }] }],
        generationConfig: { responseMimeType: "application/json", responseSchema: SCHEMA },
      }),
    }
  );
  const data = await res.json();
  if (!data.candidates) throw new Error(`HTTP ${res.status}: ${JSON.stringify(data).slice(0, 300)}`);
  return JSON.parse(data.candidates[0].content.parts[0].text);
}

// Find INDB foods with zero servings
const foods = [];
for (let from = 0; ; from += 1000) {
  const { data, error } = await sb
    .from("foods")
    .select("id,name,kcal,is_liquid")
    .eq("source", "indb")
    .order("id")
    .range(from, from + 999);
  if (error) throw error;
  foods.push(...data);
  if (data.length < 1000) break;
}
const servedIds = new Set();
for (let from = 0; ; from += 1000) {
  const { data, error } = await sb.from("food_servings").select("food_id").order("id").range(from, from + 999);
  if (error) throw error;
  for (const r of data) servedIds.add(r.food_id);
  if (data.length < 1000) break;
}
let pending = foods.filter((f) => !servedIds.has(f.id));
console.log(`INDB foods: ${foods.length}, without servings: ${pending.length}`);
if (LIMIT !== Infinity) pending = pending.slice(0, LIMIT);

let inserted = 0;
for (let i = 0; i < pending.length; i += BATCH) {
  const batch = pending.slice(i, i + BATCH);
  const listing = batch
    .map((f, idx) => `${idx}. ${f.name}${f.is_liquid ? " (liquid)" : ""} — ${Math.round(f.kcal)} kcal/100g`)
    .join("\n");
  const prompt = `For each Indian food dish below, give 1-2 natural household serving measures with the typical weight in grams of ONE such serving, as the dish is normally served (cooked).
Allowed labels ONLY: ${VOCAB.join(", ")}.
Guidance: katori ≈ small Indian bowl (~150g cooked food); bowl ≈ 250g; glass ≈ 250ml; use "piece" for countable items (roti, idli, samosa...), "glass" or "cup" for liquids, "katori" for curries/dal/sabzi/rice dishes, "plate" for full plates like biryani or chaat.
Return one entry per input line with its index i. Foods:
${listing}`;

  try {
    const results = await callGemini(prompt);
    const rows = [];
    for (const r of results) {
      const food = batch[r.i];
      if (!food) continue;
      const seen = new Set();
      for (const s of (r.servings ?? []).slice(0, 2)) {
        if (!VOCAB.includes(s.label) || !(s.grams > 0 && s.grams <= 1000) || seen.has(s.label)) continue;
        seen.add(s.label);
        rows.push({ food_id: food.id, label: s.label, grams: s.grams });
      }
    }
    if (rows.length) {
      const { error } = await sb.from("food_servings").insert(rows);
      if (error) throw error;
      inserted += rows.length;
    }
    console.log(`Batch ${i / BATCH + 1}/${Math.ceil(pending.length / BATCH)}: +${rows.length} servings (sample: ${batch[0].name} -> ${JSON.stringify(results.find((x) => x.i === 0)?.servings)})`);
  } catch (e) {
    console.error(`Batch ${i / BATCH + 1} failed: ${e.message} — retry in 3s`);
    await new Promise((r) => setTimeout(r, 3000));
    i -= BATCH; // retry same batch
  }
}
console.log(`Done. Inserted ${inserted} servings.`);
