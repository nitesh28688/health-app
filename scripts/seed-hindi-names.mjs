// Seed foods.name_local (Hindi/regional name) for INDB foods that lack one.
// Uses Vertex AI (2026-07-10: switched from AI Studio, which kept hitting its
// shared 20/day/model quota and stalled this script repeatedly) via
// supabase-js (2026-07-10: switched from a raw pg connection string — no
// SEED_DB_URL needed, matches the pattern used by seed-servings-ai.mjs).
// Idempotent (WHERE name_local IS NULL), resumable, safe to rerun.
// Run: node scripts/seed-hindi-names.mjs
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

const SCHEMA = { type: "array", items: { type: "string" } };

async function translateBatch(items) {
  const prompt = `Translate these Indian food item names from English to their common Hindi/regional name in Latin script (e.g., "Kidney Beans" -> "rajma", "Lentils" -> "dal", "Flattened Rice" -> "poha").
If it's already a local name or transliterated (e.g. "Chapati"), just return the same name lowercased.
If it's a generic ingredient like "Salt" or "Water", return "namak" or "pani".
Keep it very short, 1-2 words.
Return EXACTLY a JSON array of strings in the exact same order as the input.
Input:
${JSON.stringify(items.map((i) => i.name))}`;

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

(async () => {
  let totalProcessed = 0;
  while (true) {
    const { data: rows, error } = await sb
      .from("foods")
      .select("id,name")
      .eq("source", "indb")
      .is("name_local", null)
      .order("id")
      .limit(50);
    if (error) throw error;
    if (rows.length === 0) {
      console.log(`No more foods need translating. Finished! Total this run: ${totalProcessed}`);
      break;
    }

    console.log(`Translating batch of ${rows.length}... (processed so far: ${totalProcessed})`);
    try {
      const names = await translateBatch(rows);
      for (let i = 0; i < rows.length; i++) {
        if (!names[i]) continue;
        const { error: upErr } = await sb.from("foods").update({ name_local: names[i] }).eq("id", rows[i].id);
        if (upErr) throw upErr;
      }
      totalProcessed += rows.length;
      console.log(`Batch complete! Sample: ${rows[0].name} -> ${names[0]}`);
    } catch (e) {
      console.error("Batch failed, retrying in 3s...", e.message);
      await new Promise((r) => setTimeout(r, 3000));
    }
  }
})();
