#!/usr/bin/env node

/**
 * generate-species-list.mjs
 *
 * Reads the curated seed list (kid-friendly-species.json) and resolves each
 * organism's scientific name to an Open Tree of Life OTT ID using the TNRS
 * (Taxonomic Name Resolution Service) API.
 *
 * Outputs a new species.csv with columns: name, ott_id, image_url
 * (image_url is left blank — run fill-image-urls.mjs afterwards to populate it).
 *
 * Usage:  node scripts/generate-species-list.mjs [--dry-run]
 *
 * Options:
 *   --dry-run   Print what would be written without modifying species.csv
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SEED_PATH = path.resolve(__dirname, "kid-friendly-species.json");
const CSV_PATH = path.resolve(__dirname, "..", "species.csv");

const DRY_RUN = process.argv.includes("--dry-run");
const BATCH_SIZE = 250; // TNRS API accepts up to ~250 names per request
const DELAY_MS = 500; // polite delay between API calls

// ---------------------------------------------------------------------------
// Open Tree of Life TNRS API
// ---------------------------------------------------------------------------

/**
 * Resolve a batch of scientific names to OTT IDs using the TNRS API.
 *
 * Returns a Map<scientificName, { ott_id, matched_name }>.
 * Names that don't resolve are omitted from the map.
 */
async function resolveBatch(names) {
  const res = await fetch(
    "https://api.opentreeoflife.org/v3/tnrs/match_names",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        names,
        do_approximate_matching: true,
      }),
    }
  );

  if (!res.ok) {
    console.error(`  TNRS API error: ${res.status} ${res.statusText}`);
    return new Map();
  }

  const data = await res.json();
  const results = new Map();

  for (const result of data.results ?? []) {
    const queryName = result.name;
    // Pick the best match (first match is highest score)
    const match = result.matches?.[0];
    if (match && match.taxon?.ott_id) {
      results.set(queryName, {
        ott_id: match.taxon.ott_id,
        matched_name: match.taxon.unique_name || match.matched_name,
        score: match.score,
      });
    }
  }

  return results;
}

// ---------------------------------------------------------------------------
// CSV helpers
// ---------------------------------------------------------------------------

function writeCsv(rows, filePath) {
  const header = "name,ott_id,image_url";
  const lines = [header];
  for (const row of rows) {
    // Escape commas in names (shouldn't happen with our data, but be safe)
    const name = row.name.includes(",") ? `"${row.name}"` : row.name;
    lines.push(`${name},${row.ott_id},${row.image_url || ""}`);
  }
  fs.writeFileSync(filePath, lines.join("\n") + "\n");
}

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

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  // Load seed list
  const seedText = fs.readFileSync(SEED_PATH, "utf-8");
  const seedList = JSON.parse(seedText);
  console.log(`Loaded ${seedList.length} organisms from seed list`);

  // Load existing CSV to preserve known OTT IDs and image URLs
  const existingMap = new Map();
  if (fs.existsSync(CSV_PATH)) {
    const csvText = fs.readFileSync(CSV_PATH, "utf-8");
    const rows = parseCsv(csvText);
    for (const row of rows) {
      existingMap.set(row.name, row);
    }
    console.log(`Found ${existingMap.size} existing entries in species.csv`);
  }

  // Separate organisms that need resolution from those already known
  const needsResolution = [];
  const resolved = [];

  for (const entry of seedList) {
    const existing = existingMap.get(entry.common_name);
    if (existing && existing.ott_id) {
      // Already in CSV with an OTT ID — keep it
      resolved.push({
        name: entry.common_name,
        ott_id: existing.ott_id,
        image_url: existing.image_url || "",
        category: entry.category,
      });
    } else {
      needsResolution.push(entry);
    }
  }

  console.log(`Already resolved: ${resolved.length}`);
  console.log(`Need TNRS resolution: ${needsResolution.length}`);

  if (needsResolution.length === 0) {
    console.log("All organisms already resolved! Nothing to do.");
    if (!DRY_RUN) {
      writeCsv(resolved, CSV_PATH);
      console.log(`Wrote ${resolved.length} entries to ${CSV_PATH}`);
    }
    return;
  }

  // Resolve in batches
  const failures = [];
  const batches = [];
  for (let i = 0; i < needsResolution.length; i += BATCH_SIZE) {
    batches.push(needsResolution.slice(i, i + BATCH_SIZE));
  }

  console.log(`\nResolving names in ${batches.length} batch(es)...\n`);

  for (let b = 0; b < batches.length; b++) {
    const batch = batches[b];
    const names = batch.map((e) => e.scientific_name);

    console.log(
      `Batch ${b + 1}/${batches.length}: resolving ${names.length} names...`
    );

    const results = await resolveBatch(names);

    for (const entry of batch) {
      const match = results.get(entry.scientific_name);
      if (match) {
        resolved.push({
          name: entry.common_name,
          ott_id: match.ott_id,
          image_url: "",
          category: entry.category,
        });
        if (match.score < 1.0) {
          console.log(
            `  ⚠ "${entry.common_name}" (${entry.scientific_name}) → ott${match.ott_id} (score=${match.score}, matched as "${match.matched_name}")`
          );
        }
      } else {
        failures.push(entry);
        console.log(
          `  ✗ "${entry.common_name}" (${entry.scientific_name}) — no match found`
        );
      }
    }

    // Polite delay between batches
    if (b < batches.length - 1) {
      await new Promise((r) => setTimeout(r, DELAY_MS));
    }
  }

  // Deduplicate by ott_id (keep first occurrence)
  const seenOttIds = new Set();
  const deduped = [];
  for (const row of resolved) {
    if (seenOttIds.has(String(row.ott_id))) {
      console.log(`  Skipping duplicate OTT ID ${row.ott_id} for "${row.name}"`);
      continue;
    }
    seenOttIds.add(String(row.ott_id));
    deduped.push(row);
  }

  // Summary
  console.log(`\n${"=".repeat(60)}`);
  console.log(`Resolved: ${deduped.length} organisms`);
  console.log(`Failed:   ${failures.length} organisms`);
  console.log(`${"=".repeat(60)}`);

  if (failures.length > 0) {
    console.log("\nFailed organisms (check spelling or try alternate names):");
    for (const f of failures) {
      console.log(`  - ${f.common_name} (${f.scientific_name}) [${f.category}]`);
    }
  }

  // Write output
  if (DRY_RUN) {
    console.log("\n[DRY RUN] Would write the following to species.csv:");
    console.log(`  ${deduped.length} organisms across ${new Set(deduped.map((d) => d.category).filter(Boolean)).size} categories`);
  } else {
    writeCsv(deduped, CSV_PATH);
    console.log(`\nWrote ${deduped.length} entries to ${CSV_PATH}`);
    console.log(
      "\nNext steps:\n" +
        "  1. Review species.csv for any issues\n" +
        "  2. Run: node scripts/fill-image-urls.mjs\n" +
        "  3. Run: cd website && npm run build\n"
    );
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
