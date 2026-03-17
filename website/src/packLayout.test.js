import { describe, it, expect } from "vitest";
import { computePackLayout, depthColor } from "./packLayout.js";

// ---- helpers ----

function makeTaxon(name, ottId) {
  return { name, ott_id: ottId, isTaxon: true, children: [] };
}

function makeNode(name, ottId, children) {
  return { name, ott_id: ottId, isTaxon: false, children };
}

// ---- depthColor ----

describe("depthColor", () => {
  it("returns an hsl string", () => {
    const c = depthColor(0, 3);
    expect(c).toMatch(/^hsl\(/);
  });

  it("shifts hue with depth", () => {
    const c0 = depthColor(0, 4);
    const c2 = depthColor(2, 4);
    expect(c0).not.toBe(c2);
  });

  it("handles maxDepth 0 gracefully", () => {
    const c = depthColor(0, 0);
    expect(c).toMatch(/^hsl\(/);
  });
});

// ---- computePackLayout ----

describe("computePackLayout", () => {
  it("returns empty circles for null subtree", () => {
    const result = computePackLayout(null, 500);
    expect(result.circles).toEqual([]);
    expect(result.maxDepth).toBe(0);
  });

  it("packs a single taxon", () => {
    const node = makeTaxon("cat", 1);
    const result = computePackLayout(node, 500);
    expect(result.circles.length).toBe(1);
    expect(result.circles[0].isLeaf).toBe(true);
    expect(result.circles[0].node.name).toBe("cat");
    expect(result.circles[0].r).toBeGreaterThan(0);
  });

  it("packs a tree with two leaves", () => {
    const node = makeNode("mammals", 100, [
      makeTaxon("cat", 1),
      makeTaxon("dog", 2),
    ]);
    const result = computePackLayout(node, 500);
    // Root + 2 leaves = 3 circles
    expect(result.circles.length).toBe(3);
    const leaves = result.circles.filter((c) => c.isLeaf);
    expect(leaves.length).toBe(2);
  });

  it("all circles have positive radius", () => {
    const node = makeNode("root", 0, [
      makeNode("mammals", 100, [
        makeTaxon("cat", 1),
        makeTaxon("dog", 2),
      ]),
      makeTaxon("bird", 3),
    ]);
    const result = computePackLayout(node, 500);
    for (const c of result.circles) {
      expect(c.r).toBeGreaterThan(0);
    }
  });

  it("all circles fit within the layout size", () => {
    const node = makeNode("root", 0, [
      makeNode("mammals", 100, [
        makeTaxon("cat", 1),
        makeTaxon("dog", 2),
        makeTaxon("lion", 3),
      ]),
      makeNode("birds", 200, [
        makeTaxon("eagle", 4),
        makeTaxon("sparrow", 5),
      ]),
    ]);
    const size = 600;
    const result = computePackLayout(node, size);
    for (const c of result.circles) {
      expect(c.x - c.r).toBeGreaterThanOrEqual(-0.01);
      expect(c.y - c.r).toBeGreaterThanOrEqual(-0.01);
      expect(c.x + c.r).toBeLessThanOrEqual(size + 0.01);
      expect(c.y + c.r).toBeLessThanOrEqual(size + 0.01);
    }
  });

  it("maxDepth is correct for a nested tree", () => {
    const node = makeNode("root", 0, [
      makeNode("a", 1, [
        makeNode("b", 2, [
          makeTaxon("leaf", 3),
        ]),
      ]),
    ]);
    const result = computePackLayout(node, 500);
    expect(result.maxDepth).toBe(3);
  });

  it("leaf nodes have isLeaf true, internal nodes false", () => {
    const node = makeNode("root", 0, [
      makeTaxon("cat", 1),
      makeTaxon("dog", 2),
    ]);
    const result = computePackLayout(node, 500);
    const root = result.circles.find((c) => c.node.name === "root");
    const cat = result.circles.find((c) => c.node.name === "cat");
    expect(root.isLeaf).toBe(false);
    expect(cat.isLeaf).toBe(true);
  });

  it("circles include depth property", () => {
    const node = makeNode("root", 0, [
      makeTaxon("cat", 1),
    ]);
    const result = computePackLayout(node, 500);
    const root = result.circles.find((c) => c.node.name === "root");
    const cat = result.circles.find((c) => c.node.name === "cat");
    expect(root.depth).toBe(0);
    expect(cat.depth).toBe(1);
  });

  it("respects size parameter", () => {
    const node = makeNode("root", 0, [
      makeTaxon("cat", 1),
      makeTaxon("dog", 2),
    ]);
    const result = computePackLayout(node, 800);
    expect(result.size).toBe(800);
    // The root circle should be centered roughly at (400, 400)
    const root = result.circles.find((c) => c.node.name === "root");
    expect(root.x).toBeCloseTo(400, -1);
    expect(root.y).toBeCloseTo(400, -1);
  });
});
