#!/usr/bin/env node

/**
 * fetch-onezoom-names.mjs
 *
 * Investigates OneZoom's vernacular name layer by fetching common names
 * for all taxa in taxa.csv via the OneZoom otts2vns API, then comparing
 * them with our current human-curated names.
 *
 * Writes a report to stdout and saves the full comparison as a CSV file
 * (onezoom-names-comparison.csv) in the repo root.
 *
 * Usage:  node scripts/fetch-onezoom-names.mjs
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CSV_PATH = path.resolve(__dirname, "..", "taxa.csv");
const OUTPUT_PATH = path.resolve(__dirname, "..", "onezoom-names-comparison.csv");

// ---------------------------------------------------------------------------
// CSV helpers (same as fill-image-urls.mjs)
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
  while (header.length > 0 && header[header.length - 1] === "") {
    header.pop();
  }
  return {
    header,
    rows: lines.slice(1).map((line) => {
      const vals = parseCsvLine(line);
      const obj = {};
      header.forEach((h, i) => (obj[h] = vals[i]?.trim() ?? ""));
      return obj;
    }),
  };
}

function csvEscape(val) {
  if (!val) return "";
  if (val.includes(",") || val.includes('"') || val.includes("\n")) {
    return '"' + val.replace(/"/g, '""') + '"';
  }
  return val;
}

// ---------------------------------------------------------------------------
// OneZoom vernacular name lookup
// ---------------------------------------------------------------------------

const BATCH_SIZE = 5; // public key limit
const DELAY_MS = 500; // be polite to the API

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Fetch vernacular names from OneZoom for a batch of OTT IDs.
 * Returns a Map<string, string|null> from OTT ID → vernacular name.
 */
async function fetchVernacularNames(ottIds) {
  const otts = ottIds.map(String).join(",");
  const url = `https://www.onezoom.org/API/otts2vns?key=0&otts=${otts}&lang=en&nulls=1`;
  const res = await fetch(url);
  if (!res.ok) {
    console.error(`  OneZoom API error: ${res.status}`);
    return new Map();
  }
  const data = await res.json();
  const results = new Map();
  for (const id of ottIds) {
    const key = String(id);
    results.set(key, data[key] ?? null);
  }
  return results;
}

// ---------------------------------------------------------------------------
// Comparison logic
// ---------------------------------------------------------------------------

function normalizeForComparison(name) {
  if (!name) return "";
  return name.toLowerCase().replace(/[^a-z0-9]/g, " ").replace(/\s+/g, " ").trim();
}

function namesMatch(a, b) {
  return normalizeForComparison(a) === normalizeForComparison(b);
}

