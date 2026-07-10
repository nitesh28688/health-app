// Clean up food_servings labels: remove US imperial measures (oz/lb) and USDA junk,
// normalize the survivors to short household labels.
// Dry-run by default; pass --apply to write. Run: node scripts/clean-servings.mjs [--apply]
import fs from "node:fs";
import { createRequire } from "node:module";

const require = createRequire(new URL("../web/package.json", import.meta.url));
const { createClient } = require("@supabase/supabase-js");

for (const line of fs.readFileSync(new URL("../web/.env.local", import.meta.url), "utf8").split("\n")) {
  const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
  if (m) process.env[m[1]] = m[2];
}

const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
const APPLY = process.argv.includes("--apply");

const IMPERIAL = /\b(oz|ounce|ounces|fl\.?\s*oz|lb|lbs|pound|pounds)\b/i;
const JUNK = /yield|excluding refuse|undiluted|as purchased/i;

function normalize(label) {
  let l = label.toLowerCase();
  l = l.replace(/\s*\([^)]*\)\s*/g, " "); // strip parentheticals: "cup (8 fl oz)" -> "cup"
  l = l.replace(/\btablespoons?\b/g, "tbsp").replace(/\bteaspoons?\b/g, "tsp");
  l = l.replace(/\s+/g, " ").replace(/[,\s]+$/, "").trim();
  return l;
}

// Pull every serving row (paged)
const rows = [];
for (let from = 0; ; from += 1000) {
  const { data, error } = await sb
    .from("food_servings")
    .select("id,food_id,label,grams")
    .order("id")
    .range(from, from + 999);
  if (error) throw error;
  rows.push(...data);
  if (data.length < 1000) break;
}
console.log(`Loaded ${rows.length} food_servings rows`);

const toDelete = []; // { id, reason }
const toUpdate = []; // { id, label, grams }
const keptByFood = new Map(); // food_id -> Set of final labels (for dedupe)

for (const r of rows) {
  if (IMPERIAL.test(r.label)) { toDelete.push({ id: r.id, reason: "imperial" }); continue; }
  if (JUNK.test(r.label)) { toDelete.push({ id: r.id, reason: "junk-phrase" }); continue; }
  if (r.label.length >= 55) { toDelete.push({ id: r.id, reason: "too-long" }); continue; }

  let label = normalize(r.label);
  let grams = Number(r.grams);
  if (!label) { toDelete.push({ id: r.id, reason: "empty-after-normalize" }); continue; }

  // "0.5 cup" (143 rows) etc: fold the multiplier into grams -> label "cup", grams*2
  const numPrefix = label.match(/^(\d+(?:\.\d+)?)\s+(.+)$/);
  if (numPrefix) {
    const n = parseFloat(numPrefix[1]);
    if (n > 0 && n !== 1) {
      label = numPrefix[2];
      grams = Math.round((grams / n) * 100) / 100;
    } else if (n === 1) {
      label = numPrefix[2];
    }
  }

  // normalization might have produced an imperial label ("cup (8 fl oz)" is safe,
  // but "3 oz, boneless" already caught above) — re-check to be safe
  if (IMPERIAL.test(label)) { toDelete.push({ id: r.id, reason: "imperial" }); continue; }

  const set = keptByFood.get(r.food_id) ?? new Set();
  keptByFood.set(r.food_id, set);
  if (set.has(label)) { toDelete.push({ id: r.id, reason: "dup-after-normalize" }); continue; }
  set.add(label);

  if (label !== r.label || grams !== Number(r.grams)) toUpdate.push({ id: r.id, label, grams });
}

const byReason = {};
for (const d of toDelete) byReason[d.reason] = (byReason[d.reason] || 0) + 1;
console.log("Delete plan:", byReason, `(total ${toDelete.length})`);
console.log(`Update plan: ${toUpdate.length} rows (label/grams normalization)`);
console.log(`Rows remaining after cleanup: ${rows.length - toDelete.length}`);
console.log("Sample updates:", toUpdate.slice(0, 12).map((u) => `#${u.id} -> "${u.label}" ${u.grams}g`));

if (!APPLY) {
  console.log("\nDry run only. Re-run with --apply to write.");
  process.exit(0);
}

// Apply deletes in chunks
const ids = toDelete.map((d) => d.id);
for (let i = 0; i < ids.length; i += 500) {
  const { error } = await sb.from("food_servings").delete().in("id", ids.slice(i, i + 500));
  if (error) throw error;
  process.stdout.write(`\rDeleted ${Math.min(i + 500, ids.length)}/${ids.length}`);
}
console.log();

// Apply updates one by one (each row differs)
let done = 0;
for (const u of toUpdate) {
  const { error } = await sb.from("food_servings").update({ label: u.label, grams: u.grams }).eq("id", u.id);
  if (error) throw error;
  if (++done % 100 === 0) process.stdout.write(`\rUpdated ${done}/${toUpdate.length}`);
}
console.log(`\rUpdated ${done}/${toUpdate.length}`);
console.log("Done.");
