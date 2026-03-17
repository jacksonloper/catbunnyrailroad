import { describe, it, expect } from "vitest";
import { computeTreemapLayout, depthColor, labelFit } from "./packLayout.js";

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

// ---- labelFit ----

describe("labelFit", () => {
  // fontSize defaults to 7 → charW = 4.2, textH = 7, pad = 2
  // "cat" → textW = 3*4.2 = 12.6

  it("returns 'h' when label fits horizontally", () => {
    expect(labelFit("cat", 50, 20)).toBe("h");
  });

  it("returns 'v' when label only fits rotated", () => {
    // 12.6+2 = 14.6 > 10 (no horizontal), but 14.6 ≤ 50 and 7+2 = 9 ≤ 10 (vertical ok)
    expect(labelFit("cat", 10, 50)).toBe("v");
  });

  it("returns null when label doesn't fit either way", () => {
    expect(labelFit("american pitcher plant", 10, 10)).toBeNull();
  });

  it("returns 'h' for a short label in a roomy cell", () => {
    expect(labelFit("x", 20, 20)).toBe("h");
  });

  it("returns null for a label in a tiny cell", () => {
    expect(labelFit("x", 3, 3)).toBeNull();
  });

  it("prefers horizontal when both orientations fit", () => {
    expect(labelFit("ab", 50, 50)).toBe("h");
  });

  it("handles empty string label", () => {
    // textW = 0, pad = 2 → needs cellW ≥ 2 and cellH ≥ 9
    expect(labelFit("", 5, 10)).toBe("h");
  });

  it("returns null when cell height is too short for text", () => {
    // textH + pad = 9, cellH = 8 → too short even for horizontal
    // textW("a") + pad = 6.2, cellW = 20 → width ok but height too short
    // vertical: textW + pad = 6.2 ≤ 8? yes. textH + pad = 9 ≤ 20? yes → "v"
    expect(labelFit("a", 20, 8)).toBe("v");
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
