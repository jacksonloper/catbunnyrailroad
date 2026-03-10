/**
 * Tree embedding in a square grid maze using the H-tree method.
 *
 * Workflow:
 *   1. binarizeTree – ensure every internal node has ≤ 2 children.
 *   2. embedTreeInMaze – embed the binary tree into a grid using H-tree
 *      recursive subdivision (deterministic, O(n)).
 *
 * The H-tree algorithm:
 *   1) Compute the depth d of the binary tree.
 *   2) Build a complete binary tree layout of depth d using H-tree
 *      recursive subdivision of the grid rectangle.
 *   3) Map the user's binary tree onto the H-tree layout, following
 *      left/right child structure.
 *   4) Only draw passages and corridors for the parts of the H-tree
 *      that the actual tree uses.
 *
 * This is O(n) and works for trees of any size.
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
// Grid graph construction
// ---------------------------------------------------------------------------

/**
 * Build an m × m grid graph.
 * Vertex IDs are "r,c" strings.  Each interior vertex has 4 neighbours;
 * edge vertices have 2–3.
 *
 * @param {number} m – grid side length
 * @returns {{ vertices: string[], adj: Record<string, string[]> }}
 */
export function makeGridGraph(m) {
  const vertices = [];
  const adj = {};
  for (let r = 0; r < m; r++) {
    for (let c = 0; c < m; c++) {
      const v = `${r},${c}`;
      vertices.push(v);
      adj[v] = [];
    }
  }
  for (let r = 0; r < m; r++) {
    for (let c = 0; c < m; c++) {
      const v = `${r},${c}`;
      if (r > 0) adj[v].push(`${r - 1},${c}`);
      if (r < m - 1) adj[v].push(`${r + 1},${c}`);
      if (c > 0) adj[v].push(`${r},${c - 1}`);
      if (c < m - 1) adj[v].push(`${r},${c + 1}`);
    }
  }
  return { vertices, adj };
}

// ---------------------------------------------------------------------------
// Tree → adjacency list conversion
// ---------------------------------------------------------------------------

/**
 * Convert a tree (with .children arrays) into an adjacency list
 * representation suitable for the embedding algorithm.
 * Each node gets a unique string id.  Returns:
 *   { ids: string[], adj: Record<string, string[]>, nodeById: Record<string, object> }
 *
 * The tree is treated as *undirected*: parent–child edges go both ways.
 */
export function treeToAdj(root) {
  let nextId = 0;
  const ids = [];
  const adj = {};
  const nodeById = {};

  function walk(node, parentId) {
    const id = `__node_${nextId++}`;
    node._embId = id;
    ids.push(id);
    adj[id] = [];
    nodeById[id] = node;
    if (parentId != null) {
      adj[parentId].push(id);
      adj[id].push(parentId);
    }
    for (const child of (node.children || [])) {
      walk(child, id);
    }
  }
  walk(root, null);
  return { ids, adj, nodeById };
}

// ---------------------------------------------------------------------------
// Skeleton (suppress degree-2 vertices)
// ---------------------------------------------------------------------------

/**
 * Suppress degree-2 vertices from the tree adjacency list.
 * Returns a "skeleton" with only important vertices (degree ≠ 2)
 * and "super-edges" that record the chain of suppressed vertices.
 *
 * @param {{ ids: string[], adj: Record<string, string[]> }} treeAdj
 * @returns {{
 *   importantVerts: string[],
 *   skelAdj: Record<string, string[]>,
 *   chains: Map<string, string[]>
 * }}
 */
export function buildSkeleton(treeAdj) {
  const { ids, adj } = treeAdj;
  const important = ids.filter((v) => adj[v].length !== 2);
  const importantSet = new Set(important);

  const skelAdj = {};
  for (const v of important) skelAdj[v] = [];

  const chains = new Map();

  const visited = new Set();

  for (const start of important) {
    for (const nb of adj[start]) {
      if (importantSet.has(nb)) {
        const key1 = `${start}|${nb}`;
        const key2 = `${nb}|${start}`;
        if (!visited.has(key1) && !visited.has(key2)) {
          skelAdj[start].push(nb);
          skelAdj[nb].push(start);
          chains.set(key1, []);
          visited.add(key1);
          visited.add(key2);
        }
      } else {
        const chain = [];
        let prev = start;
        let cur = nb;
        while (!importantSet.has(cur)) {
          chain.push(cur);
          const nexts = adj[cur].filter((x) => x !== prev);
          prev = cur;
          cur = nexts[0];
        }
        const end = cur;
        const key1 = `${start}|${end}`;
        const key2 = `${end}|${start}`;
        if (!visited.has(key1) && !visited.has(key2)) {
          skelAdj[start].push(end);
          skelAdj[end].push(start);
          chains.set(key1, chain);
          visited.add(key1);
          visited.add(key2);
        }
      }
    }
  }

  return { importantVerts: important, skelAdj, chains };
}

