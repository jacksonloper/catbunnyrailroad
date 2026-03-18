import tree from "./data/tree.json";
import taxa from "./data/taxa.json";

/* ───── module-level data ───── */

const taxaList = taxa;
const taxaByOttId = new Map(taxa.map((t) => [t.ott_id, t]));

/* ───── tree helpers ───── */

/**
 * Find the path from root to a node with the given ott_id.
 * Returns an array of nodes from root down, or null if not found.
 */
function findPath(node, ottId, path = []) {
  const current = [...path, node];
  if (node.ott_id === ottId) return current;
  if (!node.children) return null;
  for (const child of node.children) {
    const result = findPath(child, ottId, current);
    if (result) return result;
  }
  return null;
}

/**
 * Find the MRCA of two taxa given their ott_ids.
 * Returns the deepest common node in their paths from the root.
 */
function findMRCA(ottId1, ottId2) {
  const path1 = findPath(tree, ottId1);
  const path2 = findPath(tree, ottId2);
  if (!path1 || !path2) return null;

  let mrca = tree;
  const minLen = Math.min(path1.length, path2.length);
  for (let i = 0; i < minLen; i++) {
    if (path1[i] === path2[i]) mrca = path1[i];
    else break;
  }
  return mrca;
}

/**
 * Get the depth of the MRCA of two taxa.
 * Deeper = more closely related.
 * Computes directly from path prefix comparison.
 */
function mrcaDepth(ottId1, ottId2) {
  const path1 = findPath(tree, ottId1);
  const path2 = findPath(tree, ottId2);
  if (!path1 || !path2) return -1;
  let depth = 0;
  const minLen = Math.min(path1.length, path2.length);
  for (let i = 0; i < minLen; i++) {
    if (path1[i] === path2[i]) depth = i;
    else break;
  }
  return depth;
}

/* ───── quiz logic ───── */

/**
 * Pick n random taxa from the full taxa list using Fisher-Yates shuffle.
 */
export function pickRandomTaxa(n = 3) {
  const arr = [...taxaList];
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr.slice(0, n);
}

/**
 * Given three taxa (by ott_id), determine which is the outgroup
 * (most distantly related).
 *
 * Returns { outgroupIndex, mrcaTree } where:
 * - outgroupIndex: 0, 1, or 2 — index of the most distantly related taxon
 * - mrcaTree: a 3-node tree representing the relationships:
 *   { name, children: [ { name, taxa: [closer pair] }, { name, taxa: [outgroup] } ] }
 *
 * If all three are equally related (star topology), outgroupIndex is null.
 */
export function solveQuiz(ottIds) {
  const [a, b, c] = ottIds;

  // Compute MRCA depth for each pair
  const depthAB = mrcaDepth(a, b);
  const depthAC = mrcaDepth(a, c);
  const depthBC = mrcaDepth(b, c);

  // The pair with deepest MRCA is the closest pair; the third is the outgroup
  const maxDepth = Math.max(depthAB, depthAC, depthBC);

  // Check for star topology (all MRCAs at same depth)
  if (depthAB === depthAC && depthAC === depthBC) {
    // Star topology — all equally related
    const mrcaAll = findMRCA(a, b);
    const rootName = mrcaAll ? mrcaAll.name : "MRCA";
    return {
      outgroupIndex: null,
      mrcaTree: {
        name: rootName,
        taxa: ottIds.map((id) => taxaByOttId.get(id)),
        children: [],
      },
    };
  }

  let outgroupIndex, closerPair, outgroupOtt;
  if (depthAB === maxDepth) {
    // A and B are closest, C is the outgroup
    outgroupIndex = 2;
    closerPair = [a, b];
    outgroupOtt = c;
  } else if (depthAC === maxDepth) {
    // A and C are closest, B is the outgroup
    outgroupIndex = 1;
    closerPair = [a, c];
    outgroupOtt = b;
  } else {
    // B and C are closest, A is the outgroup
    outgroupIndex = 0;
    closerPair = [b, c];
    outgroupOtt = a;
  }

  const mrcaPair = findMRCA(closerPair[0], closerPair[1]);
  const mrcaAll = findMRCA(closerPair[0], outgroupOtt);

  const mrcaTree = {
    name: mrcaAll ? mrcaAll.name : "MRCA",
    taxa: ottIds.map((id) => taxaByOttId.get(id)),
    children: [
      {
        name: mrcaPair ? mrcaPair.name : "MRCA",
        taxa: closerPair.map((id) => taxaByOttId.get(id)),
        children: [],
      },
      {
        name: taxaByOttId.get(outgroupOtt)?.name || "?",
        taxa: [taxaByOttId.get(outgroupOtt)],
        children: [],
      },
    ],
  };

  return { outgroupIndex, mrcaTree };
}

/** Export for testing */
export { findPath, findMRCA, mrcaDepth, taxaList, taxaByOttId };
