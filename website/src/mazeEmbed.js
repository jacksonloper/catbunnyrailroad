/**
 * Tree-in-maze embedding via random spanning tree + subdivision check.
 *
 * Workflow:
 *   1. binarizeTree – ensure every internal node has ≤ 2 children.
 *   2. embedTreeInMaze – generate a random spanning tree of an m×m grid
 *      and check if the binarized tree can be embedded as a topological
 *      minor (subdivision).  Uses a DP algorithm for the check.
 *
 * The algorithm:
 *   1) Generate a random spanning tree of the m×m grid using Kruskal's
 *      algorithm with random edge weights.
 *   2) Convert the user's binary tree to an adjacency list, root at a leaf.
 *   3) For each possible root of the spanning tree, run a DP to check
 *      if the tree can be embedded as a subdivision.
 *   4) If found, extract the actual embedding (vertex mapping + paths).
 */

// ---------------------------------------------------------------------------
// Binarize – resolve polytomies by pairing up the last two children
// ---------------------------------------------------------------------------

/**
 * Return a deep copy of `node` in which every internal node has at most
 * 2 children.  Extra children are grouped into new unnamed internal nodes.
 */
export function binarizeTree(node) {
  if (!node.children || node.children.length === 0) {
    return { ...node, children: [] };
  }
  const children = node.children.map(binarizeTree);
  const result = { ...node, children: [...children] };
  while (result.children.length > 2) {
    const right = result.children.pop();
    const left = result.children.pop();
    result.children.push({
      name: "",
      ott_id: null,
      children: [left, right],
    });
  }
  return result;
}

// ---------------------------------------------------------------------------
// Grid graph and random spanning tree (Kruskal's)
// ---------------------------------------------------------------------------

/**
 * Build all edges of an m×m grid graph.
 * Vertex index: r * m + c.
 * Returns an array of [u, v] pairs.
 */
export function makeGridGraph(m) {
  const edges = [];
  for (let r = 0; r < m; r++) {
    for (let c = 0; c < m; c++) {
      const v = r * m + c;
      if (c + 1 < m) edges.push([v, v + 1]);
      if (r + 1 < m) edges.push([v, v + m]);
    }
  }
  return edges;
}

/**
 * Generate a random spanning tree of an m×m grid using Kruskal's algorithm
 * with random edge weights.
 * Returns adjacency list: adj[v] = [list of neighbor indices].
 */
export function randomSpanningTree(m) {
  const n = m * m;
  const gridEdges = makeGridGraph(m);

  // Assign random weights and sort
  const weighted = gridEdges.map((e) => ({ e, w: Math.random() }));
  weighted.sort((a, b) => a.w - b.w);

  // Union-Find with path compression + union by rank
  const parent = Array.from({ length: n }, (_, i) => i);
  const rank = new Array(n).fill(0);
  function find(x) {
    while (parent[x] !== x) {
      parent[x] = parent[parent[x]];
      x = parent[x];
    }
    return x;
  }
  function unite(a, b) {
    a = find(a);
    b = find(b);
    if (a === b) return false;
    if (rank[a] < rank[b]) {
      const t = a;
      a = b;
      b = t;
    }
    parent[b] = a;
    if (rank[a] === rank[b]) rank[a]++;
    return true;
  }

  const adj = Array.from({ length: n }, () => []);
  for (const { e } of weighted) {
    if (unite(e[0], e[1])) {
      adj[e[0]].push(e[1]);
      adj[e[1]].push(e[0]);
    }
  }
  return adj;
}

// ---------------------------------------------------------------------------
// Tree helpers
// ---------------------------------------------------------------------------

/**
 * Convert a children-array tree to an undirected adjacency list.
 * Returns { adj: number[][], nodes: object[], n: number }.
 */
