#!/usr/bin/env node

/**
 * fill-ott-ids.mjs
 *
 * Reads taxa.csv and looks for rows where ott_id is missing.
 * For each such row, uses the Open Tree of Life TNRS (Taxonomic Name
 * Resolution Service) match_names endpoint to look up the OTT ID.
 *
 * Also fills in the ott_name and uniqname columns for every row that
 * has an OTT ID (using the taxonomy/taxon_info endpoint).
 *
 * After filling, validates that none of the OTT IDs are broken
 * (non-monophyletic) in the synthetic tree.  Broken taxa are not
 * allowed — fix the CSV before proceeding.
 *
 * Updates taxa.csv in place.
 *
 * Usage:  node scripts/fill-ott-ids.mjs
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
// Open Tree of Life – TNRS name matching
// ---------------------------------------------------------------------------

/**
 * Query the TNRS match_names endpoint for a batch of names.
 * Returns a Map<string, { ott_id, ott_name, uniqname }> keyed by lowercase queried name.
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
      results.set(queriedName, {
        ott_id: bestMatch.taxon.ott_id,
        ott_name: bestMatch.taxon.name ?? "",
        uniqname: bestMatch.taxon.unique_name ?? "",
      });
    }
  }

  return results;
}

/**
 * Query the taxonomy/taxon_info endpoint for a single OTT ID.
 * Returns { ott_name, uniqname } or null on failure.
 */
async function fetchTaxonInfo(ottId) {
  const res = await fetch(
    "https://api.opentreeoflife.org/v3/taxonomy/taxon_info",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ott_id: Number(ottId) }),
    }
  );
  if (!res.ok) return null;
  const data = await res.json();
  return {
    ott_name: data.name ?? "",
    uniqname: data.unique_name ?? "",
  };
}

/**
 * Validate OTT IDs against the synthetic tree.
 * Calls the induced_subtree API and checks for broken (non-monophyletic) taxa.
 * Returns the list of broken entries (empty array means all OK).
 */
async function checkForBrokenTaxa(rows) {
  const nodeIds = rows.filter((r) => r.ott_id).map((r) => "ott" + r.ott_id);
  if (nodeIds.length === 0) return [];

  const res = await fetch(
    "https://api.opentreeoflife.org/v3/tree_of_life/induced_subtree",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ node_ids: nodeIds }),
    }
  );

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Open Tree of Life API error: ${res.status}\n${body}`);
  }

  const data = await res.json();
  const broken = [];
  if (data.broken && Object.keys(data.broken).length > 0) {
    const ottToName = new Map(rows.map((r) => ["ott" + r.ott_id, r.name]));
    for (const [key, replacement] of Object.entries(data.broken)) {
      broken.push({
        key,
        name: ottToName.get(key) || "?",
        replacement,
      });
    }
  }
  return broken;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  const csvText = fs.readFileSync(CSV_PATH, "utf-8");
  const { header, rows } = parseCsv(csvText);
  console.log(`Read ${rows.length} taxa from ${CSV_PATH}`);

  // --- Phase 1: Fill missing OTT IDs via TNRS ---
  const missing = rows.filter((r) => !r.ott_id);
  if (missing.length > 0) {
    console.log(`Found ${missing.length} rows without OTT IDs.`);

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
        const match = idMap.get(queryName);
        if (match) {
          console.log(`  ✓ ${row.name} (${queryName}) → ott_id=${match.ott_id}`);
          row.ott_id = String(match.ott_id);
          row.ott_name = match.ott_name;
          row.uniqname = match.uniqname;
          updated++;
        } else {
          console.log(`  ✗ ${row.name} (${queryName}) — no match found`);
        }
      }
    }

    if (updated > 0) {
      console.log(`\nFilled ${updated} OTT ID(s).`);
    } else {
      console.log("\nNo new OTT IDs found.");
    }
  } else {
    console.log("All rows already have OTT IDs.");
  }

  // --- Phase 2: Fill missing ott_name / uniqname via taxon_info ---
  const needInfo = rows.filter(
    (r) => r.ott_id && (!r.ott_name || !r.uniqname)
  );
  if (needInfo.length > 0) {
    console.log(
      `\nFilling ott_name/uniqname for ${needInfo.length} row(s)...`
    );
    for (const row of needInfo) {
      const info = await fetchTaxonInfo(row.ott_id);
      if (info) {
        row.ott_name = info.ott_name;
        row.uniqname = info.uniqname;
        console.log(`  ✓ ${row.name} → ${info.ott_name} (${info.uniqname})`);
      } else {
        console.log(`  ✗ ${row.name} — taxon_info lookup failed`);
      }
    }
  }

  // Write back (always, so that new columns are populated)
  writeCsv(header, rows, CSV_PATH);
  console.log(`\nWrote ${CSV_PATH}`);

  // --- Phase 3: Check for duplicate OTT IDs ---
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

  // --- Phase 4: Validate against the synthetic tree ---
  console.log("\nChecking for broken (non-monophyletic) taxa...");
  const broken = await checkForBrokenTaxa(rows);
  if (broken.length > 0) {
    console.error("❌ The following taxa are broken (non-monophyletic):");
    for (const b of broken) {
      console.error(`   ${b.key} (${b.name}) → API remapped to ${b.replacement}`);
    }
    console.error(
      "\nBroken taxa are not allowed.  Remove them from taxa.csv or " +
      "use a monophyletic alternative."
    );
    process.exit(1);
  }
  console.log("✅ All taxa are monophyletic in the synthetic tree.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
