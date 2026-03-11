#!/usr/bin/env node

/**
 * download-images.mjs
 *
 * Downloads taxa images from their source URLs (OneZoom, Wikimedia, etc.)
 * and saves them locally in website/public/taxa-images/{ott_id}.jpg.
 *
 * These local images are served as static assets by Vite, making them
 * same-origin so they can be used reliably in canvas-based PNG export.
 *
 * Skips images that already exist. Run again to retry failures.
 *
 * Usage:  node scripts/download-images.mjs
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TAXA_JSON = path.resolve(__dirname, "..", "website", "src", "data", "taxa.json");
const OUT_DIR = path.resolve(__dirname, "..", "website", "public", "taxa-images");

fs.mkdirSync(OUT_DIR, { recursive: true });

const taxa = JSON.parse(fs.readFileSync(TAXA_JSON, "utf-8"));
const withImages = taxa.filter((t) => t.image_url && t.ott_id);

console.log(`Found ${withImages.length} taxa with image URLs.`);

let downloaded = 0;
let skipped = 0;
let failed = 0;

function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

for (const t of withImages) {
  const ext = t.image_url.match(/\.(jpe?g|png|gif|webp|svg)(\?|$)/i)?.[1] || "jpg";
  const outFile = path.join(OUT_DIR, `${t.ott_id}.${ext}`);

  if (fs.existsSync(outFile)) {
    skipped++;
    continue;
  }

  // Rate-limit to avoid 429 errors (especially from Wikimedia)
  await sleep(2000);

  try {
    const resp = await fetch(t.image_url, {
      headers: { "User-Agent": "CatBunnyRailroad/1.0 (educational project)" },
      redirect: "follow",
    });
    if (!resp.ok) {
      console.error(`  FAIL ${t.name} (${t.ott_id}): HTTP ${resp.status}`);
      failed++;
      continue;
    }
    const buf = Buffer.from(await resp.arrayBuffer());
    fs.writeFileSync(outFile, buf);
    downloaded++;
    if (downloaded % 20 === 0) console.log(`  ... downloaded ${downloaded}`);
  } catch (err) {
    console.error(`  FAIL ${t.name} (${t.ott_id}): ${err.message}`);
    failed++;
  }
}

console.log(`\nDone. Downloaded: ${downloaded}, Skipped (already exist): ${skipped}, Failed: ${failed}`);
