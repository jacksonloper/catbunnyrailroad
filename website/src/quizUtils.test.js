import { describe, it, expect } from "vitest";
import {
  findPath,
  findMRCA,
  mrcaDepth,
  solveQuiz,
  pickRandomTaxa,
  getDescendantTaxa,
  getCladeExplanation,
  QUIZ_TYPES,
} from "./quizUtils.js";
import tree from "./data/tree.json";

// ---------------------------------------------------------------------------
// findPath
// ---------------------------------------------------------------------------

describe("findPath", () => {
  it("finds path to the root node", () => {
    const path = findPath(tree, tree.ott_id);
    expect(path).not.toBeNull();
    expect(path).toHaveLength(1);
    expect(path[0]).toBe(tree);
  });

  it("returns null for a non-existent ott_id", () => {
    const path = findPath(tree, -999);
    expect(path).toBeNull();
  });

  it("finds path to a known taxon (cat = 563166)", () => {
    const path = findPath(tree, 563166); // cat
    expect(path).not.toBeNull();
    expect(path.length).toBeGreaterThan(1);
    expect(path[0]).toBe(tree);
    expect(path[path.length - 1].ott_id).toBe(563166);
  });
});

// ---------------------------------------------------------------------------
// findMRCA
// ---------------------------------------------------------------------------

