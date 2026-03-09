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
  const { header, rows } = parseCsv(csvText);
  console.log(`Read ${rows.length} taxa from ${CSV_PATH}`);

  const missing = rows.filter((r) => !r.ott_id);
  if (missing.length === 0) {
    console.log("All rows already have OTT IDs. Nothing to do.");
    return;
  }

  console.log(`Found ${missing.length} rows without OTT IDs.`);

  // TNRS accepts batches — process in groups of 20 to stay within limits.
  // Prefer scientific_name over name when available (TNRS resolves
  // scientific names far more reliably than common English names).
  const BATCH_SIZE = 20;
  let updated = 0;

  for (let i = 0; i < missing.length; i += BATCH_SIZE) {
    const batch = missing.slice(i, i + BATCH_SIZE);
    const lookupNames = batch.map((r) => r.scientific_name || r.name);
    console.log(
      `\nBatch ${Math.floor(i / BATCH_SIZE) + 1}: looking up ${lookupNames.length} name(s)...`
    );

    const idMap = await matchNames(lookupNames);

    for (const row of batch) {
      const queryName = (row.scientific_name || row.name).toLowerCase();
      const ottId = idMap.get(queryName);
      if (ottId) {
        console.log(`  ✓ ${row.name} (${queryName}) → ott_id=${ottId}`);
        row.ott_id = String(ottId);
        updated++;
      } else {
        console.log(`  ✗ ${row.name} (${queryName}) — no match found`);
      }
    }
  }

  if (updated > 0) {
    writeCsv(header, rows, CSV_PATH);
    console.log(`\nUpdated ${updated} OTT ID(s) in ${CSV_PATH}`);
  } else {
    console.log("\nNo new OTT IDs found.");
  }

  // Check for duplicate OTT IDs — every row must have a unique ID
  const seen = new Map();
  for (const row of rows) {
    if (!row.ott_id) continue;
    const id = String(row.ott_id);
    if (seen.has(id)) {
      console.error(
        `\n❌  Duplicate OTT ID ${id}: "${row.name}" and "${seen.get(id)}"`
      );
      process.exit(1);
    }
    seen.set(id, row.name);
  }
  console.log("✅ No duplicate OTT IDs.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
