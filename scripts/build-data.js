/**
 * Build-data script: reads taxa.csv and fetches the phylogenetic tree
 * from Open Tree of Life's induced_subtree API.
 *
 * Outputs:
 *   - website/src/data/taxa.json   (taxa list with image URLs and comments)
 *   - website/src/data/tree.json   (phylogenetic tree for MRCA lookups)
 *
 * The generated JSON files should be committed to the repository so that
 * the website build does not need to call the Open Tree API.
 *
 * Usage: node scripts/build-data.js
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const CSV_PATH = path.resolve(ROOT, "taxa.csv");
const OUT_DIR = path.resolve(ROOT, "website", "src", "data");

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
// Only monophyletic taxa are allowed, so no broken-taxa handling is needed.
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
// Resolve polytomies – ensure every internal node has at most 2 children.
// The Open Tree API may return "soft polytomies" where evolutionary
// relationships are unresolved.  We resolve them by iteratively grouping
// the last two children into a new unnamed internal node.
// ---------------------------------------------------------------------------

function resolvePolytomies(node) {
  for (const child of node.children) {
    resolvePolytomies(child);
  }
  while (node.children.length > 2) {
    const right = node.children.pop();
    const left = node.children.pop();
    node.children.push({ label: "", children: [left, right] });
  }
}

// ---------------------------------------------------------------------------
// Verify the final tree is binary – no node may have more than 2 children.
// ---------------------------------------------------------------------------

function checkBinaryTree(node) {
  const violations = [];
  function walk(n) {
    if (n.children.length > 2) {
      violations.push({
        name: n.name || "(unnamed)",
        numChildren: n.children.length,
        childNames: n.children.map((c) => c.name || "(unnamed)"),
      });
    }
    for (const child of n.children) {
      walk(child);
    }
  }
  walk(node);
  return violations;
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
// Uses the node_ids API parameter with "ottNNN" strings.
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

  // For each taxon, compute the tree ID to send to the API: "ott" + ott_id
  // (no node_id fallback — broken taxa are not allowed)
  const treeIds = [];          // ordered list of tree IDs
  const treeIdToTaxon = {};    // tree ID string -> CSV row

  for (const t of taxa) {
    const treeId = "ott" + t.ott_id;
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
      const name = seenOtts.get(parseInt(key.replace("ott", ""))) || "?";
      console.error(`   ${key} (${name}) → mapped to ${replacement}`);
    }
    console.error(
      "\nBroken taxa are not allowed.  Remove them from taxa.csv or " +
      "use a monophyletic alternative."
    );
    process.exit(1);
  }

  // Parse and simplify the tree
  const rawTree = parseNewick(treeData.newick);
  const idSet = new Set(treeIds);
  const simplified = simplifyTree(rawTree, idSet);

  // NOTE: we do NOT binarize at build time.  The tree may contain soft
  // polytomies (nodes with >2 children).  Binarization is done at runtime
  // when needed (e.g. for maze embedding).  The resolvePolytomies() and
  // checkBinaryTree() helpers above are kept for that purpose.

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
  // Use local image paths when downloaded images exist in website/public/taxa-images/
  const IMG_DIR = path.join(ROOT, "website", "public", "taxa-images");
  const localImageFiles = fs.existsSync(IMG_DIR)
    ? new Set(fs.readdirSync(IMG_DIR))
    : new Set();

  function resolveImageUrl(ottId, csvUrl) {
    if (!ottId) return csvUrl || null;
    for (const ext of ["jpg", "jpeg", "png", "gif", "webp"]) {
      if (localImageFiles.has(`${ottId}.${ext}`)) {
        return `/taxa-images/${ottId}.${ext}`;
      }
    }
    return csvUrl || null;
  }

  const taxaJson = taxa.map((t) => {
    const entry = {
      name: t.name,
      ott_id: Number(t.ott_id),
      image_url: resolveImageUrl(t.ott_id, t.image_url),
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
