/**
 * Build-time script: reads species.csv (with image_url column) and fetches
 * the phylogenetic tree from Open Tree of Life's induced_subtree API.
 *
 * Outputs:
 *   - src/data/taxa.json   (taxa list with image URLs)
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
// CSV parsing
// ---------------------------------------------------------------------------

function parseCsv(text) {
  const lines = text.trim().split("\n");
  const header = lines[0].split(",");
  return lines.slice(1).map((line) => {
    const vals = line.split(",");
    const obj = {};
    header.forEach((h, i) => (obj[h.trim()] = vals[i]?.trim()));
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
// Broken taxa get their ott_id reassigned to the original taxon's OTT ID.
// ---------------------------------------------------------------------------

function simplifyTree(node, ottSet, brokenMap) {
  // Check if this node is a replacement for a broken taxon (by label match).
  // brokenMap: Map<replacementLabel, originalOttId>
  if (node.label && brokenMap.has(node.label)) {
    node.ott_id = brokenMap.get(node.label);
    node.isTaxon = true;
    node.isBroken = true;
    node.brokenMrcaLabel = node.label;
  }

  // Also check OTT-keyed broken entries (e.g. "ott443203" as a key)
  const ottKey = node.ott_id ? "ott" + node.ott_id : null;
  if (!node.isBroken && ottKey && brokenMap.has(ottKey)) {
    node.ott_id = brokenMap.get(ottKey);
    node.isTaxon = true;
    node.isBroken = true;
    node.brokenMrcaLabel = node.label || ottKey;
  }

  // Mark this node if its ott_id is one of our taxa
  if (!node.isTaxon && node.ott_id && ottSet.has(node.ott_id)) {
    node.isTaxon = true;
  }

  // Recursively simplify children
  node.children = node.children
    .map((c) => simplifyTree(c, ottSet, brokenMap))
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
// Broken taxa also have: { broken: true, mrca_label }
// ---------------------------------------------------------------------------

function treeToCompact(node, taxaByOtt) {
  const sp = taxaByOtt[node.ott_id];

  const result = {
    name: sp ? sp.name : node.taxon || node.label || "",
    ott_id: node.ott_id || null,
    children: node.children.map((c) => treeToCompact(c, taxaByOtt)),
  };

  if (node.isTaxon) {
    result.isTaxon = true;
  }
  if (node.isBroken) {
    result.broken = true;
    result.mrca_label = node.brokenMrcaLabel;
  }

  return result;
}

// ---------------------------------------------------------------------------
// Fetch phylogenetic tree from Open Tree of Life
// ---------------------------------------------------------------------------

async function fetchTree(ottIds) {
  const res = await fetch(
    "https://api.opentreeoflife.org/v3/tree_of_life/induced_subtree",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ott_ids: ottIds }),
    }
  );
  if (!res.ok) {
    throw new Error(`Open Tree of Life API error: ${res.status}`);
  }
  return res.json();
}

// ---------------------------------------------------------------------------
// Resolve MRCA taxon names for broken taxa.  Parses the MRCA node label
// (e.g. "mrcaott37377ott106844") to extract two OTT IDs, then queries the
// MRCA API to get the nearest proper taxon name.  Also handles OTT-style
// labels (e.g. "Fagales_ott267709") by querying the taxonomy API directly.
// ---------------------------------------------------------------------------

async function resolveBrokenNames(node) {
  if (node.broken && node.mrca_label) {
    const m = node.mrca_label.match(/mrcaott(\d+)ott(\d+)/);
    if (m) {
      try {
        const res = await fetch(
          "https://api.opentreeoflife.org/v3/tree_of_life/mrca",
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ ott_ids: [parseInt(m[1], 10), parseInt(m[2], 10)] }),
          }
        );
        if (res.ok) {
          const data = await res.json();
          if (data.nearest_taxon?.name) {
            node.mrca_name = data.nearest_taxon.name;
            console.log(
              `  Resolved broken ${node.name} → MRCA taxon: ${data.nearest_taxon.name}`
            );
          }
        }
      } catch (err) {
        console.log(
          `  Warning: could not resolve broken MRCA for ${node.name}: ${err.message}`
        );
      }
    } else {
      // OTT-style label (e.g. "Fagales_ott267709") – query taxonomy API
      const ottMatch = node.mrca_label.match(/ott(\d+)/);
      if (ottMatch) {
        try {
          const res = await fetch(
            "https://api.opentreeoflife.org/v3/taxonomy/taxon_info",
            {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ ott_id: parseInt(ottMatch[1], 10) }),
            }
          );
          if (res.ok) {
            const data = await res.json();
            if (data.name) {
              node.mrca_name = data.name;
              console.log(
                `  Resolved broken ${node.name} → taxon: ${data.name}`
              );
            }
          }
        } catch (err) {
          console.log(
            `  Warning: could not resolve broken taxon for ${node.name}: ${err.message}`
          );
        }
      }
    }
  }
  for (const child of node.children) {
    await resolveBrokenNames(child);
  }
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

  // Fetch phylogenetic tree
  const ottIds = taxa.map((t) => Number(t.ott_id));
  console.log(`Fetching phylogenetic tree for ${ottIds.length} OTT IDs...`);

  const treeData = await fetchTree(ottIds);
  console.log(`Got Newick tree (${treeData.newick.length} chars)`);

  // Parse and simplify the tree
  const rawTree = parseNewick(treeData.newick);
  const ottSet = new Set(ottIds);

  // Build a map of broken taxa: replacement node label -> original OTT ID
  // (for taxa that aren't monophyletic in the synthetic tree)
  const brokenMap = new Map();
  if (treeData.broken) {
    // Check for broken-taxa collisions: two taxa mapping to the same
    // replacement node would be ambiguous and is a build error.
    const replacementToOtts = new Map();
    for (const [ottKey, nodeLabel] of Object.entries(treeData.broken)) {
      const ottId = parseInt(ottKey.replace("ott", ""));
      if (!replacementToOtts.has(nodeLabel)) {
        replacementToOtts.set(nodeLabel, []);
      }
      replacementToOtts.get(nodeLabel).push(ottId);
    }
    for (const [label, ids] of replacementToOtts) {
      if (ids.length > 1) {
        const names = ids.map((id) => `ott${id} (${seenOtts.get(id) || "?"})`);
        console.error(
          `❌ Broken-taxa collision: ${names.join(" and ")} both map to ` +
          `replacement node "${label}". Fix species.csv so this doesn't happen.`
        );
        process.exit(1);
      }
    }

    for (const [ottKey, nodeLabel] of Object.entries(treeData.broken)) {
      const ottId = parseInt(ottKey.replace("ott", ""));
      brokenMap.set(nodeLabel, ottId);
      console.log(
        `  Broken taxon: ott${ottId} mapped to node ${nodeLabel}`
      );
    }
  }

  const simplified = simplifyTree(rawTree, ottSet, brokenMap);

  // Build lookup for taxa by OTT ID
  const taxaByOtt = {};
  for (const t of taxa) {
    taxaByOtt[Number(t.ott_id)] = t;
  }

  const compactTree = treeToCompact(simplified, taxaByOtt);

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

  const missingFromTree = ottIds.filter((id) => !treeOtts.has(id));
  if (missingFromTree.length > 0) {
    console.error(
      `❌ ${missingFromTree.length} taxa not found in tree: ` +
      missingFromTree.map((id) => `ott${id} (${seenOtts.get(id)})`).join(", ")
    );
    process.exit(1);
  }

  // Internal node names are not displayed in the tree (topology-only rendering),
  // so skip the MRCA API calls that would resolve them.
  console.log("Skipping internal node name resolution (topology-only tree).");

  // Resolve MRCA taxon names for broken taxa
  console.log("Resolving broken taxa MRCA names...");
  await resolveBrokenNames(compactTree);

  fs.writeFileSync(
    path.join(OUT_DIR, "tree.json"),
    JSON.stringify(compactTree, null, 2)
  );
  console.log(`Wrote tree.json`);

  // Collect broken taxa OTT IDs and their MRCA names from the tree
  const brokenInfo = {};
  function collectBroken(node) {
    if (node.broken) {
      brokenInfo[node.ott_id] = node.mrca_name || null;
    }
    for (const child of node.children) {
      collectBroken(child);
    }
  }
  collectBroken(compactTree);

  // Build taxa.json (written after tree processing so we can include
  // broken-taxon metadata)
  const taxaJson = taxa.map((t) => {
    const ottId = Number(t.ott_id);
    const entry = {
      name: t.name,
      ott_id: ottId,
      image_url: t.image_url || null,
    };
    if (ottId in brokenInfo) {
      entry.broken = true;
      if (brokenInfo[ottId]) {
        entry.mrca_name = brokenInfo[ottId];
      }
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
    const broken = node.broken ? " ≈" : "";
    const taxon = node.isTaxon ? " ★" : "";
    const label =
      node.children.length === 0
        ? `🌿 ${node.name}${broken}${taxon}`
        : `📁 ${node.name || "(unnamed)"}${broken}${taxon}`;
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
