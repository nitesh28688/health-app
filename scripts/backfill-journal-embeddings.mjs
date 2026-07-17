// One-off backfill: generate embeddings for wellness_journal rows saved before
// migration 0040 added the embedding column. Uses the same text-embedding-004
// call as lib/gemini.ts's generateEmbedding() (duplicated here in plain JS
// since scripts/ can't import the Next.js app's TS lib directly).
// Run: node scripts/backfill-journal-embeddings.mjs
import fs from "node:fs";
import { createRequire } from "node:module";

const require = createRequire(new URL("../web/package.json", import.meta.url));
const { createClient } = require("@supabase/supabase-js");

for (const line of fs.readFileSync(new URL("../web/.env.local", import.meta.url), "utf8").split("\n")) {
  const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
  if (m) process.env[m[1]] = m[2];
}

const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

async function embed(text) {
  const useVertex = !!process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
  if (useVertex) {
    const { GoogleAuth } = require("google-auth-library");
    const auth = new GoogleAuth({
      credentials: JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_JSON),
      scopes: ["https://www.googleapis.com/auth/cloud-platform"],
    });
    const client = await auth.getClient();
    const { token } = await client.getAccessToken();
    const project = process.env.GOOGLE_CLOUD_PROJECT;
    const location = process.env.GOOGLE_CLOUD_LOCATION || "us-central1";
    const url = `https://${location}-aiplatform.googleapis.com/v1/projects/${project}/locations/${location}/publishers/google/models/text-embedding-004:predict`;
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ instances: [{ content: text }] }),
    });
    if (!res.ok) throw new Error(`vertex embed ${res.status}: ${await res.text()}`);
    const body = await res.json();
    return body?.predictions?.[0]?.embeddings?.values ?? null;
  }
  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/text-embedding-004:embedContent?key=${process.env.GEMINI_API_KEY}`,
    { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ content: { parts: [{ text }] } }) }
  );
  if (!res.ok) throw new Error(`ai studio embed ${res.status}: ${await res.text()}`);
  const body = await res.json();
  return body?.embedding?.values ?? null;
}

const { data: rows, error } = await sb
  .from("wellness_journal")
  .select("id, entry_text")
  .is("embedding", null);
if (error) throw error;

console.log(`Backfilling ${rows.length} journal entries...`);
let ok = 0, failed = 0;
for (const row of rows) {
  try {
    const embedding = await embed(row.entry_text);
    if (!embedding) { failed++; continue; }
    const { error: updErr } = await sb.from("wellness_journal").update({ embedding }).eq("id", row.id);
    if (updErr) throw updErr;
    ok++;
  } catch (e) {
    console.error(`Row ${row.id} failed:`, e.message);
    failed++;
  }
}
console.log(`Done. ${ok} embedded, ${failed} failed.`);