function namesSimilar(a, b) {
  const na = normalizeForComparison(a);
  const nb = normalizeForComparison(b);
  if (na === nb) return true;
  // Check if one contains the other
  if (na.includes(nb) || nb.includes(na)) return true;
  return false;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  const csvText = fs.readFileSync(CSV_PATH, "utf-8");
  const { rows } = parseCsv(csvText);
  console.log(`Read ${rows.length} taxa from ${CSV_PATH}\n`);

  // Collect all OTT IDs
  const ottIds = rows.map((r) => r.ott_id).filter(Boolean);
  console.log(`Fetching vernacular names for ${ottIds.length} OTT IDs from OneZoom...`);
  console.log(`(Using public key, batching ${BATCH_SIZE} at a time)\n`);

  // Fetch in batches
  const allNames = new Map();
  for (let i = 0; i < ottIds.length; i += BATCH_SIZE) {
    const batch = ottIds.slice(i, i + BATCH_SIZE);
    const batchNum = Math.floor(i / BATCH_SIZE) + 1;
    const totalBatches = Math.ceil(ottIds.length / BATCH_SIZE);
    process.stdout.write(`  Batch ${batchNum}/${totalBatches} (OTTs: ${batch.join(", ")})...`);

    const results = await fetchVernacularNames(batch);
    for (const [k, v] of results) {
      allNames.set(k, v);
    }

    const found = [...results.values()].filter(Boolean).length;
    console.log(` ${found}/${batch.length} names found`);

    if (i + BATCH_SIZE < ottIds.length) {
      await sleep(DELAY_MS);
    }
  }

  // Analyze results
  console.log("\n" + "=".repeat(80));
  console.log("RESULTS");
  console.log("=".repeat(80));

  let hasName = 0;
  let noName = 0;
  let exactMatch = 0;
  let similar = 0;
  let different = 0;
  const comparisons = [];

  for (const row of rows) {
    const ottId = row.ott_id;
    const ourName = row.name;
    const ozName = allNames.get(String(ottId)) ?? null;

    let status;
    if (!ozName) {
      noName++;
      status = "NO_OZ_NAME";
    } else {
      hasName++;
      if (namesMatch(ourName, ozName)) {
        exactMatch++;
        status = "EXACT_MATCH";
      } else if (namesSimilar(ourName, ozName)) {
        similar++;
        status = "SIMILAR";
      } else {
        different++;
        status = "DIFFERENT";
      }
    }

    comparisons.push({
      ott_id: ottId,
      our_name: ourName,
      scientific_name: row.scientific_name,
      oz_name: ozName || "",
      status,
    });
  }

  // Summary statistics
  console.log(`\nTotal taxa: ${rows.length}`);
  console.log(`OneZoom has vernacular name: ${hasName} (${((hasName / rows.length) * 100).toFixed(1)}%)`);
  console.log(`OneZoom has NO vernacular name: ${noName} (${((noName / rows.length) * 100).toFixed(1)}%)`);
  console.log(`\nOf the ${hasName} with OneZoom names:`);
  console.log(`  Exact match with our name: ${exactMatch} (${((exactMatch / hasName) * 100).toFixed(1)}%)`);
  console.log(`  Similar to our name: ${similar} (${((similar / hasName) * 100).toFixed(1)}%)`);
  console.log(`  Different from our name: ${different} (${((different / hasName) * 100).toFixed(1)}%)`);

  // Show interesting comparisons
  console.log("\n" + "-".repeat(80));
  console.log("TAXA WHERE NAMES DIFFER (most interesting for investigation)");
  console.log("-".repeat(80));

  const diffRows = comparisons.filter((c) => c.status === "DIFFERENT");
  for (const c of diffRows) {
    console.log(`  OTT ${c.ott_id}: ours="${c.our_name}" | OneZoom="${c.oz_name}" | sci="${c.scientific_name}"`);
  }

  console.log("\n" + "-".repeat(80));
  console.log("TAXA WHERE NAMES ARE SIMILAR (partial match)");
  console.log("-".repeat(80));

  const simRows = comparisons.filter((c) => c.status === "SIMILAR");
  for (const c of simRows) {
    console.log(`  OTT ${c.ott_id}: ours="${c.our_name}" | OneZoom="${c.oz_name}" | sci="${c.scientific_name}"`);
  }

  console.log("\n" + "-".repeat(80));
  console.log("TAXA WITHOUT ONEZOOM VERNACULAR NAMES");
  console.log("-".repeat(80));

  const noRows = comparisons.filter((c) => c.status === "NO_OZ_NAME");
  for (const c of noRows) {
    console.log(`  OTT ${c.ott_id}: ours="${c.our_name}" | sci="${c.scientific_name}"`);
  }

  // Write comparison CSV
  const csvLines = [
    "ott_id,our_name,onezoom_name,scientific_name,status",
  ];
  for (const c of comparisons) {
    csvLines.push(
      [c.ott_id, csvEscape(c.our_name), csvEscape(c.oz_name), csvEscape(c.scientific_name), c.status].join(",")
    );
  }
  fs.writeFileSync(OUTPUT_PATH, csvLines.join("\n") + "\n");
  console.log(`\nFull comparison written to ${OUTPUT_PATH}`);

  // Overall assessment
  console.log("\n" + "=".repeat(80));
  console.log("ASSESSMENT");
  console.log("=".repeat(80));
  console.log(`
OneZoom's vernacular name API (otts2vns) provides English common names for taxa
identified by OTT ID.

Coverage: ${hasName}/${rows.length} (${((hasName / rows.length) * 100).toFixed(1)}%) of our taxa have OneZoom vernacular names.

Quality observations:
- Names are often more formal/scientific than our kid-friendly names
  (e.g., "Domestic cat" vs "cat", "European Rabbit" vs "rabbit")
- Some names use the wild species name rather than the domesticated form
  (e.g., "Red Junglefowl" for chicken's OTT ID)
- Higher taxa names vary in quality (some good like "Frogs and toads",
  others might be too technical)
- Capitalization is inconsistent across entries

The API could serve as:
1. A useful STARTING POINT for names when adding new taxa
2. A FALLBACK for taxa we haven't manually named
3. A VALIDATION TOOL to cross-check our names

However, it should NOT replace our human-curated names because:
1. Our names are intentionally kid-friendly and simplified
2. Some OneZoom names are too formal/scientific for our audience
3. Coverage is not 100%
4. Rate limits (5 per request with public key) make bulk use slow
`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