export function treeToAdj(root) {
  const nodes = [];
  const adj = [];
  function walk(node, parentIdx) {
    const idx = nodes.length;
    nodes.push(node);
    adj.push([]);
    if (parentIdx >= 0) {
      adj[parentIdx].push(idx);
      adj[idx].push(parentIdx);
    }
    for (const child of node.children || []) {
      walk(child, idx);
    }
  }
  walk(root, -1);
  return { adj, nodes, n: nodes.length };
}

/**
 * Root a tree (adjacency list) at a given vertex using iterative DFS.
 * Returns { children: number[][], parent: number[], postorder: number[] }.
 */
function rootTreeAt(adj, root, n) {
  const parent = new Array(n).fill(-1);
  const children = Array.from({ length: n }, () => []);
  const visited = new Array(n).fill(false);
  const postorder = [];

  const stack = [{ v: root, idx: 0 }];
  visited[root] = true;

  while (stack.length > 0) {
    const top = stack[stack.length - 1];
    const neighbors = adj[top.v];
    if (top.idx < neighbors.length) {
      const nb = neighbors[top.idx++];
      if (!visited[nb]) {
        visited[nb] = true;
        parent[nb] = top.v;
        children[top.v].push(nb);
        stack.push({ v: nb, idx: 0 });
      }
    } else {
      postorder.push(top.v);
      stack.pop();
    }
  }

  return { children, parent, postorder };
}

// ---------------------------------------------------------------------------
// Subdivision embedding (DP)
// ---------------------------------------------------------------------------

/**
 * Find two distinct elements y1 ∈ goodA, y2 ∈ goodB (y1 ≠ y2).
 * Returns [y1, y2] or null.
 */
function findDistinctPair(goodA, goodB) {
  for (const ga of goodA) {
    for (const gb of goodB) {
      if (ga !== gb) return [ga, gb];
    }
  }
  return null;
}

/**
 * Follow the Reach chain to find a descendant z of bNode where
 * DP[aNode][z] is true.
 */
function findTarget(aNode, bNode, bChildren, DP, Reach) {
  if (DP[aNode][bNode]) return bNode;
  for (const t of bChildren[bNode]) {
    if (Reach[aNode][t]) return findTarget(aNode, t, bChildren, DP, Reach);
  }
  return -1;
}

/**
 * Collect the path from ancestor `from` down to descendant `to` in rooted B.
 */
function getPathDown(from, to, bParent) {
  const path = [];
  let v = to;
  while (v !== from && v !== -1) {
    path.push(v);
    v = bParent[v];
  }
  path.push(from);
  path.reverse();
  return path;
}

/**
 * Extract the actual vertex mapping and paths after DP finds an embedding.
 */
function extractEmbedding(
  rootA, rootB, aChildren, bChildren, bParent, DP, Reach, nA, aNodes
) {
  const mapping = new Array(nA).fill(-1);
  const paths = [];

  function recurse(u, x) {
    mapping[u] = x;
    const uKids = aChildren[u];

    if (uKids.length === 0) return;

    if (uKids.length === 1) {
      const a = uKids[0];
      for (const y of bChildren[x]) {
        if (Reach[a][y]) {
          const z = findTarget(a, y, bChildren, DP, Reach);
          paths.push({ from: u, to: a, vertices: getPathDown(x, z, bParent) });
          recurse(a, z);
          return;
        }
      }
    }

    if (uKids.length === 2) {
      const a = uKids[0], b = uKids[1];
      const goodA = [], goodB = [];
      for (const y of bChildren[x]) {
        if (Reach[a][y]) goodA.push(y);
        if (Reach[b][y]) goodB.push(y);
      }

      const pair = findDistinctPair(goodA, goodB);
      if (pair) {
        const [y1, y2] = pair;
        const z1 = findTarget(a, y1, bChildren, DP, Reach);
        const z2 = findTarget(b, y2, bChildren, DP, Reach);
        paths.push({ from: u, to: a, vertices: getPathDown(x, z1, bParent) });
        paths.push({ from: u, to: b, vertices: getPathDown(x, z2, bParent) });
        recurse(a, z1);
        recurse(b, z2);
      }
    }
  }

  recurse(rootA, rootB);
  return { mapping, paths, aNodes };
}

