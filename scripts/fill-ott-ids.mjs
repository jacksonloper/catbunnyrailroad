#!/usr/bin/env node

/**
 * fill-ott-ids.mjs
 *
 * Reads species.csv and looks for rows where ott_id is missing.
 * For each such row, uses the Open Tree of Life TNRS (Taxonomic Name
 * Resolution Service) match_names endpoint to look up the OTT ID.
 *
 * Updates species.csv in place with any newly-found IDs.
 *
 * Usage:  node scripts/fill-ott-ids.mjs
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CSV_PATH = path.resolve(__dirname, "..", "species.csv");

// ---------------------------------------------------------------------------
// CSV helpers  (shared pattern with fill-image-urls.mjs)
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
// Open Tree of Life – TNRS name matching
// ---------------------------------------------------------------------------

/**
 * Query the TNRS match_names endpoint for a batch of names.
 * Returns a Map<string, number> from lowercase name → OTT ID.
 *
 * API docs: https://opentreeoflife.github.io/develop/tnrs/
 */
async function matchNames(names) {
  const res = await fetch(
    "https://api.opentreeoflife.org/v3/tnrs/match_names",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ names }),
    }
  );

  if (!res.ok) {
    console.error(`  TNRS API error: ${res.status}`);
    return new Map();
  }

  const data = await res.json();
  const results = new Map();

  for (const result of data.results ?? []) {
    const queriedName = result.name?.toLowerCase();
    // Pick the best match (first match is highest score)
    const bestMatch = result.matches?.[0];
    if (bestMatch?.taxon?.ott_id) {
      results.set(queriedName, bestMatch.taxon.ott_id);
    }
  }

  return results;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  const csvText = fs.readFileSync(CSV_PATH, "utf-8");
  const rows = parseCsv(csvText);
  console.log(`Read ${rows.length} species from ${CSV_PATH}`);

  const missing = rows.filter((r) => !r.ott_id);
  if (missing.length === 0) {
    console.log("All rows already have OTT IDs. Nothing to do.");
    return;
  }

  console.log(`Found ${missing.length} rows without OTT IDs.`);

  // TNRS accepts batches — process in groups of 20 to stay within limits
  const BATCH_SIZE = 20;
  let updated = 0;

  for (let i = 0; i < missing.length; i += BATCH_SIZE) {
    const batch = missing.slice(i, i + BATCH_SIZE);
    const names = batch.map((r) => r.name);
    console.log(
      `\nBatch ${Math.floor(i / BATCH_SIZE) + 1}: looking up ${names.length} name(s)...`
    );

    const idMap = await matchNames(names);

    for (const row of batch) {
      const ottId = idMap.get(row.name.toLowerCase());
      if (ottId) {
        console.log(`  ✓ ${row.name} → ott_id=${ottId}`);
        row.ott_id = String(ottId);
        updated++;
      } else {
        console.log(`  ✗ ${row.name} — no match found`);
      }
    }
  }

  if (updated > 0) {
    writeCsv(rows, CSV_PATH);
    console.log(`\nUpdated ${updated} OTT ID(s) in ${CSV_PATH}`);
  } else {
    console.log("\nNo new OTT IDs found.");
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
