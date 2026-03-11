import { describe, it, expect } from "vitest";
import {
  binarizeTree,
  makeGridGraph,
  randomSpanningTree,
  treeToAdj,
  findSubdivisionEmbedding,
  bfsPath,
  embedTreeInMaze,
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
  it("builds correct number of edges for a 3×3 grid", () => {
    const edges = makeGridGraph(3);
    // 3×3 grid: 3*2 horizontal + 2*3 vertical = 12
    expect(edges.length).toBe(12);
  });

  it("builds correct number of edges for a 4×4 grid", () => {
    const edges = makeGridGraph(4);
    // 4×4: 4*3 horizontal + 3*4 vertical = 24
    expect(edges.length).toBe(24);
  });

  it("all edges connect adjacent cells", () => {
    const m = 5;
    const edges = makeGridGraph(m);
    for (const [u, v] of edges) {
      const diff = Math.abs(u - v);
      expect(diff === 1 || diff === m).toBe(true);
    }
  });
});

// ---------------------------------------------------------------------------
// randomSpanningTree
// ---------------------------------------------------------------------------

describe("randomSpanningTree", () => {
  it("returns a tree with m²−1 edges", () => {
    const m = 5;
    const adj = randomSpanningTree(m);
    let edgeCount = 0;
    for (let v = 0; v < m * m; v++) {
      edgeCount += adj[v].length;
    }
    // Each edge is counted twice in adjacency list
    expect(edgeCount / 2).toBe(m * m - 1);
  });

  it("spans all vertices (connected)", () => {
    const m = 6;
    const adj = randomSpanningTree(m);
    const n = m * m;
    const visited = new Uint8Array(n);
    const queue = [0];
    visited[0] = 1;
    let count = 1;
    let head = 0;
    while (head < queue.length) {
      const v = queue[head++];
      for (const u of adj[v]) {
        if (!visited[u]) {
          visited[u] = 1;
          count++;
          queue.push(u);
        }
      }
    }
    expect(count).toBe(n);
  });

  it("only uses grid-adjacent edges", () => {
    const m = 4;
    const adj = randomSpanningTree(m);
    for (let v = 0; v < m * m; v++) {
      for (const u of adj[v]) {
        const diff = Math.abs(u - v);
        expect(diff === 1 || diff === m).toBe(true);
      }
    }
  });
});

// ---------------------------------------------------------------------------
// treeToAdj
// ---------------------------------------------------------------------------

describe("treeToAdj", () => {
  it("converts a simple tree", () => {
    const tree = {
      name: "root",
      children: [
        { name: "A", children: [] },
        { name: "B", children: [] },
      ],
    };
    const { adj, nodes, n } = treeToAdj(tree);
    expect(n).toBe(3);
    expect(nodes[0].name).toBe("root");
    // Root should connect to both children
    expect(adj[0].length).toBe(2);
    // Each child should connect back to root
    expect(adj[1].length).toBe(1);
    expect(adj[2].length).toBe(1);
  });

  it("preserves node references", () => {
    const leaf = { name: "leaf", children: [], isTaxon: true };
    const tree = { name: "root", children: [leaf] };
    const { nodes } = treeToAdj(tree);
    expect(nodes[1]).toBe(leaf);
  });
});

// ---------------------------------------------------------------------------
// bfsPath
// ---------------------------------------------------------------------------

