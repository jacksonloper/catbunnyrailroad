import { describe, it, expect } from "vitest";
import {
  binarizeTree,
  annotateTree,
  layoutBinaryTree,
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
// annotateTree
// ---------------------------------------------------------------------------

describe("annotateTree", () => {
  it("annotates a single-node tree", () => {
    const tree = { name: "A", children: [] };
    const info = annotateTree(tree);
    expect(info.size).toBe(1);
    expect(info.height).toBe(0);
    expect(tree._size).toBe(1);
    expect(tree._height).toBe(0);
  });

  it("annotates a 3-node tree", () => {
    const tree = {
      name: "root",
      children: [
        { name: "A", children: [] },
        { name: "B", children: [] },
      ],
    };
    annotateTree(tree);
    expect(tree._size).toBe(3);
    expect(tree._height).toBe(1);
    expect(tree.children[0]._size).toBe(1);
    expect(tree.children[1]._size).toBe(1);
  });

  it("annotates an asymmetric tree", () => {
    const tree = {
      name: "root",
      children: [
        {
          name: "left",
          children: [
            { name: "A", children: [] },
            { name: "B", children: [] },
          ],
        },
        { name: "right", children: [] },
      ],
    };
    annotateTree(tree);
    expect(tree._size).toBe(5);
    expect(tree._height).toBe(2);
    expect(tree.children[0]._size).toBe(3);
    expect(tree.children[1]._size).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// layoutBinaryTree
// ---------------------------------------------------------------------------

describe("layoutBinaryTree", () => {
  it("lays out a single leaf", () => {
    const tree = { name: "A", children: [] };
    annotateTree(tree);
    const layout = layoutBinaryTree(tree);
    expect(layout.width).toBe(1);
    expect(layout.height).toBe(1);
    expect(layout.nodes.length).toBe(1);
    expect(layout.edges.length).toBe(0);
    expect(layout.nodes[0].node.name).toBe("A");
  });

  it("lays out a 3-node binary tree", () => {
    const tree = {
      name: "root",
      children: [
        { name: "A", children: [] },
        { name: "B", children: [] },
      ],
    };
    annotateTree(tree);
    const layout = layoutBinaryTree(tree);
    expect(layout.nodes.length).toBe(3);
    expect(layout.edges.length).toBe(2);
    // All nodes should have non-negative coordinates
    for (const n of layout.nodes) {
      expect(n.x).toBeGreaterThanOrEqual(0);
      expect(n.y).toBeGreaterThanOrEqual(0);
    }
  });

  it("produces no overlapping nodes", () => {
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
    annotateTree(tree);
    const layout = layoutBinaryTree(tree);
    const positions = new Set();
    for (const n of layout.nodes) {
      const key = `${n.x},${n.y}`;
      expect(positions.has(key)).toBe(false);
      positions.add(key);
    }
  });

  it("handles unary nodes", () => {
    const tree = {
      name: "root",
      children: [
        { name: "child", children: [{ name: "leaf", children: [] }] },
      ],
    };
    annotateTree(tree);
    const layout = layoutBinaryTree(tree);
    expect(layout.nodes.length).toBe(3);
    expect(layout.edges.length).toBe(2);
  });

  it("handles a deep unbalanced tree", () => {
    // Build a depth-10 caterpillar tree
    function buildDeep(depth) {
      if (depth === 0) return { name: `L`, children: [], isTaxon: true };
      return {
        name: `N${depth}`,
        children: [
          buildDeep(depth - 1),
          { name: `R${depth}`, children: [], isTaxon: true },
        ],
      };
    }
    const tree = buildDeep(10);
    annotateTree(tree);
    const layout = layoutBinaryTree(tree);
    // All 11 leaf nodes + 10 internal = 21 total
    expect(layout.nodes.length).toBe(21);
    expect(layout.edges.length).toBe(20);
    // No overlaps
    const positions = new Set();
    for (const n of layout.nodes) {
      const key = `${n.x},${n.y}`;
      expect(positions.has(key)).toBe(false);
      positions.add(key);
    }
  });
});

// ---------------------------------------------------------------------------
// embedTreeInMaze (integration)
// ---------------------------------------------------------------------------

describe("embedTreeInMaze", () => {
  it("embeds a single-node tree", () => {
    const tree = { name: "A", children: [], isTaxon: true };
    const result = embedTreeInMaze(tree);
    expect(result).not.toBeNull();
    expect(result.placements.length).toBe(1);
    expect(result.placements[0].node.name).toBe("A");
    expect(result.width).toBe(1);
    expect(result.height).toBe(1);
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
    const result = embedTreeInMaze(tree);
    expect(result).not.toBeNull();

    // All 4 taxa should be placed
    const taxaPlacements = result.placements.filter((p) => p.node.isTaxon);
    expect(taxaPlacements.length).toBe(4);

    // All placements should be within bounds
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
    const result = embedTreeInMaze(bin);
    expect(result).not.toBeNull();
    const taxaPlacements = result.placements.filter((p) => p.node.isTaxon);
    expect(taxaPlacements.length).toBe(3);
  });

  it("embeds an 8-leaf balanced tree", () => {
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
    const result = embedTreeInMaze(tree);
    expect(result).not.toBeNull();
    const taxaPlacements = result.placements.filter((p) => p.node.isTaxon);
    expect(taxaPlacements.length).toBe(8);
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
    const result = embedTreeInMaze(tree);
    expect(result).not.toBeNull();
    const positions = new Set();
    for (const p of result.placements) {
      const key = `${p.row},${p.col}`;
      expect(positions.has(key)).toBe(false);
      positions.add(key);
    }
  });

  it("edges connect layout nodes", () => {
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
    const result = embedTreeInMaze(tree);
    expect(result).not.toBeNull();
    expect(result.edges.length).toBeGreaterThan(0);
    // Each edge should have valid from/to coordinates
    for (const e of result.edges) {
      expect(typeof e.from.x).toBe("number");
      expect(typeof e.from.y).toBe("number");
      expect(typeof e.to.x).toBe("number");
      expect(typeof e.to.y).toBe("number");
    }
  });
});

// ---------------------------------------------------------------------------
// Heavy-child layout speed tests
// ---------------------------------------------------------------------------

describe("heavy-child layout speed", () => {
  it("embeds a deep unbalanced tree (depth 10) in under 1 second", () => {
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

    const start = Date.now();
    const result = embedTreeInMaze(tree);
    const elapsed = Date.now() - start;

    expect(result).not.toBeNull();
    expect(elapsed).toBeLessThan(1000);
    expect(result.placements.length).toBe(21);
  });

  it("embeds a 32-leaf balanced tree quickly", () => {
    function mk(d, prefix) {
      if (d === 0) return { name: prefix, children: [], isTaxon: true };
      return { name: prefix, children: [mk(d - 1, prefix + "L"), mk(d - 1, prefix + "R")] };
    }
    const tree = mk(5, ""); // 32 leaves

    const start = Date.now();
    const result = embedTreeInMaze(tree);
    const elapsed = Date.now() - start;

    expect(result).not.toBeNull();
    expect(elapsed).toBeLessThan(1000);

    const taxaPlacements = result.placements.filter((p) => p.node.isTaxon);
    expect(taxaPlacements.length).toBe(32);
  });

  it("produces compact layouts (width * height reasonable)", () => {
    // 9-taxa tree similar to real phylogenetic structure
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
    const result = embedTreeInMaze(bin);
    expect(result).not.toBeNull();

    const taxaPlacements = result.placements.filter((p) => p.node.isTaxon);
    expect(taxaPlacements.length).toBe(9);

    // Layout should be reasonably compact (not 63×63 like H-tree)
    const area = result.width * result.height;
    expect(area).toBeLessThan(500);
  });
});
