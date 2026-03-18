import { describe, it, expect } from "vitest";
import { capitalize, extractSubtree, renderTreeAscii, renderCladeAscii } from "./treeUtils.js";
import tree from "./data/tree.json";
import taxa from "./data/taxa.json";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Build a Map from ott_id → taxa entry, matching App.jsx's taxaByOttId */
const taxaByOttId = new Map(taxa.map((t) => [t.ott_id, t]));

// ---------------------------------------------------------------------------
// capitalize
// ---------------------------------------------------------------------------

describe("capitalize", () => {
  it("capitalizes single word", () => {
    expect(capitalize("cat")).toBe("Cat");
  });

  it("capitalizes multiple words", () => {
    expect(capitalize("wolf and dog")).toBe("Wolf And Dog");
  });

  it("handles empty string", () => {
    expect(capitalize("")).toBe("");
  });
});

// ---------------------------------------------------------------------------
// extractSubtree
// ---------------------------------------------------------------------------

describe("extractSubtree", () => {
  it("returns a single leaf when only one taxon is selected", () => {
    const sub = extractSubtree(tree, new Set([563166])); // cat
    expect(sub).not.toBeNull();
    expect(sub.name).toBe("cat");
    expect(sub.children).toEqual([]);
    expect(sub.isTaxon).toBe(true);
  });

  it("returns a tree with two siblings sharing a parent", () => {
    // cat (563166) and lion (563151) are both in Felidae
    const sub = extractSubtree(tree, new Set([563166, 563151]));
    expect(sub).not.toBeNull();
    expect(sub.children.length).toBe(2);
    const leafNames = sub.children.map((c) => c.name).sort();
    expect(leafNames).toEqual(["cat", "lion"]);
  });

  it("collapses single-child internal chains", () => {
    // cat and wolf are distant enough that the chain between root and each
    // should be collapsed to the nearest common branching node
    const sub = extractSubtree(tree, new Set([563166, 247341]));
    expect(sub).not.toBeNull();
    // Every internal node in the result should have >= 2 children
    function checkNonSingleChild(node) {
      if (node.children.length === 0) return;
      expect(node.children.length).toBeGreaterThanOrEqual(2);
      node.children.forEach(checkNonSingleChild);
    }
    checkNonSingleChild(sub);
  });
});

// ---------------------------------------------------------------------------
// renderTreeAscii – integration with real CSV/tree data
// ---------------------------------------------------------------------------

describe("renderTreeAscii", () => {
  it("renders a single leaf node", () => {
    const sub = extractSubtree(tree, new Set([563166])); // cat
    const ascii = renderTreeAscii(sub);
    expect(ascii).toBe("Cat\n");
  });

  it("renders cat + lion (two siblings)", () => {
    const sub = extractSubtree(tree, new Set([563166, 563151]));
    const ascii = renderTreeAscii(sub);
    expect(ascii).toBe(
      [
        "Felidae",
        "+-- Lion",
        "+-- Cat",
        "",
      ].join("\n"),
    );
  });

  it("renders cat, wolf, lion, bear, rabbit with correct indentation", () => {
    // cat=563166, wolf=247341, lion=563151, brown bear=872567, rabbit=864596
    const picked = [563166, 247341, 563151, 872567, 864596];
    const sub = extractSubtree(tree, new Set(picked));
    const ascii = renderTreeAscii(sub);
    expect(ascii).toBe(
      [
        "Boreoeutheria",
        "+-- Rabbit",
        "+-- Mrcaott4697ott6940",
        "    +-- Caniformia",
        "    |   +-- Brown Bear",
        "    |   +-- Wolf And Dog",
        "    +-- Felidae",
        "        +-- Lion",
        "        +-- Cat",
        "",
      ].join("\n"),
    );
  });

  it("renders with unique (scientific) names when useUniqNames is set", () => {
    const picked = [563166, 247341, 563151, 872567, 864596];
    const sub = extractSubtree(tree, new Set(picked));
    const ascii = renderTreeAscii(sub, {
      taxaByOttId,
      useUniqNames: true,
    });
    expect(ascii).toBe(
      [
        "Boreoeutheria",
        "+-- Oryctolagus cuniculus",
        "+-- mrcaott4697ott6940",
        "    +-- Caniformia",
        "    |   +-- Ursus arctos",
        "    |   +-- Canis lupus",
        "    +-- Felidae",
        "        +-- Panthera leo",
        "        +-- Felis catus",
        "",
      ].join("\n"),
    );
  });

  it("renders Ericales subtree (blueberry, cranberry, tea, rhododendron, kiwifruit)", () => {
    // blueberry=567253, cranberry=295602, tea plant=1058509,
    // rhododendron=702552, kiwifruit=279986
    const picked = [567253, 295602, 1058509, 702552, 279986];
    const sub = extractSubtree(tree, new Set(picked));
    const ascii = renderTreeAscii(sub);
    expect(ascii).toBe(
      [
        "Mrcaott3582ott9475",
        "+-- Tea Plant",
        "+-- Mrcaott9475ott11591",
        "    +-- Kiwifruit",
        "    +-- Mrcaott11591ott24765",
        "        +-- Mrcaott12463ott72910",
        "        |   +-- Blueberry",
        "        |   +-- Cranberry",
        "        +-- Rhododendron",
        "",
      ].join("\n"),
    );
  });

  it("uses only pure ASCII characters (no Unicode box drawing)", () => {
    const picked = [563166, 247341, 563151, 872567, 864596];
    const sub = extractSubtree(tree, new Set(picked));
    const ascii = renderTreeAscii(sub);
    // Must not contain any Unicode box-drawing characters
    expect(ascii).not.toMatch(/[─│┌┐└┘├┤┬┴┼╭╮╯╰]/);
    // Should only contain printable ASCII
    expect(ascii).toMatch(/^[\x20-\x7E\n]+$/);
  });
});

