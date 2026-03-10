import { describe, it, expect } from "vitest";
import {
  binarizeTree,
  makeGridGraph,
  treeToAdj,
  buildSkeleton,
  bfsPath,
  findTreeSubdivisionEmbedding,
  embedTreeInMaze,
  treeDepth,
  hTreeDimensions,
  buildHTree,
  computeMinMazeSize,
} from "./mazeEmbed.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Count leaves (nodes with no children) */
function countLeaves(node) {
  if (!node.children || node.children.length === 0) return 1;
  return node.children.reduce((s, c) => s + countLeaves(c), 0);
}

/** Check that every internal node has ≤ 2 children */
function isBinary(node) {
  if (!node.children || node.children.length === 0) return true;
  if (node.children.length > 2) return false;
  return node.children.every(isBinary);
}

/** Collect all nodes in a tree */
function collectAll(node) {
  const result = [node];
  for (const c of node.children || []) result.push(...collectAll(c));
  return result;
}

// ---------------------------------------------------------------------------
// binarizeTree
// ---------------------------------------------------------------------------

describe("binarizeTree", () => {
  it("leaves a binary tree unchanged", () => {
    const tree = {
      name: "root",
      children: [
        { name: "A", children: [] },
        { name: "B", children: [] },
      ],
    };
    const bin = binarizeTree(tree);
    expect(isBinary(bin)).toBe(true);
    expect(countLeaves(bin)).toBe(2);
  });

  it("resolves a 3-child polytomy", () => {
    const tree = {
      name: "root",
      children: [
        { name: "A", children: [] },
        { name: "B", children: [] },
        { name: "C", children: [] },
      ],
    };
    const bin = binarizeTree(tree);
    expect(isBinary(bin)).toBe(true);
    expect(countLeaves(bin)).toBe(3);
  });

  it("resolves a 5-child polytomy preserving all leaves", () => {
    const tree = {
      name: "root",
      children: Array.from({ length: 5 }, (_, i) => ({
        name: `L${i}`,
        children: [],
        isTaxon: true,
      })),
    };
    const bin = binarizeTree(tree);
    expect(isBinary(bin)).toBe(true);
    expect(countLeaves(bin)).toBe(5);
    // All original taxa should still be present
    const allNodes = collectAll(bin);
    for (let i = 0; i < 5; i++) {
      expect(allNodes.some((n) => n.name === `L${i}`)).toBe(true);
    }
  });

  it("handles a single-node tree", () => {
    const tree = { name: "only", children: [] };
    const bin = binarizeTree(tree);
    expect(bin.name).toBe("only");
    expect(bin.children).toEqual([]);
  });

  it("handles a node with no children property", () => {
    const tree = { name: "bare" };
    const bin = binarizeTree(tree);
    expect(bin.children).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// makeGridGraph
// ---------------------------------------------------------------------------

describe("makeGridGraph", () => {
  it("builds a 3×3 grid with 9 vertices", () => {
    const g = makeGridGraph(3);
    expect(g.vertices.length).toBe(9);
  });

  it("corner vertex has degree 2", () => {
    const g = makeGridGraph(4);
    expect(g.adj["0,0"].length).toBe(2);
    expect(g.adj["3,3"].length).toBe(2);
  });

  it("interior vertex has degree 4", () => {
    const g = makeGridGraph(5);
    expect(g.adj["2,2"].length).toBe(4);
  });

  it("edge (non-corner) vertex has degree 3", () => {
    const g = makeGridGraph(5);
    expect(g.adj["0,2"].length).toBe(3);
    expect(g.adj["2,0"].length).toBe(3);
  });

  it("adjacency is symmetric", () => {
    const g = makeGridGraph(4);
    for (const v of g.vertices) {
      for (const nb of g.adj[v]) {
        expect(g.adj[nb]).toContain(v);
      }
    }
  });
});

// ---------------------------------------------------------------------------
// treeToAdj
// ---------------------------------------------------------------------------

describe("treeToAdj", () => {
  it("converts a 3-node tree to undirected adjacency", () => {
    const tree = {
      name: "root",
      children: [
        { name: "A", children: [] },
        { name: "B", children: [] },
      ],
    };
    const { ids, adj } = treeToAdj(tree);
    expect(ids.length).toBe(3);
    // Root has 2 neighbours, each leaf has 1
    const rootId = ids[0];
    expect(adj[rootId].length).toBe(2);
    for (const nbId of adj[rootId]) {
      expect(adj[nbId]).toContain(rootId);
    }
  });

  it("single node has no neighbours", () => {
    const { ids, adj } = treeToAdj({ name: "solo", children: [] });
    expect(ids.length).toBe(1);
    expect(adj[ids[0]].length).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// buildSkeleton
// ---------------------------------------------------------------------------

describe("buildSkeleton", () => {
  it("suppresses degree-2 root of a path A-root-B", () => {
    const tree = {
      name: "root",
      children: [
        { name: "A", children: [] },
        { name: "B", children: [] },
      ],
    };
    const adjData = treeToAdj(tree);
    const skel = buildSkeleton(adjData);
    // Only the two leaves are important (degree 1); root has degree 2
    expect(skel.importantVerts.length).toBe(2);
    // There should be one skeleton edge between A and B
    const edgeCount = Object.values(skel.skelAdj).reduce((s, a) => s + a.length, 0) / 2;
    expect(edgeCount).toBe(1);
    // The chain for that edge should contain the root
    const chainValues = [...skel.chains.values()];
    expect(chainValues.some((c) => c.length === 1)).toBe(true);
  });

  it("keeps branching vertices", () => {
    const tree = {
      name: "root",
      children: [
        { name: "A", children: [] },
        {
          name: "mid",
          children: [
            { name: "B", children: [] },
            { name: "C", children: [] },
          ],
        },
      ],
    };
    const adjData = treeToAdj(tree);
    const skel = buildSkeleton(adjData);
    // root is degree 2 (suppressed), mid is degree 3 (kept), A/B/C are degree 1 (kept)
    expect(skel.importantVerts.length).toBe(4); // mid, A, B, C
  });
});

// ---------------------------------------------------------------------------
// bfsPath
// ---------------------------------------------------------------------------

describe("bfsPath", () => {
  it("finds a path in a 3×3 grid", () => {
    const g = makeGridGraph(3);
    const path = bfsPath(g, "0,0", "2,2", new Set());
    expect(path).not.toBeNull();
    expect(path[0]).toBe("0,0");
    expect(path[path.length - 1]).toBe("2,2");
    // Shortest path has length 5 (Manhattan distance 4 → 5 vertices)
    expect(path.length).toBe(5);
  });

  it("avoids used vertices", () => {
    const g = makeGridGraph(3);
    // Block the middle row except (1,0) and (1,2)
    const used = new Set(["1,1"]);
    const path = bfsPath(g, "0,0", "2,2", used);
    expect(path).not.toBeNull();
    expect(path).not.toContain("1,1");
  });

  it("returns null if no path exists", () => {
    const g = makeGridGraph(3);
    // Block everything around (2,2)
    const used = new Set(["1,2", "2,1"]);
    const path = bfsPath(g, "0,0", "2,2", used);
    expect(path).toBeNull();
  });

  it("src equals dst returns [src]", () => {
    const g = makeGridGraph(3);
    const path = bfsPath(g, "1,1", "1,1", new Set());
    expect(path).toEqual(["1,1"]);
  });
});

// ---------------------------------------------------------------------------
// findTreeSubdivisionEmbedding
// ---------------------------------------------------------------------------

describe("findTreeSubdivisionEmbedding", () => {
  it("embeds a single node", () => {
    const tree = { name: "A", children: [] };
    const host = makeGridGraph(3);
    const result = findTreeSubdivisionEmbedding(tree, host);
    expect(result).not.toBeNull();
    expect(result.placements.length).toBe(1);
    expect(result.placements[0].node.name).toBe("A");
  });

  it("embeds a 2-node path", () => {
    const tree = {
      name: "A",
      children: [{ name: "B", children: [] }],
    };
    const host = makeGridGraph(3);
    const result = findTreeSubdivisionEmbedding(tree, host);
    expect(result).not.toBeNull();
    expect(result.placements.length).toBe(2);
    // The two placement vertices should be distinct
    const verts = result.placements.map((p) => p.vertex);
    expect(new Set(verts).size).toBe(2);
  });

  it("embeds a 3-node binary tree into a 5×5 grid", () => {
    const tree = {
      name: "root",
      children: [
        { name: "L", children: [] },
        { name: "R", children: [] },
      ],
    };
    const host = makeGridGraph(5);
    const result = findTreeSubdivisionEmbedding(tree, host);
    expect(result).not.toBeNull();
    // L and R are important (degree 1), root is suppressed (degree 2)
    // So 2 placements for the important vertices
    expect(result.placements.length).toBe(2);
    // But the hostMap should have at least 3 entries (L, root-corridor, R)
    expect(result.hostMap.size).toBeGreaterThanOrEqual(3);
  });

  it("fails if tree is too large for the graph", () => {
    // A tree with 10 nodes can't fit in a 2×2 grid (only 4 vertices)
    const tree = {
      name: "root",
      children: [
        {
          name: "A",
          children: [
            { name: "A1", children: [] },
            { name: "A2", children: [] },
          ],
        },
        {
          name: "B",
          children: [
            { name: "B1", children: [] },
            { name: "B2", children: [] },
          ],
        },
      ],
    };
    const host = makeGridGraph(2);
    const result = findTreeSubdivisionEmbedding(tree, host);
    expect(result).toBeNull();
  });

  it("paths in the embedding are vertex-disjoint", () => {
    const tree = {
      name: "root",
      children: [
        { name: "A", children: [] },
        {
          name: "mid",
          children: [
            { name: "B", children: [] },
            { name: "C", children: [] },
          ],
        },
      ],
    };
    const host = makeGridGraph(7);
    const result = findTreeSubdivisionEmbedding(tree, host);
    expect(result).not.toBeNull();

    // Check that all host vertices in the embedding are distinct
    const allHostVerts = [...result.hostMap.keys()];
    expect(new Set(allHostVerts).size).toBe(allHostVerts.length);
  });
});

// ---------------------------------------------------------------------------
// embedTreeInMaze (integration)
// ---------------------------------------------------------------------------

describe("embedTreeInMaze", () => {
  it("embeds a single-node tree in a 3×3 grid", () => {
    const tree = { name: "A", children: [], isTaxon: true };
    const result = embedTreeInMaze(tree, 3);
    expect(result).not.toBeNull();
    expect(result.size).toBe(3);
    expect(result.placements.length).toBe(1);
    expect(result.placements[0].node.name).toBe("A");
    // The placement should be within bounds
    expect(result.placements[0].row).toBeGreaterThanOrEqual(0);
    expect(result.placements[0].row).toBeLessThan(3);
    expect(result.placements[0].col).toBeGreaterThanOrEqual(0);
    expect(result.placements[0].col).toBeLessThan(3);
  });

  it("embeds a 4-leaf binary tree in a 7×7 grid", () => {
    const tree = {
      name: "root",
      children: [
        {
          name: "AB",
          children: [
            { name: "A", children: [], isTaxon: true },
            { name: "B", children: [], isTaxon: true },
          ],
        },
        {
          name: "CD",
          children: [
            { name: "C", children: [], isTaxon: true },
            { name: "D", children: [], isTaxon: true },
          ],
        },
      ],
    };
    const result = embedTreeInMaze(tree, 7);
    expect(result).not.toBeNull();
    expect(result.size).toBe(7);

    // All 4 taxa should be placed
    const taxaPlacements = result.placements.filter((p) => p.node.isTaxon);
    expect(taxaPlacements.length).toBe(4);

    // Grid should have some passage cells
    let passages = 0;
    for (let r = 0; r < 7; r++)
      for (let c = 0; c < 7; c++)
        if (result.grid[r][c].passage) passages++;
    expect(passages).toBeGreaterThan(0);
  });

  it("returns null when the grid is too small", () => {
    const tree = {
      name: "root",
      children: [
        {
          name: "AB",
          children: [
            { name: "A", children: [] },
            { name: "B", children: [] },
          ],
        },
        {
          name: "CD",
          children: [
            { name: "C", children: [] },
            { name: "D", children: [] },
          ],
        },
      ],
    };
    const result = embedTreeInMaze(tree, 2);
    expect(result).toBeNull();
  });

  it("passage cells are connected (form a tree/path in the grid)", () => {
    const tree = {
      name: "root",
      children: [
        { name: "A", children: [], isTaxon: true },
        { name: "B", children: [], isTaxon: true },
      ],
    };
    const result = embedTreeInMaze(tree, 5);
    expect(result).not.toBeNull();

    // Collect passage cells
    const passageCells = [];
    for (let r = 0; r < result.size; r++) {
      for (let c = 0; c < result.size; c++) {
        if (result.grid[r][c].passage) passageCells.push(`${r},${c}`);
      }
    }
    expect(passageCells.length).toBeGreaterThanOrEqual(2);

    // BFS from first passage cell – all passage cells should be reachable
    const visited = new Set([passageCells[0]]);
    const queue = [passageCells[0]];
    const passageSet = new Set(passageCells);
    while (queue.length > 0) {
      const v = queue.shift();
      const [r, c] = v.split(",").map(Number);
      for (const [dr, dc] of [[-1,0],[1,0],[0,-1],[0,1]]) {
        const nb = `${r + dr},${c + dc}`;
        if (passageSet.has(nb) && !visited.has(nb)) {
          visited.add(nb);
          queue.push(nb);
        }
      }
    }
    expect(visited.size).toBe(passageCells.length);
  });

  it("works with binarizeTree for a polytomy", () => {
    const tree = {
      name: "root",
      children: [
        { name: "A", children: [], isTaxon: true },
        { name: "B", children: [], isTaxon: true },
        { name: "C", children: [], isTaxon: true },
      ],
    };
    const bin = binarizeTree(tree);
    const result = embedTreeInMaze(bin, 7);
    expect(result).not.toBeNull();
    const taxaPlacements = result.placements.filter((p) => p.node.isTaxon);
    expect(taxaPlacements.length).toBe(3);
  });

  it("embeds an 8-leaf balanced tree in an 11×11 grid", () => {
    function makeBalanced(depth, prefix) {
      if (depth === 0) return { name: prefix, children: [], isTaxon: true };
      return {
        name: prefix,
        children: [
          makeBalanced(depth - 1, prefix + "L"),
          makeBalanced(depth - 1, prefix + "R"),
        ],
      };
    }
    const tree = makeBalanced(3, "");
    const result = embedTreeInMaze(tree, 11);
    expect(result).not.toBeNull();
    const taxaPlacements = result.placements.filter((p) => p.node.isTaxon);
    expect(taxaPlacements.length).toBe(8);
  });
});

// ---------------------------------------------------------------------------
// Embedding produces a proper tree (no cycles)
// ---------------------------------------------------------------------------

/** Helper: collect passage cells from maze result */
function collectPassageCells(result) {
  const cells = [];
  for (let r = 0; r < result.size; r++) {
    for (let c = 0; c < result.size; c++) {
      if (result.grid[r][c].passage) cells.push(`${r},${c}`);
    }
  }
  return cells;
}

/** Helper: verify edges form a tree (connected, no cycles) */
function verifyTreeProperty(result) {
  const passageCells = collectPassageCells(result);
  const passageSet = new Set(passageCells);

  // All edge endpoints must be passage cells
  for (const e of result.edges) {
    expect(passageSet.has(`${e.r1},${e.c1}`)).toBe(true);
    expect(passageSet.has(`${e.r2},${e.c2}`)).toBe(true);
  }

  // Tree property: |edges| = |vertices| - 1
  expect(result.edges.length).toBe(passageCells.length - 1);

  // Build adjacency from edges and verify connectivity
  const adj = {};
  for (const cell of passageCells) adj[cell] = [];
  for (const e of result.edges) {
    const u = `${e.r1},${e.c1}`;
    const v = `${e.r2},${e.c2}`;
    adj[u].push(v);
    adj[v].push(u);
  }
  const visited = new Set([passageCells[0]]);
  const queue = [passageCells[0]];
  while (queue.length > 0) {
    const v = queue.shift();
    for (const nb of adj[v]) {
      if (!visited.has(nb)) {
        visited.add(nb);
        queue.push(nb);
      }
    }
  }
  expect(visited.size).toBe(passageCells.length);
}

describe("embedding edges form a tree (no cycles)", () => {
  it("single-node tree has zero edges", () => {
    const tree = { name: "A", children: [], isTaxon: true };
    const result = embedTreeInMaze(tree, 3);
    expect(result).not.toBeNull();
    expect(result.edges.length).toBe(0);
    const passages = collectPassageCells(result);
    expect(passages.length).toBe(1);
  });

  it("2-leaf tree edges form a path (no cycles)", () => {
    const tree = {
      name: "root",
      children: [
        { name: "A", children: [], isTaxon: true },
        { name: "B", children: [], isTaxon: true },
      ],
    };
    const result = embedTreeInMaze(tree, 5);
    expect(result).not.toBeNull();
    verifyTreeProperty(result);
  });

  it("4-leaf binary tree edges form a tree (no cycles)", () => {
    const tree = {
      name: "root",
      children: [
        {
          name: "AB",
          children: [
            { name: "A", children: [], isTaxon: true },
            { name: "B", children: [], isTaxon: true },
          ],
        },
        {
          name: "CD",
          children: [
            { name: "C", children: [], isTaxon: true },
            { name: "D", children: [], isTaxon: true },
          ],
        },
      ],
    };
    const result = embedTreeInMaze(tree, 7);
    expect(result).not.toBeNull();
    verifyTreeProperty(result);
  });

  it("9-taxa tree (like OTTs 378513,458856,...) embeds as a proper tree", () => {
    // Tree structure with 9 taxa in 3 clades (polytomies resolved by binarize)
    const tree = {
      name: "root",
      children: [
        {
          name: "clade1",
          children: [
            { name: "T1", ott_id: 378513, isTaxon: true, children: [] },
            { name: "T2", ott_id: 458856, isTaxon: true, children: [] },
            { name: "T3", ott_id: 3902985, isTaxon: true, children: [] },
          ],
        },
        {
          name: "clade2",
          children: [
            { name: "T4", ott_id: 972654, isTaxon: true, children: [] },
            { name: "T5", ott_id: 731554, isTaxon: true, children: [] },
            { name: "T6", ott_id: 259054, isTaxon: true, children: [] },
          ],
        },
        {
          name: "clade3",
          children: [
            { name: "T7", ott_id: 372836, isTaxon: true, children: [] },
            { name: "T8", ott_id: 490099, isTaxon: true, children: [] },
            { name: "T9", ott_id: 563166, isTaxon: true, children: [] },
          ],
        },
      ],
    };
    const bin = binarizeTree(tree);
    const result = embedTreeInMaze(bin, 15);
    expect(result).not.toBeNull();

    // All 9 taxa should be placed at grid points
    const taxaPlacements = result.placements.filter((p) => p.node.isTaxon);
    expect(taxaPlacements.length).toBe(9);

    // Each taxon placement should have valid grid coords
    for (const p of taxaPlacements) {
      expect(p.row).toBeGreaterThanOrEqual(0);
      expect(p.row).toBeLessThan(15);
      expect(p.col).toBeGreaterThanOrEqual(0);
      expect(p.col).toBeLessThan(15);
      expect(p.node.ott_id).toBeDefined();
    }

    // The edges must form a proper tree: connected, no cycles
    verifyTreeProperty(result);
  });

  it("8-leaf balanced tree edges form a tree (no cycles)", () => {
    function makeBalanced(depth, prefix) {
      if (depth === 0) return { name: prefix, children: [], isTaxon: true };
      return {
        name: prefix,
        children: [
          makeBalanced(depth - 1, prefix + "L"),
          makeBalanced(depth - 1, prefix + "R"),
        ],
      };
    }
    const tree = makeBalanced(3, "");
    const result = embedTreeInMaze(tree, 11);
    expect(result).not.toBeNull();
    verifyTreeProperty(result);
  });

  it("edges are between grid-adjacent cells", () => {
    const tree = {
      name: "root",
      children: [
        {
          name: "AB",
          children: [
            { name: "A", children: [], isTaxon: true },
            { name: "B", children: [], isTaxon: true },
          ],
        },
        { name: "C", children: [], isTaxon: true },
      ],
    };
    const result = embedTreeInMaze(tree, 7);
    expect(result).not.toBeNull();
    for (const e of result.edges) {
      const dr = Math.abs(e.r1 - e.r2);
      const dc = Math.abs(e.c1 - e.c2);
      // Each edge should connect grid-adjacent cells (Manhattan distance 1)
      expect(dr + dc).toBe(1);
    }
  });
});

// ---------------------------------------------------------------------------
// H-tree functions
// ---------------------------------------------------------------------------

describe("treeDepth", () => {
  it("single node has depth 0", () => {
    expect(treeDepth({ name: "A", children: [] })).toBe(0);
  });

  it("depth-1 tree", () => {
    const tree = { name: "r", children: [{ name: "A", children: [] }] };
    expect(treeDepth(tree)).toBe(1);
  });

  it("depth-3 balanced tree", () => {
    function mk(d) {
      if (d === 0) return { name: "L", children: [] };
      return { name: "N", children: [mk(d - 1), mk(d - 1)] };
    }
    expect(treeDepth(mk(3))).toBe(3);
  });
});

describe("hTreeDimensions", () => {
  it("depth 0 is 1×1", () => {
    expect(hTreeDimensions(0)).toEqual({ width: 1, height: 1 });
  });

  it("depth 1 is 3×1", () => {
    expect(hTreeDimensions(1)).toEqual({ width: 3, height: 1 });
  });

  it("depth 2 is 3×3", () => {
    expect(hTreeDimensions(2)).toEqual({ width: 3, height: 3 });
  });

  it("depth 3 is 7×3", () => {
    expect(hTreeDimensions(3)).toEqual({ width: 7, height: 3 });
  });

  it("depth 4 is 7×7", () => {
    expect(hTreeDimensions(4)).toEqual({ width: 7, height: 7 });
  });

  it("depth 5 is 15×7", () => {
    expect(hTreeDimensions(5)).toEqual({ width: 15, height: 7 });
  });
});

describe("buildHTree", () => {
  it("depth 0 places node at center", () => {
    const h = buildHTree(0, 0, 2, 0, 2, true);
    expect(h.row).toBe(1);
    expect(h.col).toBe(1);
    expect(h.left).toBeNull();
    expect(h.right).toBeNull();
  });

  it("depth 1 splits horizontally", () => {
    const h = buildHTree(1, 0, 0, 0, 2, true);
    expect(h.row).toBe(0);
    expect(h.col).toBe(1);
    expect(h.left.col).toBe(0);
    expect(h.right.col).toBe(2);
    expect(h.left.row).toBe(0);
    expect(h.right.row).toBe(0);
  });

  it("depth 2 creates H shape in 3×3 grid", () => {
    const h = buildHTree(2, 0, 2, 0, 2, true);
    expect(h.row).toBe(1);
    expect(h.col).toBe(1);
    // Left child splits vertically
    expect(h.left.row).toBe(1);
    expect(h.left.col).toBe(0);
    expect(h.left.left.row).toBe(0);
    expect(h.left.right.row).toBe(2);
    // Right child splits vertically
    expect(h.right.row).toBe(1);
    expect(h.right.col).toBe(2);
  });
});

describe("computeMinMazeSize", () => {
  it("single node needs size 1", () => {
    expect(computeMinMazeSize({ name: "A", children: [] })).toBe(1);
  });

  it("depth-2 tree needs size 3", () => {
    const tree = {
      name: "root",
      children: [
        { name: "AB", children: [
          { name: "A", children: [] },
          { name: "B", children: [] },
        ]},
        { name: "CD", children: [
          { name: "C", children: [] },
          { name: "D", children: [] },
        ]},
      ],
    };
    expect(computeMinMazeSize(tree)).toBe(3);
  });

  it("depth-3 tree needs size 7", () => {
    function mk(d) {
      if (d === 0) return { name: "L", children: [] };
      return { name: "N", children: [mk(d - 1), mk(d - 1)] };
    }
    expect(computeMinMazeSize(mk(3))).toBe(7);
  });
});

describe("H-tree embedding speed", () => {
  it("embeds a deep unbalanced tree (depth 10) in under 1 second", () => {
    // Build a deep unbalanced binary tree similar to the 22-taxon phylogenetic tree
    function buildDeepTree(depth) {
      if (depth === 0) return { name: `L${depth}`, children: [], isTaxon: true };
      return {
        name: `N${depth}`,
        children: [
          buildDeepTree(depth - 1),
          { name: `R${depth}`, children: [], isTaxon: true },
        ],
      };
    }
    const tree = buildDeepTree(10);
    const minSize = computeMinMazeSize(tree);
    expect(minSize).toBe(63);

    const start = Date.now();
    const result = embedTreeInMaze(tree, minSize);
    const elapsed = Date.now() - start;

    expect(result).not.toBeNull();
    expect(elapsed).toBeLessThan(1000);
    expect(result.size).toBe(63);

    // Verify tree property
    verifyTreeProperty(result);
  });

  it("embeds a 32-leaf balanced tree quickly", () => {
    function mk(d, prefix) {
      if (d === 0) return { name: prefix, children: [], isTaxon: true };
      return { name: prefix, children: [mk(d - 1, prefix + "L"), mk(d - 1, prefix + "R")] };
    }
    const tree = mk(5, ""); // 32 leaves
    const minSize = computeMinMazeSize(tree);

    const start = Date.now();
    const result = embedTreeInMaze(tree, minSize);
    const elapsed = Date.now() - start;

    expect(result).not.toBeNull();
    expect(elapsed).toBeLessThan(1000);

    const taxaPlacements = result.placements.filter(p => p.node.isTaxon);
    expect(taxaPlacements.length).toBe(32);
    verifyTreeProperty(result);
  });
});