describe("bfsPath", () => {
  it("finds a path in a simple graph", () => {
    // 0 - 1 - 2
    const adj = [[1], [0, 2], [1]];
    const path = bfsPath(adj, 0, 2, 3);
    expect(path).toEqual([0, 1, 2]);
  });

  it("returns single vertex for from === to", () => {
    const adj = [[1], [0]];
    const path = bfsPath(adj, 0, 0, 2);
    expect(path).toEqual([0]);
  });

  it("returns null when no path exists", () => {
    const adj = [[], []]; // disconnected
    const path = bfsPath(adj, 0, 1, 2);
    expect(path).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// findSubdivisionEmbedding
// ---------------------------------------------------------------------------

describe("findSubdivisionEmbedding", () => {
  it("embeds a single-node tree", () => {
    const tree = { name: "A", children: [], isTaxon: true };
    // Spanning tree: just a path 0-1-2
    const bAdj = [[1], [0, 2], [1]];
    const result = findSubdivisionEmbedding(tree, bAdj, 3);
    expect(result).not.toBeNull();
    expect(result.mapping.length).toBe(1);
  });

  it("embeds a 2-node path tree in a 3-node path", () => {
    const tree = {
      name: "root",
      children: [{ name: "A", children: [] }],
    };
    const bAdj = [[1], [0, 2], [1]];
    const result = findSubdivisionEmbedding(tree, bAdj, 3);
    expect(result).not.toBeNull();
    expect(result.mapping.length).toBe(2);
  });

  it("embeds a 3-node tree (root + 2 children) in a star", () => {
    const tree = {
      name: "root",
      children: [
        { name: "A", children: [] },
        { name: "B", children: [] },
      ],
    };
    // Star: center 0, leaves 1,2,3
    const bAdj = [[1, 2, 3], [0], [0], [0]];
    const result = findSubdivisionEmbedding(tree, bAdj, 4);
    expect(result).not.toBeNull();
  });

  it("returns null when tree cannot be embedded", () => {
    // Try to embed a star with 3 children into a path
    const tree = {
      name: "root",
      children: [
        { name: "A", children: [] },
        { name: "B", children: [] },
        { name: "C", children: [] },
      ],
    };
    const bin = binarizeTree(tree);
    // Path: 0-1-2
    const bAdj = [[1], [0, 2], [1]];
    // 3 children after binarization creates 4 tree nodes → needs more room
    const result = findSubdivisionEmbedding(bin, bAdj, 3);
    // The binarized tree has 6 nodes (root, internal, A, B, C + extra internal)
    // A 3-vertex path can't hold it
    expect(result).toBeNull();
  });

  it("embeds a binary tree in a random spanning tree", () => {
    const tree = {
      name: "root",
      children: [
        { name: "A", children: [], isTaxon: true },
        { name: "B", children: [], isTaxon: true },
      ],
    };
    const m = 5;
    const stAdj = randomSpanningTree(m);
    const result = findSubdivisionEmbedding(tree, stAdj, m * m);
    expect(result).not.toBeNull();
  });
});

// ---------------------------------------------------------------------------
// embedTreeInMaze (integration)
// ---------------------------------------------------------------------------

describe("embedTreeInMaze", () => {
  it("embeds a single-node tree", () => {
    const tree = { name: "A", children: [], isTaxon: true };
    const result = embedTreeInMaze(tree, 5);
    expect(result).not.toBeNull();
    expect(result.width).toBe(5);
    expect(result.height).toBe(5);
    expect(result.placements.length).toBeGreaterThanOrEqual(1);
    // Should have maze background edges (spanning tree)
    expect(result.mazeEdges.length).toBe(5 * 5 - 1);
  });

  it("embeds a 4-leaf binary tree", () => {
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
    // Use a larger grid for reliability
    const result = embedTreeInMaze(tree, 8);
    expect(result).not.toBeNull();

    const taxaPlacements = result.placements.filter((p) => p.node?.isTaxon);
    expect(taxaPlacements.length).toBe(4);

    // All placements within bounds
    for (const p of result.placements) {
      expect(p.row).toBeGreaterThanOrEqual(0);
      expect(p.row).toBeLessThan(result.height);
      expect(p.col).toBeGreaterThanOrEqual(0);
      expect(p.col).toBeLessThan(result.width);
    }
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
    const taxaPlacements = result.placements.filter((p) => p.node?.isTaxon);
    expect(taxaPlacements.length).toBe(3);
  });

  it("produces no overlapping placements", () => {
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
    const positions = new Set();
    for (const p of result.placements) {
      const key = `${p.row},${p.col}`;
      expect(positions.has(key)).toBe(false);
      positions.add(key);
    }
  });

  it("edges connect adjacent grid cells", () => {
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
    expect(result.edges.length).toBeGreaterThan(0);
    // Each edge should connect adjacent grid cells
    for (const e of result.edges) {
      const dx = Math.abs(e.from.x - e.to.x);
      const dy = Math.abs(e.from.y - e.to.y);
      expect(dx + dy).toBe(1); // Manhattan distance = 1 (adjacent)
    }
  });

  it("includes mazeEdges (full spanning tree)", () => {
    const tree = { name: "A", children: [], isTaxon: true };
    const m = 6;
    const result = embedTreeInMaze(tree, m);
    expect(result).not.toBeNull();
    // A spanning tree of m×m grid has m²−1 edges
    expect(result.mazeEdges.length).toBe(m * m - 1);
    // All maze edges should be grid-adjacent
    for (const e of result.mazeEdges) {
      const dx = Math.abs(e.from.x - e.to.x);
      const dy = Math.abs(e.from.y - e.to.y);
      expect(dx + dy).toBe(1);
    }
  });
});

// ---------------------------------------------------------------------------
// Embedding speed & reliability tests
// ---------------------------------------------------------------------------

describe("embedding speed & reliability", () => {
  it("embeds a deep tree (depth 8) in under 2 seconds", () => {
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
    const tree = buildDeepTree(8);

    const start = Date.now();
    // Use a large grid for reliability
    const result = embedTreeInMaze(tree, 12);
    const elapsed = Date.now() - start;

    expect(result).not.toBeNull();
    expect(elapsed).toBeLessThan(2000);
  });

  it("embeds a 9-taxa polytomy tree", () => {
    const tree = {
      name: "root",
      children: [
        {
          name: "clade1",
          children: [
            { name: "T1", ott_id: 1, isTaxon: true, children: [] },
            { name: "T2", ott_id: 2, isTaxon: true, children: [] },
            { name: "T3", ott_id: 3, isTaxon: true, children: [] },
          ],
        },
        {
          name: "clade2",
          children: [
            { name: "T4", ott_id: 4, isTaxon: true, children: [] },
            { name: "T5", ott_id: 5, isTaxon: true, children: [] },
            { name: "T6", ott_id: 6, isTaxon: true, children: [] },
          ],
        },
        {
          name: "clade3",
          children: [
            { name: "T7", ott_id: 7, isTaxon: true, children: [] },
            { name: "T8", ott_id: 8, isTaxon: true, children: [] },
            { name: "T9", ott_id: 9, isTaxon: true, children: [] },
          ],
        },
      ],
    };
    const bin = binarizeTree(tree);

    // Use a large grid (15×15) to make embedding very likely on a single attempt
    const result = embedTreeInMaze(bin, 15);
    expect(result).not.toBeNull();
    const taxaPlacements = result.placements.filter((p) => p.node?.isTaxon);
    expect(taxaPlacements.length).toBe(9);
  });
});
