-- 0023_exercise_images.sql — demo images for exercises
--
-- data/exercises.json (the free-exercise-db seed source, public domain / Unlicense
-- — confirmed 2026-07-09) references two real photos per exercise (start/end
-- position) already hosted publicly on GitHub, but the original seed never
-- imported that field. Self-hosted copies go to Cloudflare R2 (already used for
-- progress photos, see web/app/api/upload/photo/route.ts) rather than hotlinking
-- GitHub's raw CDN, so this doesn't depend on GitHub's rate limits for a live app.
alter table exercises add column image_urls text[];
