import { describe, it, expect } from "vitest";
import { computeTreemapLayout, depthColor } from "./packLayout.js";

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

// ---- computeTreemapLayout ----

describe("computeTreemapLayout", () => {
  it("returns empty rects for null subtree", () => {
    const result = computeTreemapLayout(null, 500, 400);
    expect(result.rects).toEqual([]);
    expect(result.maxDepth).toBe(0);
  });

  it("lays out a single taxon", () => {
    const node = makeTaxon("cat", 1);
    const result = computeTreemapLayout(node, 500, 400);
    expect(result.rects.length).toBe(1);
    expect(result.rects[0].isLeaf).toBe(true);
    expect(result.rects[0].node.name).toBe("cat");
    expect(result.rects[0].x1 - result.rects[0].x0).toBeGreaterThan(0);
    expect(result.rects[0].y1 - result.rects[0].y0).toBeGreaterThan(0);
  });

  it("lays out a tree with two leaves", () => {
    const node = makeNode("mammals", 100, [
      makeTaxon("cat", 1),
      makeTaxon("dog", 2),
    ]);
    const result = computeTreemapLayout(node, 500, 400);
    // Root + 2 leaves = 3 rects
    expect(result.rects.length).toBe(3);
    const leaves = result.rects.filter((r) => r.isLeaf);
    expect(leaves.length).toBe(2);
  });

  it("all rects have positive dimensions", () => {
    const node = makeNode("root", 0, [
      makeNode("mammals", 100, [
        makeTaxon("cat", 1),
        makeTaxon("dog", 2),
      ]),
      makeTaxon("bird", 3),
    ]);
    const result = computeTreemapLayout(node, 500, 400);
    for (const r of result.rects) {
      expect(r.x1 - r.x0).toBeGreaterThan(0);
      expect(r.y1 - r.y0).toBeGreaterThan(0);
    }
  });

  it("all rects fit within the layout size", () => {
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
    const w = 600, h = 500;
    const result = computeTreemapLayout(node, w, h);
    for (const r of result.rects) {
      expect(r.x0).toBeGreaterThanOrEqual(-0.01);
      expect(r.y0).toBeGreaterThanOrEqual(-0.01);
      expect(r.x1).toBeLessThanOrEqual(w + 0.01);
      expect(r.y1).toBeLessThanOrEqual(h + 0.01);
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
    const result = computeTreemapLayout(node, 500, 400);
    expect(result.maxDepth).toBe(3);
  });

  it("leaf nodes have isLeaf true, internal nodes false", () => {
    const node = makeNode("root", 0, [
      makeTaxon("cat", 1),
      makeTaxon("dog", 2),
    ]);
    const result = computeTreemapLayout(node, 500, 400);
    const root = result.rects.find((r) => r.node.name === "root");
    const cat = result.rects.find((r) => r.node.name === "cat");
    expect(root.isLeaf).toBe(false);
    expect(cat.isLeaf).toBe(true);
  });

  it("rects include depth property", () => {
    const node = makeNode("root", 0, [
      makeTaxon("cat", 1),
    ]);
    const result = computeTreemapLayout(node, 500, 400);
    const root = result.rects.find((r) => r.node.name === "root");
    const cat = result.rects.find((r) => r.node.name === "cat");
    expect(root.depth).toBe(0);
    expect(cat.depth).toBe(1);
  });

  it("respects width and height parameters", () => {
    const node = makeNode("root", 0, [
      makeTaxon("cat", 1),
      makeTaxon("dog", 2),
    ]);
    const result = computeTreemapLayout(node, 800, 600);
    expect(result.width).toBe(800);
    expect(result.height).toBe(600);
    // The root rect should span the full area
    const root = result.rects.find((r) => r.node.name === "root");
    expect(root.x0).toBe(0);
    expect(root.y0).toBe(0);
    expect(root.x1).toBe(800);
    expect(root.y1).toBe(600);
  });
});
