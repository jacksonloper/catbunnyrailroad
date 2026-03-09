/**
 * Build-time script: reads species.csv (with image_url, node_id, comments
 * columns) and fetches the phylogenetic tree from Open Tree of Life's
 * induced_subtree API.
 *
 * Outputs:
 *   - src/data/taxa.json   (taxa list with image URLs and comments)
 *   - src/data/tree.json   (phylogenetic tree for MRCA lookups)
 *
 * Usage: node scripts/build-data.js
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const CSV_PATH = path.resolve(ROOT, "..", "species.csv");
const OUT_DIR = path.resolve(ROOT, "src", "data");

// ---------------------------------------------------------------------------
// CSV parsing – handles double-quoted fields (RFC 4180)
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
      // Quoted field
      let val = "";
      i++; // skip opening quote
      while (i < line.length) {
        if (line[i] === '"') {
          if (i + 1 < line.length && line[i + 1] === '"') {
            val += '"';
            i += 2;
          } else {
            i++; // skip closing quote
            break;
          }
        } else {
          val += line[i++];
        }
      }
      fields.push(val);
      if (i < line.length && line[i] === ",") i++; // skip delimiter
    } else {
      // Unquoted field
      let val = "";
      while (i < line.length && line[i] !== ",") {
        val += line[i++];
      }
      fields.push(val);
      if (i < line.length) i++; // skip delimiter
    }
  }
  return fields;
}

function parseCsv(text) {
  const lines = text.trim().split("\n");
  const header = parseCsvLine(lines[0]).map((h) => h.trim());
  return lines.slice(1).map((line) => {
    const vals = parseCsvLine(line);
    const obj = {};
    header.forEach((h, i) => (obj[h] = vals[i]?.trim() ?? ""));
    return obj;
  });
}

// ---------------------------------------------------------------------------
// Newick parser – turns a Newick string into a nested JSON tree.
// Handles single-quoted labels (which may contain spaces and parens).
// ---------------------------------------------------------------------------

function parseNewick(nwk) {
  let i = 0;

  function readLabel() {
    let label = "";
    // Handle quoted labels
    if (i < nwk.length && nwk[i] === "'") {
      i++; // skip opening quote
      while (i < nwk.length && nwk[i] !== "'") {
        label += nwk[i++];
      }
      if (i < nwk.length) i++; // skip closing quote
    } else {
      while (i < nwk.length && !",():;".includes(nwk[i])) {
        label += nwk[i++];
      }
    }
    return label;
  }

  function readNode() {
    const node = { children: [] };

    if (nwk[i] === "(") {
      i++; // skip '('
      node.children.push(readNode());
      while (nwk[i] === ",") {
        i++; // skip ','
        node.children.push(readNode());
      }
      i++; // skip ')'
    }

    const label = readLabel();

    // Skip branch length if present
    if (nwk[i] === ":") {
      i++; // skip ':'
      while (i < nwk.length && !",();".includes(nwk[i])) i++;
    }

    // Parse label for name and ott_id
    if (label) {
      node.label = label;
      // Match ott_id: may end with " ottNNN" (quoted) or "_ottNNN" (unquoted)
      const ottMatch = label.match(/(?:[\s_]|\b)ott(\d+)$/);
      if (ottMatch) {
        node.ott_id = parseInt(ottMatch[1]);
        node.taxon = label
          .replace(/[\s_]ott\d+$/, "")
          .replace(/ \(.*?\)/g, "")  // remove parenthetical qualifiers
          .replace(/_/g, " ");
      }
    }

    return node;
  }

  const tree = readNode();
  return tree;
}

// ---------------------------------------------------------------------------
// Tree simplification – prune branches that contain no taxa of interest.
// Taxa may sit on internal nodes; we do NOT force them to be leaves.
// With the node_id approach, no broken taxa should exist in the API response,
// so we do not need to handle them here.
// ---------------------------------------------------------------------------

function simplifyTree(node, idSet) {
  // Mark this node if its ID (label or ott_id) matches one of our taxa
  const ottKey = node.ott_id ? "ott" + node.ott_id : null;
  if (node.label && idSet.has(node.label)) {
    node.isTaxon = true;
    node.treeId = node.label;
  } else if (ottKey && idSet.has(ottKey)) {
    node.isTaxon = true;
    node.treeId = ottKey;
  }

  // Recursively simplify children
  node.children = node.children
    .map((c) => simplifyTree(c, idSet))
    .filter(Boolean);

  // Prune: if this is a leaf and not a taxon, drop it
  if (node.children.length === 0 && !node.isTaxon) return null;

  // Collapse single-child internal nodes (unless this node is a taxon)
  if (node.children.length === 1 && !node.isTaxon) return node.children[0];

  return node;
}

// ---------------------------------------------------------------------------
// Convert simplified tree to a compact JSON format suitable for the browser.
// Each node has:  { name, ott_id, children: [...] }
// Taxa nodes also have:  { isTaxon: true }
// ---------------------------------------------------------------------------

function treeToCompact(node, taxaByTreeId) {
  const sp = node.treeId ? taxaByTreeId[node.treeId] : null;

  const result = {
    name: sp ? sp.name : node.taxon || node.label || "",
    ott_id: sp ? Number(sp.ott_id) : (node.ott_id || null),
    children: node.children.map((c) => treeToCompact(c, taxaByTreeId)),
  };

  if (node.isTaxon) {
    result.isTaxon = true;
  }

  return result;
}

// ---------------------------------------------------------------------------
// Fetch phylogenetic tree from Open Tree of Life
// Uses node_ids (strings) which can be "ottNNN" or "mrcaottNNNottNNN".
// ---------------------------------------------------------------------------

async function fetchTree(nodeIds) {
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
  return res.json();
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  const csv = fs.readFileSync(CSV_PATH, "utf-8");
  const allRows = parseCsv(csv);
  console.log(`Read ${allRows.length} rows from CSV`);

  // Validate: every row must have a valid, unique OTT ID
  const seenOtts = new Map();
  const taxa = [];
  for (const row of allRows) {
    const ottId = Number(row.ott_id);
    if (!ottId) {
      console.error(`❌ Row with invalid ott_id: ${row.name}`);
      process.exit(1);
    }
    if (seenOtts.has(ottId)) {
      console.error(
        `❌ Duplicate ott_id ${ottId}: "${row.name}" and "${seenOtts.get(ottId)}"`
      );
      process.exit(1);
    }
    seenOtts.set(ottId, row.name);
    taxa.push(row);
  }

  fs.mkdirSync(OUT_DIR, { recursive: true });

  // For each taxon, compute the tree ID to send to the API:
  // use node_id if present, otherwise "ott" + ott_id
  const treeIds = [];          // ordered list of tree IDs
  const treeIdToTaxon = {};    // tree ID string -> CSV row
  const seenTreeIds = new Map();

  for (const t of taxa) {
    const treeId = t.node_id || ("ott" + t.ott_id);
    if (seenTreeIds.has(treeId)) {
      console.error(
        `❌ Duplicate tree placement ID "${treeId}": ` +
        `"${t.name}" and "${seenTreeIds.get(treeId)}"`
      );
      process.exit(1);
    }
    seenTreeIds.set(treeId, t.name);
    treeIds.push(treeId);
    treeIdToTaxon[treeId] = t;
  }

  console.log(`Fetching phylogenetic tree for ${treeIds.length} node IDs...`);
  const treeData = await fetchTree(treeIds);
  console.log(`Got Newick tree (${treeData.newick.length} chars)`);

  // If the API reports ANY broken (non-monophyletic) taxa, that's a build
  // error.  The CSV must be adjusted so that every ID we send resolves
  // directly to a node in the synthetic tree.
  if (treeData.broken && Object.keys(treeData.broken).length > 0) {
    console.error("❌ The API reported broken (non-monophyletic) taxa:");
    for (const [key, replacement] of Object.entries(treeData.broken)) {
      const name = seenTreeIds.get(key) || seenOtts.get(parseInt(key.replace("ott", ""))) || "?";
      console.error(`   ${key} (${name}) → mapped to ${replacement}`);
      console.error(
        `   Fix: add node_id="${replacement}" to this row in species.csv`
      );
    }
    console.error(
      "\nAdd a node_id column value for each broken taxon and re-run the build."
    );
    process.exit(1);
  }

  // Parse and simplify the tree
  const rawTree = parseNewick(treeData.newick);
  const idSet = new Set(treeIds);
  const simplified = simplifyTree(rawTree, idSet);

  const compactTree = treeToCompact(simplified, treeIdToTaxon);

  // Verify that every taxon appears exactly once in the tree
  const treeOtts = new Map();
  function collectTaxaOtts(node) {
    if (node.isTaxon) {
      if (treeOtts.has(node.ott_id)) {
        console.error(
          `❌ Taxon ott_id ${node.ott_id} appears more than once in the tree ` +
          `("${node.name}" and "${treeOtts.get(node.ott_id)}")`
        );
        process.exit(1);
      }
      treeOtts.set(node.ott_id, node.name);
    }
    for (const child of node.children) {
      collectTaxaOtts(child);
    }
  }
  collectTaxaOtts(compactTree);

  const missingFromTree = taxa.filter((t) => !treeOtts.has(Number(t.ott_id)));
  if (missingFromTree.length > 0) {
    console.error(
      `❌ ${missingFromTree.length} taxa not found in tree: ` +
      missingFromTree.map((t) => `ott${t.ott_id} (${t.name})`).join(", ")
    );
    process.exit(1);
  }

  // Internal node names are not displayed in the tree (topology-only rendering),
  // so skip the MRCA API calls that would resolve them.
  console.log("Skipping internal node name resolution (topology-only tree).");

  fs.writeFileSync(
    path.join(OUT_DIR, "tree.json"),
    JSON.stringify(compactTree, null, 2)
  );
  console.log(`Wrote tree.json`);

  // Build taxa.json with comments
  const taxaJson = taxa.map((t) => {
    const entry = {
      name: t.name,
      ott_id: Number(t.ott_id),
      image_url: t.image_url || null,
    };
    if (t.comments) {
      entry.comments = t.comments;
    }
    return entry;
  });

  fs.writeFileSync(
    path.join(OUT_DIR, "taxa.json"),
    JSON.stringify(taxaJson, null, 2)
  );
  console.log(`Wrote taxa.json`);

  // Print tree structure for verification
  function printTree(node, indent = 0) {
    const prefix = "  ".repeat(indent);
    const taxon = node.isTaxon ? " ★" : "";
    const label =
      node.children.length === 0
        ? `🌿 ${node.name}${taxon}`
        : `📁 ${node.name || "(unnamed)"}${taxon}`;
    console.log(`${prefix}${label}`);
    for (const child of node.children) {
      printTree(child, indent + 1);
    }
  }
  console.log("\nTree structure:");
  printTree(compactTree);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
