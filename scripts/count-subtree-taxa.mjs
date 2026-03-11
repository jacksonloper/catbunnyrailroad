#!/usr/bin/env node

/**
 * count-subtree-taxa.mjs
 *
 * Counts the number of taxa (OTT IDs) in a subtree of the Open Tree of Life.
 *
 * Accepts either:
 *   - A numeric OTT ID directly (e.g. 574724 for bats/Chiroptera)
 *   - A name that matches a taxon in taxa.csv (e.g. "bat")
 *
 * Uses the Open Tree of Life tree_of_life/subtree API endpoint to fetch the
 * Newick subtree, then counts distinct ott<id> labels in the result.
 *
 * Usage:
 *   node scripts/count-subtree-taxa.mjs 574724
 *   node scripts/count-subtree-taxa.mjs bat
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const CSV_PATH = path.resolve(ROOT, "taxa.csv");

// ---------------------------------------------------------------------------
// CSV helpers (minimal, matching build-data.js style)
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
    } else {
      const next = line.indexOf(",", i);
      if (next === -1) {
        fields.push(line.slice(i));
        break;
      }
      fields.push(line.slice(i, next));
      i = next;
    }
    if (i < line.length && line[i] === ",") i++;
  }
  return fields;
}

function loadCsv() {
  const text = fs.readFileSync(CSV_PATH, "utf-8");
  const lines = text.split("\n").filter((l) => l.trim());
  const header = parseCsvLine(lines[0]);
  return lines.slice(1).map((line) => {
    const fields = parseCsvLine(line);
    const row = {};
    header.forEach((col, idx) => {
      row[col] = (fields[idx] ?? "").trim();
    });
    return row;
  });
}

// ---------------------------------------------------------------------------
// Resolve the OTT ID from the argument
// ---------------------------------------------------------------------------

function resolveOttId(arg) {
  // If it looks like a number, treat it as an OTT ID directly
  if (/^\d+$/.test(arg)) {
    return { ottId: Number(arg), label: `ott${arg}` };
  }

  // Otherwise, look it up in taxa.csv by name (case-insensitive)
  const rows = loadCsv();
  const match = rows.find(
    (r) => r.name.toLowerCase() === arg.toLowerCase()
  );
  if (match && match.ott_id) {
    return {
      ottId: Number(match.ott_id),
      label: `${match.name} (${match.scientific_name}, ott${match.ott_id})`,
    };
  }

  // Try matching by scientific name too
  const sciMatch = rows.find(
    (r) => r.scientific_name.toLowerCase() === arg.toLowerCase()
  );
  if (sciMatch && sciMatch.ott_id) {
    return {
      ottId: Number(sciMatch.ott_id),
      label: `${sciMatch.name} (${sciMatch.scientific_name}, ott${sciMatch.ott_id})`,
    };
  }

  return null;
}

// ---------------------------------------------------------------------------
// Fetch subtree from Open Tree of Life API
// ---------------------------------------------------------------------------

async function fetchSubtree(ottId) {
  const res = await fetch(
    "https://api.opentreeoflife.org/v3/tree_of_life/subtree",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ott_id: ottId }),
    }
  );
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Open Tree of Life API error: ${res.status}\n${body}`);
  }
  return res.json();
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  const arg = process.argv[2];

  if (!arg) {
    console.error(
      "Usage: node scripts/count-subtree-taxa.mjs <ott_id or name>\n\n" +
        "Examples:\n" +
        "  node scripts/count-subtree-taxa.mjs 574724      # by OTT ID (bats)\n" +
        "  node scripts/count-subtree-taxa.mjs bat          # by name from taxa.csv\n" +
        "  node scripts/count-subtree-taxa.mjs Chiroptera   # by scientific name"
    );
    process.exit(1);
  }

  const resolved = resolveOttId(arg);
  if (!resolved) {
    console.error(
      `❌ Could not resolve "${arg}" to an OTT ID.\n` +
        "   Provide a numeric OTT ID, or a name/scientific_name from taxa.csv."
    );
    process.exit(1);
  }

  console.log(`Fetching subtree for ${resolved.label} ...`);

  const data = await fetchSubtree(resolved.ottId);
  const newick = data.newick ?? "";

  // Count distinct ott<id> labels in the Newick string
  const ottMatches = newick.match(/ott\d+/g) ?? [];
  const uniqueOtts = new Set(ottMatches);

  console.log(`\n✅ ${resolved.label}`);
  console.log(`   Total OTT labels in subtree: ${uniqueOtts.size}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
