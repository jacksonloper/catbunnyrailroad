#!/usr/bin/env node

/**
 * fill-image-urls.mjs
 *
 * Reads species.csv and looks for rows where image_url is missing.
 * For each such row, attempts to fetch an image URL from the OneZoom API.
 *
 * For higher taxa (families, genera, orders) OneZoom may not have a direct
 * image.  In that case we do a "recursive descent" via the Open Tree of Life
 * taxonomy API to find descendant species, then try OneZoom for those.
 *
 * Updates species.csv in place with any newly-found URLs.
 *
 * Usage:  node scripts/fill-image-urls.mjs
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CSV_PATH = path.resolve(__dirname, "..", "species.csv");

// ---------------------------------------------------------------------------
// CSV helpers
// ---------------------------------------------------------------------------

function parseCsv(text) {
  const lines = text.trim().split("\n");
  const header = lines[0].split(",");
  return lines.slice(1).map((line) => {
    const vals = line.split(",");
    const obj = {};
    header.forEach((h, i) => (obj[h.trim()] = vals[i]?.trim() ?? ""));
    return obj;
  });
}

function writeCsv(rows, filePath) {
  if (rows.length === 0) return;
  const header = Object.keys(rows[0]);
  const lines = [header.join(",")];
  for (const row of rows) {
    lines.push(header.map((h) => row[h] ?? "").join(","));
  }
  fs.writeFileSync(filePath, lines.join("\n") + "\n");
}

// ---------------------------------------------------------------------------
// OneZoom image lookup
// ---------------------------------------------------------------------------

/**
 * Query the OneZoom node_images API for a set of OTT IDs.
 *
 * Response shape (example):
 *   {
 *     "headers": { "name":0, "url":1, "rights":2, "licence":3, "rating":4 },
 *     "images": { "563151": ["Panthera leo", "https://…/img/20/140/140.jpg", "…", "…", 35000] },
 *     ...
 *   }
 *
 * Returns a Map<string, string|null> from OTT ID → image URL (or null).
 */
async function fetchOneZoomImages(ottIds) {
  const params = new URLSearchParams({ key: "0" });
  for (const id of ottIds) {
    params.append("otts", String(id));
  }
  const url = `https://www.onezoom.org/API/node_images.json?${params}`;
  const res = await fetch(url);
  if (!res.ok) {
    console.error(`  OneZoom API error: ${res.status}`);
    return new Map();
  }
  const data = await res.json();
  const urlIdx = data.headers?.url ?? 1;
  const results = new Map();
  for (const id of ottIds) {
    const entry = data.images?.[String(id)];
    if (Array.isArray(entry) && entry[urlIdx]) {
      results.set(String(id), entry[urlIdx]);
    }
  }
  return results;
}

/** Try to get an image URL directly from OneZoom for a single OTT ID. */
async function getDirectImage(ottId) {
  const results = await fetchOneZoomImages([ottId]);
  return results.get(String(ottId)) ?? null;
}

// ---------------------------------------------------------------------------
// Open Tree of Life – descendant lookup for recursive descent
// ---------------------------------------------------------------------------

/**
 * Fetch direct children of a taxon from the Open Tree of Life taxonomy API.
 * Returns an array of { ott_id, name, rank } objects.
 */
async function getChildren(ottId) {
  const res = await fetch(
    "https://api.opentreeoflife.org/v3/taxonomy/taxon_info",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ott_id: ottId,
        include_children: true,
      }),
    }
  );
  if (!res.ok) return [];
  const data = await res.json();
  return (data.children ?? []).map((c) => ({
    ott_id: c.ott_id,
    name: c.unique_name || c.name,
    rank: c.rank,
  }));
}

const MAX_FRONTIER_SIZE = 20; // limit breadth to keep API calls manageable

/**
 * Recursive descent: try to find an image for a taxon by walking down the
 * taxonomy tree.  We do a breadth-first search up to `maxDepth` levels.
 */
async function getImageWithRecursiveDescent(ottId, maxDepth = 3) {
  // First try the taxon itself
  const directUrl = await getDirectImage(ottId);
  if (directUrl) return directUrl;

  let frontier = [ottId];

  for (let depth = 0; depth < maxDepth && frontier.length > 0; depth++) {
    console.log(`    Depth ${depth + 1}: checking ${frontier.length} child taxa...`);
    const nextFrontier = [];

    for (const parentOtt of frontier) {
      const children = await getChildren(parentOtt);

      // Try OneZoom for batches of 5 children at a time
      for (let i = 0; i < children.length; i += 5) {
        const batch = children.slice(i, i + 5);
        const batchIds = batch.map((c) => c.ott_id);
        const results = await fetchOneZoomImages(batchIds);

        for (const child of batch) {
          const url = results.get(String(child.ott_id));
          if (url) return url;
        }

        nextFrontier.push(...batchIds);
      }
    }

    frontier = nextFrontier.slice(0, MAX_FRONTIER_SIZE);
  }

  return null;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  const csvText = fs.readFileSync(CSV_PATH, "utf-8");
  const rows = parseCsv(csvText);
  console.log(`Read ${rows.length} species from ${CSV_PATH}`);

  const missing = rows.filter((r) => !r.image_url);
  if (missing.length === 0) {
    console.log("All rows already have image URLs. Nothing to do.");
    return;
  }

  console.log(`Found ${missing.length} rows without image URLs:`);
  for (const row of missing) {
    console.log(`  - ${row.name} (ott_id=${row.ott_id})`);
  }

  let updated = 0;
  for (const row of missing) {
    console.log(`\nLooking up image for "${row.name}" (ott_id=${row.ott_id})...`);
    const url = await getImageWithRecursiveDescent(Number(row.ott_id));
    if (url) {
      console.log(`  ✓ Found: ${url}`);
      row.image_url = url;
      updated++;
    } else {
      console.log(`  ✗ No image found`);
    }
  }

  if (updated > 0) {
    writeCsv(rows, CSV_PATH);
    console.log(`\nUpdated ${updated} image URL(s) in ${CSV_PATH}`);
  } else {
    console.log("\nNo new image URLs found.");
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