/**
 * Check if binary tree A has a subdivision that is a subgraph of tree B.
 *
 * Uses the DP from the problem statement:
 *   - Root A at a leaf rA.
 *   - For each choice of root rB in B, run a postorder DP on A.
 *   - DP[u][x] = can subtree(A,u) be embedded starting at x.
 *   - Reach[u][x] = DP[u][x] OR (∃ child t of x with Reach[u][t]).
 *
 * @param {object} binTree – binarized tree (children-array form)
 * @param {number[][]} bAdj – adjacency list for tree B (spanning tree)
 * @param {number} nB – number of vertices in B
 * @returns {null | { mapping: number[], paths: object[], aNodes: object[] }}
 */
export function findSubdivisionEmbedding(binTree, bAdj, nB) {
  const { adj: aAdj, nodes: aNodes, n: nA } = treeToAdj(binTree);

  if (nA === 0) return null;
  if (nA === 1) {
    return { mapping: [0], paths: [], aNodes };
  }

  // Find a leaf in A for rooting
  let leafA = 0;
  for (let i = 0; i < nA; i++) {
    if (aAdj[i].length <= 1) {
      leafA = i;
      break;
    }
  }

  // Root A at leafA
  const rootedA = rootTreeAt(aAdj, leafA, nA);
  const aChildren = rootedA.children;
  const aPostorder = rootedA.postorder;

  // Order B vertices: try leaves first (more likely to succeed)
  const vertexOrder = [];
  for (let v = 0; v < nB; v++) {
    if (bAdj[v].length === 1) vertexOrder.push(v);
  }
  for (let v = 0; v < nB; v++) {
    if (bAdj[v].length !== 1) vertexOrder.push(v);
  }

  // Allocate DP and Reach tables (reused across rootings)
  const DP = Array.from({ length: nA }, () => new Uint8Array(nB));
  const Reach = Array.from({ length: nA }, () => new Uint8Array(nB));

  for (const rB of vertexOrder) {
    const rootedB = rootTreeAt(bAdj, rB, nB);
    const bChildren = rootedB.children;
    const bPostorder = rootedB.postorder;

    // Clear tables
    for (let u = 0; u < nA; u++) {
      DP[u].fill(0);
      Reach[u].fill(0);
    }

    // Process A in postorder
    for (const u of aPostorder) {
      const uKids = aChildren[u];

      if (uKids.length === 0) {
        // Leaf: can map to any vertex
        DP[u].fill(1);
      } else if (uKids.length === 1) {
        const a = uKids[0];
        for (let x = 0; x < nB; x++) {
          const xKids = bChildren[x];
          let ok = 0;
          for (let j = 0; j < xKids.length; j++) {
            if (Reach[a][xKids[j]]) {
              ok = 1;
              break;
            }
          }
          DP[u][x] = ok;
        }
      } else {
        // Two children
        const a = uKids[0], b = uKids[1];
        for (let x = 0; x < nB; x++) {
          const xKids = bChildren[x];
          let canA = 0, canB = 0, lastA = -1, lastB = -1;
          for (let j = 0; j < xKids.length; j++) {
            const y = xKids[j];
            if (Reach[a][y]) {
              canA++;
              lastA = y;
            }
            if (Reach[b][y]) {
              canB++;
              lastB = y;
            }
          }
          if (canA >= 1 && canB >= 1) {
            DP[u][x] =
              canA >= 2 || canB >= 2 || lastA !== lastB ? 1 : 0;
          }
        }
      }

      // Compute Reach[u] in postorder of B
      for (const x of bPostorder) {
        if (DP[u][x]) {
          Reach[u][x] = 1;
        } else {
          const xKids = bChildren[x];
          for (let j = 0; j < xKids.length; j++) {
            if (Reach[u][xKids[j]]) {
              Reach[u][x] = 1;
              break;
            }
          }
        }
      }
    }

    if (DP[leafA][rB]) {
      return extractEmbedding(
        leafA, rB, aChildren, bChildren, rootedB.parent,
        DP, Reach, nA, aNodes
      );
    }
  }

  return null;
}

