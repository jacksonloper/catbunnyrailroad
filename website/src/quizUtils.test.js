import { describe, it, expect } from "vitest";
import {
  findPath,
  findMRCA,
  mrcaDepth,
  solveQuiz,
  pickRandomTaxa,
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
