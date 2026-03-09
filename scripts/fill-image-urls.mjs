#!/usr/bin/env node

/**
 * fill-image-urls.mjs
 *
 * Reads taxa.csv and looks for rows where image_url is missing.
 * For each such row, attempts to fetch an image URL from the OneZoom API.
 *
 * For higher taxa (families, genera, orders) OneZoom may not have a direct
 * image.  In that case we do a "recursive descent" via the Open Tree of Life
 * taxonomy API to find descendant species, then try OneZoom for those.
 *
 * Updates taxa.csv in place with any newly-found URLs.
 *
 * Usage:  node scripts/fill-image-urls.mjs
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CSV_PATH = path.resolve(__dirname, "..", "taxa.csv");

// ---------------------------------------------------------------------------
// CSV helpers – handles double-quoted fields (RFC 4180)
// ---------------------------------------------------------------------------

function parseCsvLine(line) {
  const fields = [];
  let i = 0;
  while (i <= line.length) {
    if (i === line.length) {
      fields.push("");
      break;
    }
    if (line[i] === '"') {
      let val = "";
      i++;
      while (i < line.length) {
        if (line[i] === '"') {
          if (i + 1 < line.length && line[i + 1] === '"') {
            val += '"';
            i += 2;
          } else {
            i++;
            break;
          }
        } else {
          val += line[i++];
        }
      }
      fields.push(val);
      if (i < line.length && line[i] === ",") i++;
    } else {
      let val = "";
      while (i < line.length && line[i] !== ",") {
        val += line[i++];
      }
      fields.push(val);
      if (i < line.length) i++;
    }
  }
  return fields;
}

function parseCsv(text) {
  const lines = text.trim().split("\n");
  const header = parseCsvLine(lines[0]).map((h) => h.trim());
  // Trim trailing empty header entries (parseCsvLine may add a phantom one)
  while (header.length > 0 && header[header.length - 1] === "") {
    header.pop();
  }
  return { header, rows: lines.slice(1).map((line) => {
    const vals = parseCsvLine(line);
    const obj = {};
    header.forEach((h, i) => (obj[h] = vals[i]?.trim() ?? ""));
    return obj;
  })};
}

function csvEscape(val) {
  if (!val) return "";
  if (val.includes(",") || val.includes('"') || val.includes("\n")) {
    return '"' + val.replace(/"/g, '""') + '"';
  }
  return val;
}

function writeCsv(header, rows, filePath) {
  const lines = [header.join(",")];
  for (const row of rows) {
    lines.push(header.map((h) => csvEscape(row[h] ?? "")).join(","));
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

// ---------------------------------------------------------------------------
// Wikidata fallback – bridge from OTT via NCBI/GBIF to Wikimedia Commons
// ---------------------------------------------------------------------------

/**
 * Get the NCBI taxonomy ID for a taxon from its OTT ID.
 * Returns the NCBI ID as a string, or null if not found.
 */
async function getNcbiId(ottId) {
  const res = await fetch(
    "https://api.opentreeoflife.org/v3/taxonomy/taxon_info",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ott_id: ottId }),
    }
  );
  if (!res.ok) return null;
  const data = await res.json();
  for (const src of data.tax_sources ?? []) {
    if (src.startsWith("ncbi:")) return src.replace("ncbi:", "");
  }
  return null;
}

/**
 * Query Wikidata SPARQL to find a Wikimedia Commons image for a taxon
 * identified by its NCBI taxonomy ID (Wikidata property P685).
 * Returns the image URL or null.
 */
async function getWikidataImage(ncbiId) {
  // Validate NCBI ID is purely numeric to prevent SPARQL injection
  if (!/^\d+$/.test(ncbiId)) return null;

  const query = `SELECT ?image WHERE {
  ?item wdt:P685 "${ncbiId}" .
  ?item wdt:P18 ?image .
} LIMIT 1`;

  return await runWikidataSparql(query);
}

/**
 * Query Wikidata SPARQL to find a Wikimedia Commons image for a taxon
 * identified by its scientific name (Wikidata property P225).
 * Returns the image URL or null.
 */
async function getWikidataImageByName(scientificName) {
  if (!scientificName) return null;
  // Sanitize: allow only letters, spaces, hyphens, periods, and the × symbol
  if (!/^[\p{L}\s.\-×]+$/u.test(scientificName)) return null;

  const escaped = scientificName.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
  const query = `SELECT ?image WHERE {
  ?item wdt:P225 "${escaped}" .
  ?item wdt:P18 ?image .
} LIMIT 1`;

  return await runWikidataSparql(query);
}

/** Run a Wikidata SPARQL query and return the first image URL or null. */
async function runWikidataSparql(query) {
  const params = new URLSearchParams({ query });
  const res = await fetch(
    `https://query.wikidata.org/sparql?${params}`,
    {
      headers: {
        Accept: "application/json",
        "User-Agent":
          "CatBunnyRailroad/1.0 (https://github.com/jacksonloper/catbunnyrailroad)",
      },
    }
  );
  if (!res.ok) {
    console.error(`    Wikidata SPARQL error: ${res.status}`);
    return null;
  }
  const data = await res.json();
  const bindings = data.results?.bindings ?? [];
  return bindings[0]?.image?.value ?? null;
}

/**
 * Recursive descent: try to find an image for a taxon by walking down the
 * taxonomy tree.  We do a breadth-first search up to `maxDepth` levels.
 *
 * If OneZoom doesn't have an image, falls back to Wikidata/Wikimedia Commons
 * using the OTT → NCBI → Wikidata bridge.
 */
async function getImageWithRecursiveDescent(ottId, scientificName, maxDepth = 3) {
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

  // Fallback: try Wikidata via the OTT → NCBI bridge
  console.log(`    OneZoom exhausted — trying Wikidata fallback...`);
  const ncbiId = await getNcbiId(ottId);
  if (ncbiId) {
    console.log(`    NCBI ID: ${ncbiId}`);
    const wdUrl = await getWikidataImage(ncbiId);
    if (wdUrl) return wdUrl;
  }

  // Fallback: try Wikidata via scientific name (P225)
  if (scientificName) {
    console.log(`    Trying Wikidata by scientific name: ${scientificName}`);
    const wdUrl = await getWikidataImageByName(scientificName);
    if (wdUrl) return wdUrl;
  }

  return null;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  const csvText = fs.readFileSync(CSV_PATH, "utf-8");
  const { header, rows } = parseCsv(csvText);
  console.log(`Read ${rows.length} taxa from ${CSV_PATH}`);

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
    const url = await getImageWithRecursiveDescent(Number(row.ott_id), row.scientific_name);
    if (url) {
      console.log(`  ✓ Found: ${url}`);
      row.image_url = url;
      updated++;
    } else {
      console.log(`  ✗ No image found`);
    }
  }

  if (updated > 0) {
    writeCsv(header, rows, CSV_PATH);
    console.log(`\nUpdated ${updated} image URL(s) in ${CSV_PATH}`);
  } else {
    console.log("\nNo new image URLs found.");
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