// ---------------------------------------------------------------------------
// BFS path finder (for filling in grid paths between adjacent tree vertices)
// ---------------------------------------------------------------------------

/**
 * Find a shortest path between two vertices in a graph via BFS.
 * Returns the path as an array of vertex indices, or null if unreachable.
 */
export function bfsPath(adj, from, to, n) {
  if (from === to) return [from];
  const visited = new Uint8Array(n);
  const prev = new Int32Array(n).fill(-1);
  visited[from] = 1;
  const queue = [from];
  let head = 0;
  while (head < queue.length) {
    const v = queue[head++];
    for (const u of adj[v]) {
      if (!visited[u]) {
        visited[u] = 1;
        prev[u] = v;
        if (u === to) {
          const path = [];
          let cur = to;
          while (cur !== -1) {
            path.push(cur);
            cur = prev[cur];
          }
          path.reverse();
          return path;
        }
        queue.push(u);
      }
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// High-level entry point
// ---------------------------------------------------------------------------

/**
 * Embed a binary tree into a random m×m grid spanning tree.
 *
 * @param {object} binTree – binary tree with children arrays
 * @param {number} m – grid side length
 * @returns {object|null} – { width, height, placements, edges, mazeEdges } or null
 */
export function embedTreeInMaze(binTree, m) {
  const stAdj = randomSpanningTree(m);
  const result = findSubdivisionEmbedding(binTree, stAdj, m * m);
  if (!result) return null;

  const { mapping, paths, aNodes } = result;
  const n = m * m;

  // Collect all vertices and edges used in the embedding
  const usedVertices = new Set();
  const usedEdgeKeys = new Set();

  for (let i = 0; i < mapping.length; i++) {
    if (mapping[i] >= 0) usedVertices.add(mapping[i]);
  }

  for (const p of paths) {
    for (const v of p.vertices) usedVertices.add(v);
    for (let i = 0; i + 1 < p.vertices.length; i++) {
      const u = p.vertices[i], v = p.vertices[i + 1];
      usedEdgeKeys.add(Math.min(u, v) + "|" + Math.max(u, v));
    }
  }

  // Map from B vertex to A node (for tree nodes only)
  const bVertToANode = new Map();
  for (let i = 0; i < mapping.length; i++) {
    if (mapping[i] >= 0) {
      bVertToANode.set(mapping[i], aNodes[i]);
    }
  }

  // Build placements
  const placements = [];
  for (const v of usedVertices) {
    const r = Math.floor(v / m);
    const c = v % m;
    const node = bVertToANode.get(v) || { isTaxon: false };
    placements.push({ node, row: r, col: c });
  }

  // Build embedded tree edges
  const edges = [];
  for (const key of usedEdgeKeys) {
    const parts = key.split("|").map(Number);
    const r1 = Math.floor(parts[0] / m), c1 = parts[0] % m;
    const r2 = Math.floor(parts[1] / m), c2 = parts[1] % m;
    edges.push({ from: { x: c1, y: r1 }, to: { x: c2, y: r2 } });
  }

  // Build full spanning tree edges (the "maze")
  const mazeEdges = [];
  for (let v = 0; v < n; v++) {
    for (const u of stAdj[v]) {
      if (u > v) {
        const r1 = Math.floor(v / m), c1 = v % m;
        const r2 = Math.floor(u / m), c2 = u % m;
        mazeEdges.push({ from: { x: c1, y: r1 }, to: { x: c2, y: r2 } });
      }
    }
  }

  return { width: m, height: m, placements, edges, mazeEdges };
}
