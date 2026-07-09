// Seed demo images for exercises. data/exercises.json (the free-exercise-db seed
// source, public domain / Unlicense — confirmed 2026-07-09) references two real
// photos per exercise (start/end position) hosted on GitHub's raw CDN, but the
// original seed never imported that field. This downloads each pair and
// re-uploads to Cloudflare R2 (already used for progress photos, same bucket/
// credentials as web/app/api/upload/photo/route.ts) under an "exercise-demos/"
// prefix — self-hosted so the live app doesn't depend on GitHub's raw CDN
// staying up/unthrottled, and R2 has zero egress fees so this is genuinely free
// at this scale (~60MB total for ~870 exercises x 2 photos).
//
// Matches DB rows to JSON entries by exact `name` (confirmed 2026-07-09: zero
// duplicate names across all 873 JSON entries, so this is a safe, unambiguous
// join — no need for a stored slug/id column). Idempotent: skips any exercise
// row that already has image_urls populated, and skips re-downloading/
// re-uploading a photo already present in R2.
//
// Run: SEED_DB_URL='...' R2_ACCOUNT_ID=... R2_ACCESS_KEY_ID=... R2_SECRET_ACCESS_KEY=...
//      R2_BUCKET_NAME=... R2_PUBLIC_URL=... node scripts/seed-exercise-images.mjs [limit]
import { readFileSync } from "fs";
import pg from "pg";
import { S3Client, PutObjectCommand, HeadObjectCommand } from "@aws-sdk/client-s3";

const LIMIT = process.argv[2] ? parseInt(process.argv[2]) : Infinity;
const RAW_BASE = "https://raw.githubusercontent.com/yuhonas/free-exercise-db/main/exercises/";

const r2 = new S3Client({
  region: "auto",
  endpoint: `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
  credentials: {
    accessKeyId: process.env.R2_ACCESS_KEY_ID,
    secretAccessKey: process.env.R2_SECRET_ACCESS_KEY,
  },
});

async function objectExists(key) {
  try {
    await r2.send(new HeadObjectCommand({ Bucket: process.env.R2_BUCKET_NAME, Key: key }));
    return true;
  } catch {
    return false;
  }
}

async function uploadImage(relPath) {
  const key = `exercise-demos/${relPath}`;
  if (await objectExists(key)) return `${process.env.R2_PUBLIC_URL}/${key}`;

  const res = await fetch(RAW_BASE + relPath.split("/").map(encodeURIComponent).join("/"));
  if (!res.ok) throw new Error(`fetch ${relPath} -> HTTP ${res.status}`);
  const buffer = Buffer.from(await res.arrayBuffer());

  await r2.send(new PutObjectCommand({
    Bucket: process.env.R2_BUCKET_NAME,
    Key: key,
    Body: buffer,
    ContentType: "image/jpeg",
    CacheControl: "public, max-age=31536000, immutable", // static reference photos, never change
  }));
  return `${process.env.R2_PUBLIC_URL}/${key}`;
}

const exercises = JSON.parse(readFileSync(new URL("../data/exercises.json", import.meta.url), "utf8"));
const byName = new Map(exercises.map((e) => [e.name.trim(), e]));

// Fresh short-lived connection per query rather than one held open for the
// whole run — the per-row work is network-bound (a GitHub fetch + an R2
// upload can each take seconds), so a single long-lived pg.Client sits idle
// long enough for the pooler to kill it. That surfaced as an unhandled
// 'error' event crashing the whole process, twice, partway through a run
// (confirmed 2026-07-09 — "Connection terminated unexpectedly"). Idempotency
// at both the DB and R2 level means resuming after a crash was always safe,
// but a robust run shouldn't need manual resuming in the first place.
async function withDb(fn) {
  const client = new pg.Client({ connectionString: process.env.SEED_DB_URL });
  await client.connect();
  try {
    return await fn(client);
  } finally {
    await client.end();
  }
}

const rows = await withDb((client) =>
  client.query(
    `select id, name from exercises where owner_id is null and (image_urls is null or array_length(image_urls, 1) is null)`
  ).then((r) => r.rows)
);

let done = 0, matched = 0, uploaded = 0, failed = 0;
for (const row of rows) {
  if (done >= LIMIT) break;
  done++;
  const entry = byName.get(row.name.trim());
  if (!entry || !entry.images?.length) continue;
  matched++;

  try {
    const urls = [];
    for (const relPath of entry.images.slice(0, 2)) {
      urls.push(await uploadImage(relPath));
      uploaded++;
    }
    await withDb((client) => client.query(`update exercises set image_urls = $1 where id = $2`, [urls, row.id]));
  } catch (e) {
    failed++;
    console.error(`  ${row.name}: ${e.message}`);
  }

  if (done % 50 === 0) console.log(`  processed ${done}/${rows.length} candidate rows, matched ${matched}, uploaded ${uploaded} photos, ${failed} failures`);
}

console.log(`\ndone: scanned ${done} rows without images, matched ${matched} to source data, uploaded ${uploaded} photos, ${failed} failures`);
await withDb(async (client) => {
  const { rows: [c] } = await client.query(`select count(*) from exercises where image_urls is not null and array_length(image_urls, 1) > 0`);
  console.log(`total exercises with images now: ${c.count}`);
});