// ---------------------------------------------------------------------------
// BFS path finding in a graph, avoiding a set of used vertices
// ---------------------------------------------------------------------------

/**
 * Find a shortest path from `src` to `dst` in `graph`, avoiding
 * vertices in `usedSet` (except src and dst themselves).
 * Returns the path as an array of vertex ids, or null if none exists.
 */
export function bfsPath(graph, src, dst, usedSet) {
  if (src === dst) return [src];
  const visited = new Set([src]);
  const parent = new Map();
  const queue = [src];
  let qi = 0;
  while (qi < queue.length) {
    const v = queue[qi++];
    for (const nb of graph.adj[v]) {
      if (visited.has(nb)) continue;
      if (nb !== dst && usedSet.has(nb)) continue;
      visited.add(nb);
      parent.set(nb, v);
      if (nb === dst) {
        const path = [];
        let cur = dst;
        while (cur !== undefined) {
          path.push(cur);
          cur = parent.get(cur);
        }
        path.reverse();
        return path;
      }
      queue.push(nb);
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// Tree subdivision embedding (backtracking search)
// ---------------------------------------------------------------------------

/**
 * Attempt to embed tree A into graph B via tree subdivision.
 *
 * @param {object} treeRoot – tree node with .children arrays
 * @param {{ vertices: string[], adj: Record<string, string[]> }} hostGraph
 * @returns {null | {
 *   hostMap: Map<string, object|null>,
 *   paths: Map<string, string[]>,
 *   placements: { node: object, vertex: string }[]
 * }}
 */
export function findTreeSubdivisionEmbedding(treeRoot, hostGraph) {
  const treeAdj = treeToAdj(treeRoot);
  const skeleton = buildSkeleton(treeAdj);
  const { importantVerts, skelAdj, chains } = skeleton;

  // Edges of the skeleton (unordered, deduplicated)
  const skelEdges = [];
  const seenEdges = new Set();
  for (const u of importantVerts) {
    for (const v of skelAdj[u]) {
      const key = u < v ? `${u}|${v}` : `${v}|${u}`;
      if (!seenEdges.has(key)) {
        seenEdges.add(key);
        skelEdges.push([u, v]);
      }
    }
  }

  const placement = new Map();
  const usedHostVerts = new Set();
  const routedPaths = new Map();

  function routeNewEdges(placedSet) {
    const ready = skelEdges.filter(
      ([u, v]) => placedSet.has(u) && placedSet.has(v)
    );
    const newRoutes = [];
    for (const [u, v] of ready) {
      const key = chains.has(`${u}|${v}`) ? `${u}|${v}` : `${v}|${u}`;
      if (routedPaths.has(key)) continue;

      const chain = chains.get(key) || [];
      const requiredLen = chain.length + 2;

      const src = placement.get(u);
      const dst = placement.get(v);
      const path = bfsPath(hostGraph, src, dst, usedHostVerts);
      if (!path) return null;
      if (path.length < requiredLen) return null;

      routedPaths.set(key, path);
      newRoutes.push(key);
      for (let i = 1; i < path.length - 1; i++) {
        usedHostVerts.add(path[i]);
      }
    }
    return newRoutes;
  }

  function unrouteEdges(keys) {
    for (const key of keys) {
      const path = routedPaths.get(key);
      if (path) {
        for (let i = 1; i < path.length - 1; i++) {
          usedHostVerts.delete(path[i]);
        }
      }
      routedPaths.delete(key);
    }
  }

  // BFS order for placement: root first, then by skeleton adjacency
  const placementOrder = [];
  {
    const visited = new Set();
    const queue = [importantVerts[0]];
    visited.add(importantVerts[0]);
    while (queue.length > 0) {
      const v = queue.shift();
      placementOrder.push(v);
      for (const nb of skelAdj[v]) {
        if (!visited.has(nb)) {
          visited.add(nb);
          queue.push(nb);
        }
      }
    }
  }

  function solve(k) {
    if (k === placementOrder.length) return true;

    const treeVert = placementOrder[k];
    const placedSet = new Set(placementOrder.slice(0, k + 1));

    // Find an already-placed skeleton neighbor (always exists for k > 0
    // because we traverse in BFS order of the skeleton).
    let anchorHost = null;
    let chainLen = 0;
    for (const nb of skelAdj[treeVert]) {
      if (placement.has(nb)) {
        anchorHost = placement.get(nb);
        const key = chains.has(`${treeVert}|${nb}`) ? `${treeVert}|${nb}` : `${nb}|${treeVert}`;
        const chain = chains.get(key) || [];
        chainLen = chain.length;
        break;
      }
    }

    let candidates;
    if (anchorHost != null) {
      // BFS from anchor to find reachable unused vertices within a
      // reasonable distance (chain length + some slack).
      const maxDist = chainLen + Math.ceil(Math.sqrt(hostGraph.vertices.length)) + 2;
      candidates = [];
      const visited = new Set([anchorHost]);
      const queue = [[anchorHost, 0]];
      let qi = 0;
      while (qi < queue.length) {
        const [v, d] = queue[qi++];
        if (d > maxDist) break;
        if (v !== anchorHost && !usedHostVerts.has(v)) {
          candidates.push(v);
        }
        for (const nb of hostGraph.adj[v]) {
          if (!visited.has(nb)) {
            visited.add(nb);
            if (!usedHostVerts.has(nb) || nb === anchorHost) {
              queue.push([nb, d + 1]);
            }
          }
        }
      }
    } else {
      // First vertex – try a sparse set of starting positions
      // (center, then quarter-points, then every other vertex).
      const m = Math.round(Math.sqrt(hostGraph.vertices.length));
      const mid = Math.floor(m / 2);
      const starts = new Set();
      // Center + quarter-points
      for (const r of [mid, Math.floor(m / 4), Math.floor(3 * m / 4), 0, m - 1]) {
        for (const c of [mid, Math.floor(m / 4), Math.floor(3 * m / 4), 0, m - 1]) {
          starts.add(`${r},${c}`);
        }
      }
      candidates = [...starts].filter((v) => hostGraph.adj[v] && !usedHostVerts.has(v));
    }

    for (const hv of candidates) {
      placement.set(treeVert, hv);
      usedHostVerts.add(hv);

      const newRoutes = routeNewEdges(placedSet);
      if (newRoutes !== null) {
        if (solve(k + 1)) return true;
        unrouteEdges(newRoutes);
      }

      placement.delete(treeVert);
      usedHostVerts.delete(hv);
    }
    return false;
  }

  if (!solve(0)) return null;

  const nodeById = treeAdj.nodeById;
  const resultPlacements = [];
  for (const [treeVert, hostVert] of placement) {
    resultPlacements.push({ node: nodeById[treeVert], vertex: hostVert });
  }

  const hostMap = new Map();
  for (const [treeVert, hostVert] of placement) {
    hostMap.set(hostVert, nodeById[treeVert]);
  }
  for (const [, path] of routedPaths) {
    for (let i = 1; i < path.length - 1; i++) {
      if (!hostMap.has(path[i])) hostMap.set(path[i], null);
    }
  }

  return {
    hostMap,
    paths: routedPaths,
    placements: resultPlacements,
  };
}

// ---------------------------------------------------------------------------
// H-tree embedding (fast, deterministic)
// ---------------------------------------------------------------------------

/**
 * Compute the depth (longest root-to-leaf path) of a binary tree.
 */
export function treeDepth(node) {
  if (!node.children || node.children.length === 0) return 0;
  return 1 + Math.max(...node.children.map(treeDepth));
}

/**
 * Compute the minimum grid dimensions for an H-tree embedding of a
 * complete binary tree of the given depth.
 * Odd depths split horizontally (width doubles);
 * even depths split vertically (height doubles).
 *
 * @param {number} depth
 * @returns {{ width: number, height: number }}
 */
export function hTreeDimensions(depth) {
  let w = 1, h = 1;
  for (let d = 1; d <= depth; d++) {
    if (d % 2 === 1) w = 2 * w + 1;
    else h = 2 * h + 1;
  }
  return { width: w, height: h };
}

/**
 * Build the H-tree layout for a complete binary tree of the given depth,
 * fitting into the rectangle [rMin..rMax] × [cMin..cMax].
 * Direction alternates: horizontal splits left/right columns,
 * vertical splits top/bottom rows.
 *
 * @returns {{ row: number, col: number, left: object|null, right: object|null }}
 */
export function buildHTree(depth, rMin, rMax, cMin, cMax, horizontal) {
  const r = Math.floor((rMin + rMax) / 2);
  const c = Math.floor((cMin + cMax) / 2);
  const node = { row: r, col: c, left: null, right: null };
  if (depth === 0) return node;
  if (horizontal) {
    node.left = buildHTree(depth - 1, rMin, rMax, cMin, c - 1, false);
    node.right = buildHTree(depth - 1, rMin, rMax, c + 1, cMax, false);
  } else {
    node.left = buildHTree(depth - 1, rMin, r - 1, cMin, cMax, true);
    node.right = buildHTree(depth - 1, r + 1, rMax, cMin, cMax, true);
  }
  return node;
}

/**
 * Add corridor cells and edges between two grid positions
 * (must share a row or a column).
 */
function _addCorridor(r1, c1, r2, c2, passages, edges) {
  if (r1 === r2) {
    const minC = Math.min(c1, c2);
    const maxC = Math.max(c1, c2);
    for (let c = minC + 1; c < maxC; c++) {
      passages.add(`${r1},${c}`);
    }
    for (let c = minC; c < maxC; c++) {
      edges.push({ r1, c1: c, r2: r1, c2: c + 1 });
    }
  } else {
    const minR = Math.min(r1, r2);
    const maxR = Math.max(r1, r2);
    for (let r = minR + 1; r < maxR; r++) {
      passages.add(`${r},${c1}`);
    }
    for (let r = minR; r < maxR; r++) {
      edges.push({ r1: r, c1, r2: r + 1, c2: c1 });
    }
  }
}

/**
 * Map a user's binary tree onto an H-tree layout, tracing corridors
 * between each parent and its children.  Only the branches actually
 * present in the user's tree are drawn.
 *
 * @param {object} userNode – binary tree node with .children
 * @param {object} hNode – H-tree layout node from buildHTree
 * @returns {{ passages: Set<string>, edges: object[], placements: object[] }}
 */
export function mapTreeToHLayout(userNode, hNode) {
  const passages = new Set();
  const edges = [];
  const placements = [];

  passages.add(`${hNode.row},${hNode.col}`);
  placements.push({ node: userNode, row: hNode.row, col: hNode.col });

  const children = userNode.children || [];

  if (children.length >= 1 && hNode.left) {
    const sub = mapTreeToHLayout(children[0], hNode.left);
    _addCorridor(hNode.row, hNode.col, hNode.left.row, hNode.left.col, passages, edges);
    for (const p of sub.passages) passages.add(p);
    edges.push(...sub.edges);
    placements.push(...sub.placements);
  }

  if (children.length >= 2 && hNode.right) {
    const sub = mapTreeToHLayout(children[1], hNode.right);
    _addCorridor(hNode.row, hNode.col, hNode.right.row, hNode.right.col, passages, edges);
    for (const p of sub.passages) passages.add(p);
    edges.push(...sub.edges);
    placements.push(...sub.placements);
  }

  return { passages, edges, placements };
}

/**
 * Compute the minimum square grid size needed for H-tree embedding
 * of the given binary tree.
 */
export function computeMinMazeSize(binTree) {
  const d = treeDepth(binTree);
  const { width, height } = hTreeDimensions(d);
  return Math.max(width, height);
}

// ---------------------------------------------------------------------------
// High-level entry point
// ---------------------------------------------------------------------------

/**
 * Embed a binary tree into an m × m grid maze using H-tree layout.
 *
 * @param {object} binTree – binary tree (each node has 0–2 children)
 * @param {number} m – grid side length (e.g. 7, 9, 11)
 * @returns {{ grid: object[][], size: number, placements: object[], edges: object[] } | null}
 *   null if the tree cannot be embedded in the given grid size.
 *   Otherwise:
 *     grid[r][c].passage – true if the cell is part of the tree
 *     grid[r][c].node    – the tree node placed here, or null for corridors
 *     placements         – flat list of { node, row, col }
 *     edges              – list of { r1, c1, r2, c2 } tree edges in the grid
 */
export function embedTreeInMaze(binTree, m) {
  const depth = treeDepth(binTree);
  const { width, height } = hTreeDimensions(depth);
  const minSize = Math.max(width, height);

  if (m < minSize) return null;

  const hLayout = buildHTree(depth, 0, m - 1, 0, m - 1, true);
  const mapping = mapTreeToHLayout(binTree, hLayout);

  const grid = Array.from({ length: m }, () =>
    Array.from({ length: m }, () => ({ passage: false, node: null }))
  );

  for (const key of mapping.passages) {
    const [r, c] = key.split(",").map(Number);
    grid[r][c].passage = true;
  }

  for (const p of mapping.placements) {
    grid[p.row][p.col].node = p.node;
  }

  return { grid, size: m, placements: mapping.placements, edges: mapping.edges };
}
