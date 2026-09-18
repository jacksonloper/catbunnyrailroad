import { describe, it, expect } from "vitest";
import {
  applyPlacementOverrides,
  parseOverrideRows,
} from "../../scripts/placement-overrides.js";

/** Tiny tree builder: t(name, ott, children) */
const t = (name, ott_id, children = [], isTaxon = children.length === 0) => ({
  name,
  ott_id,
  children,
  isTaxon,
});

/** Newick-ish rendering for easy assertions: names only. */
function render(n) {
  if (n.children.length === 0) return n.name;
  return `(${n.children.map(render).join(",")})${n.name}`;
}

function findByOtt(node, ott) {
  if (node.ott_id === ott) return node;
  for (const c of node.children) {
    const r = findByOtt(c, ott);
    if (r) return r;
  }
  return null;
}

/**
 * Mirrors the real situation: theropod sits with squamates, sauropod hangs
 * off the root, birds sit with crocodile.
 */
function sampleTree() {
  return t("Sauria", 1, [
    t("Diplodocus", 40),
    t("mrca_birds_croc", null, [
      t("crocodile", 10),
      t("Aves", 11, [t("chicken", 12), t("ostrich", 13)], false),
    ], false),
    t("mrca_squamates_theropods", null, [
      t("mrca_squamates", null, [t("snake", 20), t("iguana", 21)], false),
      t("T. rex", 30),
    ], false),
  ], false);
}

describe("parseOverrideRows", () => {
  it("parses numeric fields and optional anchor_b / clade_ott_id", () => {
    const rows = parseOverrideRows([
      { ott_id: "30", anchor_a: "12", anchor_b: "13", clade_name: "X", clade_ott_id: "99", upstream_ref: "OTL-1", reason: "r" },
      { ott_id: "40", anchor_a: "30", anchor_b: "", clade_name: "Y", clade_ott_id: "", upstream_ref: "", reason: "" },
    ]);
    expect(rows[0]).toMatchObject({ ott_id: 30, anchor_a: 12, anchor_b: 13, clade_ott_id: 99 });
    expect(rows[1]).toMatchObject({ ott_id: 40, anchor_a: 30, anchor_b: null, clade_ott_id: null });
  });

  it("rejects rows anchoring on themselves", () => {
    expect(() =>
      parseOverrideRows([{ ott_id: "30", anchor_a: "30", anchor_b: "" }])
    ).toThrow(/cannot anchor on itself/);
  });
});

describe("applyPlacementOverrides", () => {
  it("moves a taxon to be sister of an MRCA clade and collapses the hole it left", () => {
    const root = applyPlacementOverrides(sampleTree(), [
      { ott_id: 30, anchor_a: 12, anchor_b: 13, clade_name: "Coelurosauria", clade_ott_id: 300 },
    ]);
    // T. rex is now sister to Aves under a new Coelurosauria node; the
    // squamate/theropod wrapper node collapsed away.
    expect(render(root)).toBe(
      "(Diplodocus,(crocodile,((chicken,ostrich)Aves,T. rex)Coelurosauria)mrca_birds_croc,(snake,iguana)mrca_squamates)Sauria"
    );
    const coel = findByOtt(root, 300);
    expect(coel.name).toBe("Coelurosauria");
    expect(coel.isTaxon).toBeUndefined();
  });

  it("applies rows in order so later rows can anchor on new clade ids", () => {
    const root = applyPlacementOverrides(sampleTree(), [
      { ott_id: 30, anchor_a: 12, anchor_b: 13, clade_name: "Coelurosauria", clade_ott_id: 300 },
      { ott_id: 40, anchor_a: 300, anchor_b: null, clade_name: "Saurischia", clade_ott_id: 400 },
    ]);
    expect(render(root)).toBe(
      "((crocodile,(((chicken,ostrich)Aves,T. rex)Coelurosauria,Diplodocus)Saurischia)mrca_birds_croc,(snake,iguana)mrca_squamates)Sauria"
    );
  });

  it("single anchor means sister to that node itself", () => {
    const root = applyPlacementOverrides(sampleTree(), [
      { ott_id: 40, anchor_a: 10, anchor_b: null, clade_name: "Weird", clade_ott_id: null },
    ]);
    expect(render(root)).toContain("(crocodile,Diplodocus)Weird");
  });

  it("keeps the moved taxon's own subtree", () => {
    const tree = sampleTree();
    // Make T. rex an internal taxon with a child.
    const trex = findByOtt(tree, 30);
    trex.children = [t("T. rex jr", 31)];
    const root = applyPlacementOverrides(tree, [
      { ott_id: 30, anchor_a: 12, anchor_b: 13, clade_name: "Coelurosauria", clade_ott_id: 300 },
    ]);
    expect(render(root)).toContain("((chicken,ostrich)Aves,(T. rex jr)T. rex)Coelurosauria");
  });

  it("replaces the root when the anchor is the root", () => {
    const root = applyPlacementOverrides(sampleTree(), [
      { ott_id: 40, anchor_a: 10, anchor_b: 20, clade_name: "NewRoot", clade_ott_id: 500 },
    ]);
    expect(root.name).toBe("NewRoot");
    expect(root.ott_id).toBe(500);
    expect(root.children.map((c) => c.name)).toEqual(["Sauria", "Diplodocus"]);
  });

  it("collapses a root left with a single child after detaching", () => {
    const tree = t("root", 1, [t("a", 2), t("b", 3, [t("c", 4), t("d", 5)], false)], false);
    const root = applyPlacementOverrides(tree, [
      { ott_id: 2, anchor_a: 4, anchor_b: null, clade_name: "N", clade_ott_id: null },
    ]);
    expect(render(root)).toBe("((c,a)N,d)b");
  });

  it("throws when the taxon or the anchor is missing", () => {
    expect(() =>
      applyPlacementOverrides(sampleTree(), [{ ott_id: 999, anchor_a: 12, anchor_b: 13, clade_name: "X" }])
    ).toThrow(/not found/);
    expect(() =>
      applyPlacementOverrides(sampleTree(), [{ ott_id: 30, anchor_a: 998, anchor_b: 13, clade_name: "X" }])
    ).toThrow(/anchor .* not found/);
  });

  it("throws when clade_ott_id already exists in the tree", () => {
    expect(() =>
      applyPlacementOverrides(sampleTree(), [{ ott_id: 30, anchor_a: 12, anchor_b: 13, clade_name: "X", clade_ott_id: 11 }])
    ).toThrow(/already exists/);
  });

  it("warns when the override is already a no-op", () => {
    const warnings = [];
    // Diplodocus is already sister to (crocodile) under a 2-child node.
    const tree = t("root", 1, [t("x", 2), t("pair", null, [t("crocodile", 10), t("Diplodocus", 40)], false)], false);
    applyPlacementOverrides(
      tree,
      [{ ott_id: 40, anchor_a: 10, anchor_b: null, clade_name: "N", clade_ott_id: null }],
      { warn: (m) => warnings.push(m) }
    );
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toMatch(/no-op/);
  });
});
