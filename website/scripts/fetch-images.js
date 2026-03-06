/**
 * Build-time script: fetches image URLs from OneZoom's node_images API
 * for each species in species.csv and writes src/data/species.json.
 *
 * Usage: node scripts/fetch-images.js
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const CSV_PATH = path.resolve(ROOT, "..", "species.csv");
const OUT_DIR = path.resolve(ROOT, "src", "data");
const OUT_PATH = path.join(OUT_DIR, "species.json");

const ONEZOOM_API =
  "https://www.onezoom.org/API/node_images.json?key=0&otts=";

/** Parse the CSV (simple: no quoting needed) */
function parseCsv(text) {
  const lines = text.trim().split("\n");
  const header = lines[0].split(",");
  return lines.slice(1).map((line) => {
    const vals = line.split(",");
    const obj = {};
    header.forEach((h, i) => (obj[h.trim()] = vals[i]?.trim()));
    return obj;
  });
}

/** Fetch OneZoom images for a list of OTT IDs (max ~5 per request) */
async function fetchImages(ottIds) {
  const url = ONEZOOM_API + ottIds.join(",");
  const res = await fetch(url);
  if (!res.ok) throw new Error(`OneZoom API error: ${res.status}`);
  return res.json();
}

/** Use Open Tree of Life to collect descendant species OTT IDs for a taxon */
async function collectDescendantSpecies(ottId, maxResults = 10) {
  const result = [];

  async function recurse(ott, depth) {
    if (depth > 2 || result.length >= maxResults) return;
    const res = await fetch(
      "https://api.opentreeoflife.org/v3/taxonomy/taxon_info",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ott_id: Number(ott), include_children: true }),
      }
    );
    if (!res.ok) return;
    const data = await res.json();
    const children = data.children || [];
    for (const child of children) {
      if (result.length >= maxResults) break;
      if (child.rank === "species") {
        result.push(String(child.ott_id));
      } else if (
        ["genus", "subgenus", "subfamily", "no rank"].includes(child.rank)
      ) {
        await recurse(child.ott_id, depth + 1);
      }
    }
  }

  await recurse(ottId, 0);
  return result;
}

/** Pick the best image (highest rating) from a set of images for a taxon */
function bestImage(data, ottId) {
  const taxon = data.taxa?.[ottId];
  if (!taxon) return null;

  // For species-level taxa, the image key matches the OTT ID directly.
  // For higher taxa (genus/family/order), OneZoom returns images keyed
  // by sub-OTT IDs listed in taxon.otts.
  const candidateKeys = taxon.otts.map(String);
  let best = null;
  let bestRating = -1;

  for (const key of candidateKeys) {
    const img = data.images?.[key];
    if (img) {
      const rating = img[4] ?? 0;
      if (rating > bestRating) {
        best = img;
        bestRating = rating;
      }
    }
  }

  // Also check if the OTT ID itself has an image
  const direct = data.images?.[String(ottId)];
  if (direct) {
    const rating = direct[4] ?? 0;
    if (rating > bestRating) {
      best = direct;
    }
  }

  if (!best) return null;
  return {
    src: best[1],
    credit: best[2],
    licence: best[3],
  };
}

/** Try to get an image, falling back to descendant species if needed */
async function getImageWithFallback(ottId) {
  // First try the OTT ID directly
  const data = await fetchImages([ottId]);
  const img = bestImage(data, ottId);
  if (img) return img;

  // Fallback: find descendant species and try them with OneZoom
  console.log(`  No image for OTT ${ottId}, trying descendant species...`);
  const descendants = await collectDescendantSpecies(ottId);
  console.log(`  Found ${descendants.length} descendant species to try`);

  // Try descendants in batches of 5
  for (let i = 0; i < descendants.length; i += 5) {
    const batch = descendants.slice(i, i + 5);
    const data2 = await fetchImages(batch);
    for (const dOtt of batch) {
      const img2 = bestImage(data2, dOtt);
      if (img2) {
        console.log(`  Found image via descendant OTT ${dOtt}`);
        return img2;
      }
    }
  }

  console.log(`  No descendant images found for OTT ${ottId}`);
  return null;
}

async function main() {
  const csv = fs.readFileSync(CSV_PATH, "utf-8");
  const species = parseCsv(csv);

  console.log(`Found ${species.length} species in CSV`);

  // Batch OTT IDs into groups of 5 (API limit)
  const BATCH = 5;
  const results = [];

  for (let i = 0; i < species.length; i += BATCH) {
    const batch = species.slice(i, i + BATCH);
    const ottIds = batch.map((s) => s.ott_id).filter(Boolean);

    if (ottIds.length === 0) continue;

    console.log(`Fetching images for OTTs: ${ottIds.join(", ")}`);
    const data = await fetchImages(ottIds);

    for (const sp of batch) {
      const img = sp.ott_id ? bestImage(data, sp.ott_id) : null;
      results.push({
        name: sp.name,
        ott_id: Number(sp.ott_id) || null,
        image: img,
      });
    }
  }

  // Retry species that didn't get images (higher-level taxa)
  for (const sp of results) {
    if (!sp.image && sp.ott_id) {
      sp.image = await getImageWithFallback(sp.ott_id);
    }
  }

  fs.mkdirSync(OUT_DIR, { recursive: true });
  fs.writeFileSync(OUT_PATH, JSON.stringify(results, null, 2));
  console.log(`Wrote ${results.length} species to ${OUT_PATH}`);

  const withImages = results.filter((r) => r.image);
  const without = results.filter((r) => !r.image);
  console.log(`  ${withImages.length} with images, ${without.length} without`);
  if (without.length) {
    console.log(
      `  Missing: ${without.map((r) => r.name).join(", ")}`
    );
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
