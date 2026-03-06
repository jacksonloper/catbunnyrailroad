/**
 * Build-time script: reads species.csv (with image_url column) and fetches
 * the phylogenetic tree from Open Tree of Life's induced_subtree API.
 *
 * Outputs:
 *   - src/data/species.json  (species list with image URLs)
 *   - src/data/tree.json     (phylogenetic tree for MRCA lookups)
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
// Tree simplification – collapse single-child internal nodes, keep only
// nodes relevant to our species list
// ---------------------------------------------------------------------------

function simplifyTree(node, ottSet, brokenMap) {
  // Check if this node is a "broken" taxon replacement
  if (node.label && brokenMap.has(node.label)) {
    // Treat this internal node as a leaf for the broken taxon's OTT ID
    node.ott_id = brokenMap.get(node.label);
    node.isSpecies = true;
    node.isBroken = true;
    node.brokenMrcaLabel = node.label;
    node.children = [];
    return node;
  }

  // Tag leaves that are in our species set
  if (node.children.length === 0) {
    node.isSpecies = ottSet.has(node.ott_id);
    return node.isSpecies ? node : null;
  }

  // Recursively simplify children
  node.children = node.children
    .map((c) => simplifyTree(c, ottSet, brokenMap))
    .filter(Boolean);

  // If no children remain, prune this node
  if (node.children.length === 0) return null;

  // Collapse single-child nodes
  if (node.children.length === 1) return node.children[0];

  return node;
}

// ---------------------------------------------------------------------------
// Convert simplified tree to a compact JSON format suitable for the browser.
// Each node has:  { id, name, children: [ids...] }
// Leaf nodes also have: { ott_id, speciesName }
// ---------------------------------------------------------------------------

function treeToCompact(node, speciesByOtt) {
  // For leaf nodes (species)
  if (node.children.length === 0) {
    const sp = speciesByOtt[node.ott_id];
    const result = {
      name: sp ? sp.name : node.taxon || node.label,
      ott_id: node.ott_id,
      children: [],
    };
    if (node.isBroken) {
      result.broken = true;
      result.mrca_label = node.brokenMrcaLabel;
    }
    return result;
  }

  // For internal nodes
  return {
    name: node.taxon || node.label || "",
    ott_id: node.ott_id || null,
    children: node.children.map((c) => treeToCompact(c, speciesByOtt)),
  };
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
// Resolve unnamed internal nodes by querying the MRCA API with two
// descendant leaves.  This gives us proper taxon names like "Carnivora".
// ---------------------------------------------------------------------------

function collectLeafOtts(node) {
  if (node.children.length === 0) return [node.ott_id];
  return node.children.flatMap(collectLeafOtts);
}

async function resolveNodeNames(node) {
  // Only resolve nodes whose name starts with "mrca" (unnamed internal nodes)
  if (node.children.length > 0 && node.name && node.name.startsWith("mrca")) {
    // Use the first leaf from each child subtree to get a more precise MRCA
    const childLeafSets = node.children.map(collectLeafOtts);
    const ottA = childLeafSets[0]?.[0];
    const ottB = childLeafSets[childLeafSets.length - 1]?.[0];
    if (ottA && ottB && ottA !== ottB) {
      try {
        const res = await fetch(
          "https://api.opentreeoflife.org/v3/tree_of_life/mrca",
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ ott_ids: [ottA, ottB] }),
          }
        );
        if (res.ok) {
          const data = await res.json();
          if (data.nearest_taxon?.name) {
            console.log(`  Resolved ${node.name} → ${data.nearest_taxon.name}`);
            node.name = data.nearest_taxon.name;
          }
        }
      } catch (err) {
        console.log(`  Warning: could not resolve ${node.name}: ${err.message}`);
      }
    }
  }

  // Recurse into children
  for (const child of node.children) {
    await resolveNodeNames(child);
  }
}

// ---------------------------------------------------------------------------
// Resolve MRCA taxon names for broken taxa.  Parses the MRCA node label
// (e.g. "mrcaott37377ott106844") to extract two OTT IDs, then queries the
// MRCA API to get the nearest proper taxon name.
// ---------------------------------------------------------------------------

async function resolveBrokenNames(node) {
  if (node.children.length === 0 && node.broken && node.mrca_label) {
    const m = node.mrca_label.match(/mrcaott(\d+)ott(\d+)/);
    if (m) {
      try {
        const res = await fetch(
          "https://api.opentreeoflife.org/v3/tree_of_life/mrca",
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ ott_ids: [parseInt(m[1]), parseInt(m[2])] }),
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
  const species = parseCsv(csv);
  console.log(`Read ${species.length} species from CSV`);

  fs.mkdirSync(OUT_DIR, { recursive: true });

  // Fetch phylogenetic tree
  const ottIds = species.map((sp) => Number(sp.ott_id));
  console.log(`Fetching phylogenetic tree for ${ottIds.length} OTT IDs...`);

  const treeData = await fetchTree(ottIds);
  console.log(`Got Newick tree (${treeData.newick.length} chars)`);

  // Parse and simplify the tree
  const rawTree = parseNewick(treeData.newick);
  const ottSet = new Set(ottIds);

  // Build a map of broken taxa: internal node label -> original OTT ID
  // (for taxa that aren't monophyletic in the synthetic tree)
  const brokenMap = new Map();
  if (treeData.broken) {
    for (const [ottKey, nodeLabel] of Object.entries(treeData.broken)) {
      const ottId = parseInt(ottKey.replace("ott", ""));
      brokenMap.set(nodeLabel, ottId);
      console.log(
        `  Broken taxon: ott${ottId} mapped to node ${nodeLabel}`
      );
    }
  }

  const simplified = simplifyTree(rawTree, ottSet, brokenMap);

  // Build lookup for species
  const speciesByOtt = {};
  for (const sp of species) {
    speciesByOtt[Number(sp.ott_id)] = sp;
  }

  const compactTree = treeToCompact(simplified, speciesByOtt);

  // Resolve unnamed internal nodes (mrcaott...) to proper taxon names
  console.log("Resolving internal node names...");
  await resolveNodeNames(compactTree);

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

  // Build species.json (written after tree processing so we can include
  // broken-taxon metadata)
  const speciesJson = species.map((sp) => {
    const ottId = Number(sp.ott_id);
    const entry = {
      name: sp.name,
      ott_id: ottId,
      image_url: sp.image_url || null,
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
    path.join(OUT_DIR, "species.json"),
    JSON.stringify(speciesJson, null, 2)
  );
  console.log(`Wrote species.json`);

  // Print tree structure for verification
  function printTree(node, indent = 0) {
    const prefix = "  ".repeat(indent);
    const broken = node.broken ? " ≈" : "";
    const label =
      node.children.length === 0
        ? `🌿 ${node.name}${broken}`
        : `📁 ${node.name || "(unnamed)"}`;
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
