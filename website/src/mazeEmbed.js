/**
 * Tree subdivision embedding in a square grid maze.
 *
 * Workflow:
 *   1. binarizeTree – ensure every internal node has ≤ 2 children.
 *   2. embedTreeInMaze – embed the binary tree into a user-specified
 *      m × m grid graph using tree subdivision embedding.
 *
 * The embedding algorithm:
 *   1) Suppress degree-2 vertices of the tree, producing a smaller
 *      "skeleton" S whose vertices are leaves and branching nodes.
 *   2) Search for an injective placement of S's vertices into the grid.
 *   3) For each skeleton edge, route a simple path in the grid (BFS)
 *      between the placed endpoints, with all paths internally
 *      vertex-disjoint.
 *   4) Re-expand suppressed degree-2 chains along the routed paths.
 *
 * Tuned for small trees (≤ ~15 leaves) and moderate grids (≤ ~15 × 15).
 * Uses backtracking + BFS + pruning.
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
// High-level entry point
// ---------------------------------------------------------------------------

/**
 * Embed a binary tree into an m × m grid maze.
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
  const hostGraph = makeGridGraph(m);
  const result = findTreeSubdivisionEmbedding(binTree, hostGraph);
  if (!result) return null;

  const grid = Array.from({ length: m }, () =>
    Array.from({ length: m }, () => ({ passage: false, node: null }))
  );
  const placements = [];

  for (const [vertex, node] of result.hostMap) {
    const [rStr, cStr] = vertex.split(",");
    const r = parseInt(rStr, 10);
    const c = parseInt(cStr, 10);
    grid[r][c].passage = true;
    if (node) {
      grid[r][c].node = node;
      placements.push({ node, row: r, col: c });
    }
  }

  // Extract actual tree edges from the routed paths (not from grid adjacency,
  // which can create false connections / cycles).
  const edges = [];
  for (const [, path] of result.paths) {
    for (let i = 0; i < path.length - 1; i++) {
      const [r1, c1] = path[i].split(",").map(Number);
      const [r2, c2] = path[i + 1].split(",").map(Number);
      edges.push({ r1, c1, r2, c2 });
    }
  }

  return { grid, size: m, placements, edges };
}