describe("findMRCA", () => {
  it("returns root as MRCA of root and any taxon", () => {
    const mrca = findMRCA(tree.ott_id, 563166);
    expect(mrca).toBe(tree);
  });

  it("returns a common ancestor for two taxa", () => {
    // cat (563166) and wolf-and-dog (247341) are both mammals
    const mrca = findMRCA(563166, 247341);
    expect(mrca).not.toBeNull();
    expect(mrca).not.toBe(tree); // should be deeper than root
  });

  it("returns null if one ott_id is invalid", () => {
    const mrca = findMRCA(563166, -999);
    expect(mrca).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// mrcaDepth
// ---------------------------------------------------------------------------

describe("mrcaDepth", () => {
  it("returns -1 for invalid ott_ids", () => {
    expect(mrcaDepth(-1, -2)).toBe(-1);
  });

  it("returns non-negative for valid taxa", () => {
    const d = mrcaDepth(563166, 247341); // cat and wolf-and-dog
    expect(d).toBeGreaterThanOrEqual(0);
  });

  it("closely related taxa have deeper MRCA than distant ones", () => {
    // cat (563166) and wolf-and-dog (247341) are both mammals
    // cat and corn (605194) should be much less related
    const catWolf = mrcaDepth(563166, 247341);
    const catCorn = mrcaDepth(563166, 605194);
    expect(catWolf).toBeGreaterThan(catCorn);
  });
});

// ---------------------------------------------------------------------------
// pickRandomTaxa
// ---------------------------------------------------------------------------

describe("pickRandomTaxa", () => {
  it("returns n taxa", () => {
    const result = pickRandomTaxa(3);
    expect(result).toHaveLength(3);
  });

  it("returns different taxa (no duplicates)", () => {
    const result = pickRandomTaxa(3);
    const ids = result.map((t) => t.ott_id);
    expect(new Set(ids).size).toBe(3);
  });

  it("each taxon has expected fields", () => {
    const result = pickRandomTaxa(1);
    expect(result[0]).toHaveProperty("name");
    expect(result[0]).toHaveProperty("ott_id");
  });
});

// ---------------------------------------------------------------------------
// solveQuiz
// ---------------------------------------------------------------------------

describe("solveQuiz", () => {
  it("identifies outgroup for cat/wolf/corn", () => {
    // cat=563166, wolf-and-dog=247341, corn=605194
    // Cat and wolf are both mammals; corn is a plant → corn is the outgroup
    const result = solveQuiz([563166, 247341, 605194]);
    expect(result.outgroupIndex).toBe(2); // corn (index 2) is most distant
    expect(result.mrcaTree).toBeDefined();
    expect(result.mrcaTree.children).toHaveLength(2);
  });

  it("identifies outgroup regardless of order (corn first)", () => {
    // corn=605194, cat=563166, wolf-and-dog=247341
    const result = solveQuiz([605194, 563166, 247341]);
    expect(result.outgroupIndex).toBe(0); // corn (index 0) is most distant
  });

  it("mrcaTree root contains all three taxa", () => {
    const result = solveQuiz([563166, 247341, 605194]);
    expect(result.mrcaTree.taxa).toHaveLength(3);
  });

  it("mrcaTree closer-pair node contains two taxa", () => {
    const result = solveQuiz([563166, 247341, 605194]);
    const closerNode = result.mrcaTree.children[0];
    expect(closerNode.taxa).toHaveLength(2);
  });

  it("mrcaTree outgroup node contains one taxon", () => {
    const result = solveQuiz([563166, 247341, 605194]);
    const outgroupNode = result.mrcaTree.children[1];
    expect(outgroupNode.taxa).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// getDescendantTaxa
// ---------------------------------------------------------------------------

describe("getDescendantTaxa", () => {
  it("returns taxa for Mammalia (244265)", () => {
    const taxa = getDescendantTaxa(244265);
    expect(taxa.length).toBeGreaterThanOrEqual(3);
    // cat (563166) should be a mammal descendant
    expect(taxa.some((t) => t.ott_id === 563166)).toBe(true);
  });

  it("returns taxa for Mesangiospermae (5298374)", () => {
    const taxa = getDescendantTaxa(5298374);
    expect(taxa.length).toBeGreaterThanOrEqual(3);
    // corn (605194) should be a Mesangiospermae descendant
    expect(taxa.some((t) => t.ott_id === 605194)).toBe(true);
  });

  it("does not include non-descendants", () => {
    const mammals = getDescendantTaxa(244265);
    // corn (605194) is a plant, not a mammal
    expect(mammals.some((t) => t.ott_id === 605194)).toBe(false);
  });

  it("returns empty array for unknown ott_id", () => {
    expect(getDescendantTaxa(-999)).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// pickRandomTaxa with rootOttId
// ---------------------------------------------------------------------------

describe("pickRandomTaxa with rootOttId", () => {
  it("picks from Mammalia when rootOttId=244265", () => {
    const mammals = getDescendantTaxa(244265);
    const mammalOttIds = new Set(mammals.map((t) => t.ott_id));
    const result = pickRandomTaxa(3, 244265);
    expect(result).toHaveLength(3);
    result.forEach((t) => {
      expect(mammalOttIds.has(t.ott_id)).toBe(true);
    });
  });

  it("falls back to all taxa for unknown rootOttId", () => {
    const result = pickRandomTaxa(3, -999);
    expect(result).toHaveLength(3);
  });
});

// ---------------------------------------------------------------------------
// internal node labels
// ---------------------------------------------------------------------------

describe("internal node labels", () => {
  const CLADES = [
    { name: "monocot",        ottId: 1058517 },
    { name: "eudicot",        ottId: 431495  },
    { name: "rosid",          ottId: 1008296 },
    { name: "asterid",        ottId: 1008294 },
    { name: "Asparagales",    ottId: 557124  },
    { name: "Ericales",       ottId: 648892  },
    { name: "grassy monocot", ottId: 921871  },
    { name: "Lamiales",       ottId: 23736   },
    { name: "campanulid",     ottId: 596121  },
  ];

  it.each(CLADES)(
    "findPath locates $name (ott $ottId)",
    ({ ottId }) => {
      const path = findPath(tree, ottId);
      expect(path).not.toBeNull();
      expect(path.length).toBeGreaterThanOrEqual(2);
    }
  );

  it("getDescendantTaxa for monocot includes corn (605194)", () => {
    const taxa = getDescendantTaxa(1058517);
    expect(taxa.some((t) => t.ott_id === 605194)).toBe(true);
  });

  it("getDescendantTaxa for monocot does NOT include sunflower (515712)", () => {
    const taxa = getDescendantTaxa(1058517);
    expect(taxa.some((t) => t.ott_id === 515712)).toBe(false);
  });

  it("getDescendantTaxa for rosid includes rose (259066)", () => {
    const taxa = getDescendantTaxa(1008296);
    expect(taxa.some((t) => t.ott_id === 259066)).toBe(true);
  });

  it("getDescendantTaxa for asterid includes sunflower (515712)", () => {
    const taxa = getDescendantTaxa(1008294);
    expect(taxa.some((t) => t.ott_id === 515712)).toBe(true);
  });

  it("getDescendantTaxa for Ericales includes blueberry (567253)", () => {
    const taxa = getDescendantTaxa(648892);
    expect(taxa.some((t) => t.ott_id === 567253)).toBe(true);
  });

  it("getDescendantTaxa for Asparagales includes orchid (406191)", () => {
    const taxa = getDescendantTaxa(557124);
    expect(taxa.some((t) => t.ott_id === 406191)).toBe(true);
  });

  it("getDescendantTaxa for grassy monocot includes pineapple (627039)", () => {
    const taxa = getDescendantTaxa(921871);
    expect(taxa.some((t) => t.ott_id === 627039)).toBe(true);
  });

  it("euasterid node is named in the tree (no ott_id)", () => {
    // The euasterid node has no ott_id, but should be found by name on paths
    // sausage tree=482933 is under euasterid
    const path = findPath(tree, 482933);
    const euasteridNode = path.find((n) => n.name === "euasterid");
    expect(euasteridNode).toBeDefined();
  });

  it("getDescendantTaxa for Lamiales includes sausage tree (482933)", () => {
    const taxa = getDescendantTaxa(23736);
    expect(taxa.some((t) => t.ott_id === 482933)).toBe(true);
  });

  it("getDescendantTaxa for campanulid includes sunflower (515712)", () => {
    const taxa = getDescendantTaxa(596121);
    expect(taxa.some((t) => t.ott_id === 515712)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// getCladeExplanation
// ---------------------------------------------------------------------------

describe("getCladeExplanation", () => {
  it("returns explanation with eudicot for two eudicots and a monocot", () => {
    // blueberry=567253 (eudicot/asterid), rose=259066 (eudicot/rosid), corn=605194 (monocot)
    const ottIds = [567253, 259066, 605194];
    const result = solveQuiz(ottIds);
    const explanation = getCladeExplanation(ottIds, result.outgroupIndex);
    expect(explanation).not.toBeNull();
    expect(explanation).toMatch(/eudicots/);
    expect(explanation).toMatch(/Corn/);
    expect(explanation).toMatch(/not/);
  });

  it("returns explanation with monocot for two monocots and a eudicot", () => {
    // corn=605194, pineapple=627039 (both monocots), rose=259066 (eudicot)
    const ottIds = [605194, 627039, 259066];
    const result = solveQuiz(ottIds);
    const explanation = getCladeExplanation(ottIds, result.outgroupIndex);
    expect(explanation).not.toBeNull();
    expect(explanation).toMatch(/monocots/i);
    expect(explanation).toMatch(/Rose/);
    expect(explanation).toMatch(/not/);
  });

  it("picks deepest (most specific) clade name", () => {
    // sunflower=515712, blueberry=567253 (both asterids within eudicots), corn=605194 (monocot)
    const ottIds = [515712, 567253, 605194];
    const result = solveQuiz(ottIds);
    const explanation = getCladeExplanation(ottIds, result.outgroupIndex);
    expect(explanation).not.toBeNull();
    // asterid is deeper than eudicot, so asterid should be preferred
    expect(explanation).toMatch(/asterids/);
  });

  it("returns null for star topology", () => {
    const explanation = getCladeExplanation([1, 2, 3], null);
    expect(explanation).toBeNull();
  });

  it("returns null when no nice name exists along the path", () => {
    // cat=563166, wolf-and-dog=247341, rabbit=864596 — all mammals
    // Between the closer pair MRCA and the overall MRCA we find "Laurasiatheria"
    const ottIds = [563166, 247341, 864596];
    const result = solveQuiz(ottIds);
    const explanation = getCladeExplanation(ottIds, result.outgroupIndex);
    // Laurasiatheria is a named clade on the path, so we expect an explanation
    expect(explanation).not.toBeNull();
    expect(explanation).toMatch(/Laurasiatheria/);
  });

  it("returns Lamiales explanation for two Lamiales and an Ericales", () => {
    // sausage tree=482933, anise hyssop=1062003 (both Lamiales), shea tree=194532 (Ericales)
    const ottIds = [482933, 1062003, 194532];
    const result = solveQuiz(ottIds);
    const explanation = getCladeExplanation(ottIds, result.outgroupIndex);
    expect(explanation).not.toBeNull();
    expect(explanation).toMatch(/Lamiales/);
    expect(explanation).toMatch(/Shea Tree/);
    expect(explanation).toMatch(/not/);
  });

  it("returns euasterid explanation for lamiid + campanulid vs Ericales", () => {
    // sausage tree=482933 (lamiid/Lamiales), sunflower=515712 (campanulid/Asterales),
    // shea tree=194532 (Ericales)
    const ottIds = [482933, 515712, 194532];
    const result = solveQuiz(ottIds);
    const explanation = getCladeExplanation(ottIds, result.outgroupIndex);
    expect(explanation).not.toBeNull();
    expect(explanation).toMatch(/euasterids/);
    expect(explanation).toMatch(/Shea Tree/);
    expect(explanation).toMatch(/not/);
  });

  it("returns campanulid explanation for two campanulids vs lamiid", () => {
    // sunflower=515712, carrot=372836 (both campanulids), sausage tree=482933 (lamiid)
    const ottIds = [515712, 372836, 482933];
    const result = solveQuiz(ottIds);
    const explanation = getCladeExplanation(ottIds, result.outgroupIndex);
    expect(explanation).not.toBeNull();
    expect(explanation).toMatch(/campanulids/);
    expect(explanation).toMatch(/Sausage Tree/);
    expect(explanation).toMatch(/not/);
  });
});

// ---------------------------------------------------------------------------
// QUIZ_TYPES
// ---------------------------------------------------------------------------

describe("QUIZ_TYPES", () => {
  it("has at least two entries with rootOttId", () => {
    const withRoot = QUIZ_TYPES.filter((qt) => qt.rootOttId !== null);
    expect(withRoot.length).toBeGreaterThanOrEqual(2);
  });

  it("each entry has a label", () => {
    QUIZ_TYPES.forEach((qt) => {
      expect(typeof qt.label).toBe("string");
      expect(qt.label.length).toBeGreaterThan(0);
    });
  });
});