// ---------------------------------------------------------------------------
// renderCladeAscii – clade display trees with taxa lists at leaves
// ---------------------------------------------------------------------------

describe("renderCladeAscii", () => {
  it("renders a single-leaf tree with _taxa list", () => {
    const node = {
      name: "felidae",
      children: [],
      _taxa: [
        { name: "cat", uniqname: "Felis catus" },
        { name: "lion", uniqname: "Panthera leo" },
      ],
    };
    const ascii = renderCladeAscii(node);
    expect(ascii).toBe("Cat, Lion\n");
  });

  it("renders a tree with internal nodes and leaf taxa lists", () => {
    const node = {
      name: "mammalia",
      children: [
        {
          name: "felidae",
          children: [],
          _taxa: [
            { name: "cat", uniqname: "Felis catus" },
            { name: "lion", uniqname: "Panthera leo" },
          ],
        },
        {
          name: "canidae",
          children: [],
          _taxa: [{ name: "wolf and dog", uniqname: "Canis lupus" }],
        },
      ],
    };
    const ascii = renderCladeAscii(node);
    expect(ascii).toBe(
      [
        "Mammalia",
        "+-- Cat, Lion",
        "+-- Wolf And Dog",
        "",
      ].join("\n"),
    );
  });

  it("uses uniqnames when useUniqNames is true", () => {
    const node = {
      name: "felidae",
      children: [],
      _taxa: [
        { name: "cat", uniqname: "Felis catus" },
        { name: "lion", uniqname: "Panthera leo" },
      ],
    };
    const ascii = renderCladeAscii(node, { useUniqNames: true });
    expect(ascii).toBe("Felis catus, Panthera leo\n");
  });

  it("falls back to capitalized name when _taxa is empty", () => {
    const node = { name: "unknown clade", children: [] };
    const ascii = renderCladeAscii(node);
    expect(ascii).toBe("Unknown Clade\n");
  });

  it("renders deeper nesting correctly", () => {
    const node = {
      name: "root",
      children: [
        {
          name: "branch a",
          children: [
            { name: "leaf1", children: [], _taxa: [{ name: "alpha" }] },
            { name: "leaf2", children: [], _taxa: [{ name: "beta" }, { name: "gamma" }] },
          ],
        },
        { name: "leaf3", children: [], _taxa: [{ name: "delta" }] },
      ],
    };
    const ascii = renderCladeAscii(node);
    expect(ascii).toBe(
      [
        "Root",
        "+-- Branch A",
        "|   +-- Alpha",
        "|   +-- Beta, Gamma",
        "+-- Delta",
        "",
      ].join("\n"),
    );
  });

  it("uses only pure ASCII characters", () => {
    const node = {
      name: "root",
      children: [
        { name: "a", children: [], _taxa: [{ name: "x" }, { name: "y" }] },
        { name: "b", children: [], _taxa: [{ name: "z" }] },
      ],
    };
    const ascii = renderCladeAscii(node);
    expect(ascii).not.toMatch(/[─│┌┐└┘├┤┬┴┼╭╮╯╰]/);
    expect(ascii).toMatch(/^[\x20-\x7E\n]+$/);
  });
});
