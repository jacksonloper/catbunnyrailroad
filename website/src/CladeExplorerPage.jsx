import { useState, useMemo } from "react";
import taxa from "./data/taxa.json";
import tree from "./data/tree.json";
import { capitalize, canonicalizeTree, renderCladeAscii } from "./treeUtils.js";
import { buildTrie } from "./trieUtils.js";
import Autocomplete from "./Autocomplete.jsx";
import Navbar from "./Navbar.jsx";
import "./CladeExplorerPage.css";

/* ───── module-level data ───── */

const taxaByOttId = new Map(taxa.map((t) => [t.ott_id, t]));
const allOttIds = new Set(taxa.map((t) => t.ott_id));

/**
 * Build a condensed tree containing only curated taxa as leaves.
 * Internal taxa (nodes that are curated taxa but also have descendant
 * curated taxa) are kept as internal nodes only — they do NOT get
 * duplicated as extra leaf-children.
 * Single-child chains are collapsed.
 */
function buildCondensed(node) {
  const isTaxon = allOttIds.has(node.ott_id);
  if (!node.children || node.children.length === 0) {
    return isTaxon
      ? { name: node.name, ott_id: node.ott_id, children: [] }
      : null;
  }
  const kids = node.children.map(buildCondensed).filter(Boolean);
  if (kids.length === 0) {
    return isTaxon
      ? { name: node.name, ott_id: node.ott_id, children: [] }
      : null;
  }
  if (kids.length === 1 && !isTaxon) return kids[0];
  return { name: node.name, ott_id: node.ott_id, children: kids };
}

const condensed = buildCondensed(tree);

/* assign stable numeric ids */
let nextNodeId = 0;
function assignNodeId(n) {
  n._id = nextNodeId++;
  n.children.forEach(assignNodeId);
}
assignNodeId(condensed);

/* lookup maps */
const nodeById = new Map();
const parentOf = new Map();
const nodeByOttId = new Map();
(function buildNodeMaps(n) {
  nodeById.set(n._id, n);
  nodeByOttId.set(n.ott_id, n);
  n.children.forEach((c) => {
    parentOf.set(c._id, n);
    buildNodeMaps(c);
  });
})(condensed);

/* trie for taxa search */
const cladeTrie = buildTrie(taxa);

/* ───── stable node identification helpers ───── */

/** Get ott_id of the first (leftmost) leaf descendant */
function firstLeafOttId(node) {
  if (node.children.length === 0) return node.ott_id;
  return firstLeafOttId(node.children[0]);
}

/** Find the LCA of two nodes identified by ott_id */
function findLCA(ottId1, ottId2) {
  const n1 = nodeByOttId.get(ottId1);
  const n2 = nodeByOttId.get(ottId2);
  if (!n1 || !n2) return null;
  return findLCANodes(n1, n2);
}

/** Find the LCA of two condensed-tree nodes */
function findLCANodes(node1, node2) {
  if (!node1 || !node2) return null;
  const ancestors = new Set();
  let cur = node1;
  while (cur) {
    ancestors.add(cur._id);
    cur = parentOf.get(cur._id);
  }
  cur = node2;
  while (cur) {
    if (ancestors.has(cur._id)) return cur;
    cur = parentOf.get(cur._id);
  }
  return null;
}

/** Find the LCA (MRCA) of multiple nodes identified by ott_id */
function findLCAMultiple(ottIds) {
  const nodes = ottIds.map((id) => nodeByOttId.get(id)).filter(Boolean);
  if (nodes.length === 0) return null;
  let result = nodes[0];
  for (let i = 1; i < nodes.length; i++) {
    result = findLCANodes(result, nodes[i]);
    if (!result) return null;
  }
  return result;
}

/** True if a condensed-tree node has a meaningful (non-MRCA) name */
function hasNodeName(node) {
  return Boolean(node.name && !node.name.startsWith("mrca"));
}

/**
 * Encode a condensed-tree node as a stable string reference.
 * Nodes with ott_id → plain number.
 * MRCA nodes (no ott_id) → "leafOtt1_leafOtt2" (LCA of two descendant leaves).
 */
function encodeNodeRef(node) {
  if (node.ott_id) return String(node.ott_id);
  if (node.children.length < 2) return null;
  const l1 = firstLeafOttId(node.children[0]);
  const l2 = firstLeafOttId(node.children[1]);
  return `${l1}_${l2}`;
}

/**
 * Decode a node reference string back to a condensed-tree node.
 * Plain number → lookup by ott_id.
 * "a_b" → find the LCA of ott_ids a and b.
 */
function decodeNodeRef(str) {
  if (str.includes("_")) {
    const [a, b] = str.split("_").map(Number);
    if (isNaN(a) || isNaN(b)) return null;
    return findLCA(a, b);
  }
  const ottId = parseInt(str, 10);
  if (isNaN(ottId)) return null;
  return nodeByOttId.get(ottId) || null;
}

/* ───── presets ───── */

const PRESETS = [
  {
    label: "Plant example",
    rootOttId: 10218,
    expandedOttIds: [10218, 5298374],
    expandedLeafPairs: [
      [411489, 483272], [411489, 989042], [989042, 125543], [989042, 515700],
      [989042, 1071040], [515700, 1001039], [515700, 957388], [515700, 25036],
      [125543, 510792], [125543, 429489], [125543, 208052], [208052, 1058514],
      [1058514, 279986], [279986, 137603], [279986, 170513], [170513, 257180],
      [207474, 664533], [207474, 247717], [207474, 406191], [406191, 878707],
      [406191, 626975], [626975, 465347], [626975, 62303], [626975, 497827],
    ],
  },
  {
    label: "Bat example",
    rootOttId: 574724,
    expandedOttIds: [574724, 238434],
    expandedLeafPairs: [
      [533619, 6788], [533619, 1018309], [533619, 238416], [6788, 581454],
      [6788, 1039976], [1039976, 759857], [1039976, 267980], [581454, 1018272],
      [574742, 316928], [316928, 267987],
    ],
  },
];

/* ───── helpers ───── */

/** Precompute curated-taxa counts for every condensed-tree node */
const taxaCountByNodeId = new Map();
(function computeTaxaCounts(node) {
  if (node.children.length === 0) {
    const c = taxaByOttId.has(node.ott_id) ? 1 : 0;
    taxaCountByNodeId.set(node._id, c);
    return c;
  }
  let count = node.children.reduce((s, ch) => s + computeTaxaCounts(ch), 0);
  if (taxaByOttId.has(node.ott_id)) count += 1;
  taxaCountByNodeId.set(node._id, count);
  return count;
})(condensed);

/**
 * Compute the expansion set so every leaf in the display has at most maxTaxa taxa.
 * Starts from the given root and recursively expands nodes with too many taxa.
 */
function expandToMaxTaxa(root, maxTaxa) {
  const exp = new Set();
  function visit(node) {
    if (node.children.length === 0) return;
    if (taxaCountByNodeId.get(node._id) > maxTaxa) {
      exp.add(node._id);
      node.children.forEach(visit);
    }
  }
  visit(root);
  return exp;
}

/** Collect curated-taxa records under a condensed-tree node */
function leafTaxa(node) {
  if (node.children.length === 0) {
    const t = taxaByOttId.get(node.ott_id);
    return t ? [t] : [];
  }
  const childTaxa = node.children.flatMap(leafTaxa);
  const ownTaxon = taxaByOttId.get(node.ott_id);
  return ownTaxon ? [ownTaxon, ...childTaxa] : childTaxa;
}

/** Build the display tree (leaves carry _taxa arrays) */
function buildDisplay(node, exp) {
  if (!exp.has(node._id) || node.children.length === 0) {
    return {
      _id: node._id,
      name: node.name,
      ott_id: node.ott_id,
      children: [],
      _taxa: leafTaxa(node),
    };
  }
  return {
    _id: node._id,
    name: node.name,
    ott_id: node.ott_id,
    children: node.children.map((c) => buildDisplay(c, exp)),
  };
}

/** Return expansion set that only opens the root (showing its direct children) */
function rootOnlyExpansion(root) {
  const exp = new Set();
  if (root.children.length > 0) exp.add(root._id);
  return exp;
}

/* ───── layout ───── */

function layoutTree(root, vSp) {
  const hSp = 16;
  const leftPad = 10;
  const nodes = [];
  const edges = [];
  let li = 0;
  let maxLeafDepth = 0;

  function walk(n, d) {
    const x = d * hSp + leftPad;
    if (n.children.length === 0) {
      if (d > maxLeafDepth) maxLeafDepth = d;
      const y = li * vSp + vSp / 2;
      li++;
      nodes.push({ x, y, node: n, isLeaf: true });
      return y;
    }
    const cys = n.children.map((c) => walk(c, d + 1));
    const y = (Math.min(...cys) + Math.max(...cys)) / 2;
    const isPenult = n.children.every((c) => c.children.length === 0);
    nodes.push({ x, y, node: n, isLeaf: false, isPenultimate: isPenult });
    return y;
  }
  walk(root, 0);

  const treeW = maxLeafDepth * hSp + leftPad + 2;

  (function be(n) {
    if (n.children.length === 0) return;
    const pi = nodes.find((x) => x.node === n);
    if (!pi) return;
    const cis = n.children
      .map((c) => nodes.find((x) => x.node === c))
      .filter(Boolean);
    if (!cis.length) return;
    const ys = [...cis.map((c) => c.y), pi.y];
    edges.push({
      x1: pi.x,
      y1: Math.min(...ys),
      x2: pi.x,
      y2: Math.max(...ys),
    });
    cis.forEach((ci) => {
      /* extend leaf lines to the right edge of the SVG */
      const endX = ci.node.children.length === 0 ? treeW : ci.x;
      edges.push({ x1: pi.x, y1: ci.y, x2: endX, y2: ci.y });
    });
    n.children.forEach(be);
  })(root);

  return { nodes, edges, leafCount: li, hSp, vSp, treeW };
}

/* ───── deterministic shuffle ───── */

function shuffle(arr, seed) {
  const r = [...arr];
  let s = Math.abs(seed | 0) || 1;
  const rng = () => {
    s = (s * 1103515245 + 12345) & 0x7fffffff;
    return s / 0x7fffffff;
  };
  for (let i = r.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [r[i], r[j]] = [r[j], r[i]];
  }
  return r;
}

/** Parse comma-separated OTT IDs from a URL param string, filtering to known taxa */
function parseHighlightParam(h) {
  if (!h) return [];
  return h.split(",").map(Number).filter((id) => !Number.isNaN(id) && allOttIds.has(id));
}

/* ───── component ───── */

export default function CladeExplorerPage() {
  const [viewRootId, setViewRootId] = useState(() => {
    const params = new URLSearchParams(window.location.search);
    const r = params.get("r");
    if (r === "h") {
      /* r=h means "use MRCA of highlighted organisms as root" */
      const ids = parseHighlightParam(params.get("h"));
      if (ids.length >= 2) {
        const mrca = findLCAMultiple(ids);
        if (mrca) return mrca._id;
      } else if (ids.length === 1) {
        const node = nodeByOttId.get(ids[0]);
        if (node) return node._id;
      }
    } else if (r !== null) {
      const node = decodeNodeRef(r);
      if (node) return node._id;
    }
    return condensed._id;
  });
  const [expanded, setExpanded] = useState(() => {
    const params = new URLSearchParams(window.location.search);
    const e = params.get("e");
    if (e) {
      const nodes = e.split(",").map(decodeNodeRef).filter(Boolean);
      if (nodes.length > 0) {
        const ids = new Set(nodes.map((n) => n._id));
        /* Ensure all ancestors of each expanded node are also expanded,
           so that buildDisplay can reach every requested node. */
        for (const n of nodes) {
          let cur = parentOf.get(n._id);
          while (cur && !ids.has(cur._id)) {
            ids.add(cur._id);
            cur = parentOf.get(cur._id);
          }
        }
        return ids;
      }
    }
    /* When highlighting is active without explicit expansion, expand the
       view root so the first level of the MRCA subtree is visible. */
    const r = params.get("r");
    if (r === "h") {
      const ids = parseHighlightParam(params.get("h"));
      if (ids.length >= 2) {
        const mrca = findLCAMultiple(ids);
        if (mrca) return rootOnlyExpansion(mrca);
      }
    }
    return rootOnlyExpansion(condensed);
  });
  const [highlighted] = useState(() => {
    const params = new URLSearchParams(window.location.search);
    const ids = parseHighlightParam(params.get("h"));
    return ids.length > 0 ? new Set(ids) : new Set();
  });
  const [globalSeed, setGlobalSeed] = useState(0);
  const [menuNodeId, setMenuNodeId] = useState(null);
  const [showAsciiPicker, setShowAsciiPicker] = useState(false);
  const [copyMsg, setCopyMsg] = useState(null);
  const [searchInput, setSearchInput] = useState("");
  const [expandMax, setExpandMax] = useState(5);

  const viewRoot = nodeById.get(viewRootId);

  /* derived */
  const display = useMemo(
    () => {
      const d = buildDisplay(viewRoot, expanded);
      canonicalizeTree(d);
      return d;
    },
    [viewRoot, expanded],
  );
  const vSp = 28;
  const lay = useMemo(() => layoutTree(display, vSp), [display]);
  const leaves = useMemo(
    () => lay.nodes.filter((nd) => nd.isLeaf),
    [lay],
  );
  const leafCount = leaves.length;
  const treeW = lay.treeW;
  const totalH = leafCount * vSp;

  /* Set of descendant-leaf _ids for the currently-selected menu node */
  const menuDescLeafIds = useMemo(() => {
    if (menuNodeId === null) return null;
    const ids = new Set();
    const collect = (n) => {
      if (n.children.length === 0) { ids.add(n._id); return; }
      n.children.forEach(collect);
    };
    const start = lay.nodes.find((x) => x.node._id === menuNodeId);
    if (start) collect(start.node);
    return ids;
  }, [menuNodeId, lay]);

  /* handlers */
  const handleOpen = (id) => {
    const cn = nodeById.get(id);
    if (!cn || cn.children.length === 0) return;
    setExpanded((prev) => new Set([...prev, id]));
    setMenuNodeId(null);
  };

  const handleCollapseNode = (id) => {
    if (!expanded.has(id)) return;
    setExpanded((prev) => {
      const next = new Set(prev);
      next.delete(id);
      const removeDesc = (node) => {
        for (const child of node.children) {
          next.delete(child._id);
          removeDesc(child);
        }
      };
      const nd = nodeById.get(id);
      if (nd) removeDesc(nd);
      return next;
    });
  };

  const handleDrillDown = (id) => {
    const node = nodeById.get(id);
    if (!node) return;
    setViewRootId(id);
    /* keep existing expansion state — descendants of the new root stay open */
  };

  const handleDrillUp = () => {
    const parent = parentOf.get(viewRootId);
    if (!parent) return;
    setViewRootId(parent._id);
    /* keep existing expansion state and ensure parent is expanded */
    setExpanded((prev) => new Set([...prev, parent._id]));
    setMenuNodeId(null);
  };

  const handleCycleAll = () => {
    setGlobalSeed((prev) => prev + 1);
  };

  const handleSearchSelect = (sp) => {
    setSearchInput("");
    /* Find the condensed-tree leaf for this taxon */
    const leaf = nodeByOttId.get(sp.ott_id);
    if (!leaf) return;
    /* Use its immediate parent in the condensed tree as the new root */
    const parent = parentOf.get(leaf._id);
    const target = parent || leaf;
    setViewRootId(target._id);
    setExpanded(rootOnlyExpansion(target));
  };

  const handleExpand = () => {
    setExpanded(expandToMaxTaxa(viewRoot, expandMax));
  };

  const handleShareLink = async () => {
    const params = new URLSearchParams();
    const root = nodeById.get(viewRootId);
    params.set("r", encodeNodeRef(root));
    const refs = [...expanded]
      .map((id) => nodeById.get(id))
      .filter(Boolean)
      .map((n) => encodeNodeRef(n))
      .filter(Boolean);
    if (refs.length) params.set("e", refs.join(","));
    if (highlighted.size > 0) params.set("h", [...highlighted].join(","));
    const url = `${window.location.origin}/clades?${params}`;
    try {
      await navigator.clipboard.writeText(url);
      setCopyMsg("Link copied!");
    } catch {
      setCopyMsg("Copy failed");
    }
    setTimeout(() => setCopyMsg(null), 1500);
  };

  const handleCopyAscii = async (useUniq) => {
    const ascii = renderCladeAscii(display, { useUniqNames: useUniq });
    try {
      await navigator.clipboard.writeText(ascii);
      setCopyMsg("ASCII copied!");
    } catch {
      setCopyMsg("Copy failed");
    }
    setShowAsciiPicker(false);
    setTimeout(() => setCopyMsg(null), 1500);
  };

  const handlePresetSelect = (e) => {
    const idx = parseInt(e.target.value, 10);
    if (isNaN(idx) || idx < 0 || idx >= PRESETS.length) return;
    const preset = PRESETS[idx];
    const root = nodeByOttId.get(preset.rootOttId);
    if (!root) return;

    const exp = new Set();
    /* expand ancestors from condensed root to preset root */
    let cur = root;
    while (cur) {
      if (cur.children.length > 0) exp.add(cur._id);
      cur = parentOf.get(cur._id);
    }
    /* expand nodes identified by ott_id */
    for (const ottId of preset.expandedOttIds) {
      const node = nodeByOttId.get(ottId);
      if (node) exp.add(node._id);
    }
    /* expand MRCA nodes identified by leaf pairs */
    for (const [l1, l2] of preset.expandedLeafPairs) {
      const lca = findLCA(l1, l2);
      if (lca) exp.add(lca._id);
    }

    setViewRootId(root._id);
    setExpanded(exp);
    e.target.value = "";
  };

  return (
    <div className="clade-page">
      <Navbar />
      <div className="clade-toolbar">
        <h1 className="clade-title">Clade Explorer</h1>
        <div className="clade-search">
          <Autocomplete
            label="Search"
            value={searchInput}
            onChange={setSearchInput}
            onSelect={handleSearchSelect}
            trie={cladeTrie}
            selectedItem={null}
          />
        </div>
        <select
          className="clade-preset-select"
          onChange={handlePresetSelect}
          value=""
          aria-label="Load a preset"
        >
          <option value="" disabled>Presets…</option>
          {PRESETS.map((p, i) => (
            <option key={i} value={i}>{p.label}</option>
          ))}
        </select>
      </div>

      <div className="clade-body">
        <div
          className="clade-display"
          onClick={() => { if (menuNodeId !== null) setMenuNodeId(null); }}
        >
          {/* SVG tree with interactive controls */}
          <svg
            className="clade-svg"
            width={treeW}
            height={totalH}
            viewBox={`0 0 ${treeW} ${totalH}`}
          >
            {/* Descendant highlight background */}
            {menuNodeId !== null && (() => {
              const menuNd = lay.nodes.find((x) => x.node._id === menuNodeId);
              if (!menuNd || !menuDescLeafIds || menuDescLeafIds.size === 0) return null;
              const descLeaves = leaves.filter((lf) => menuDescLeafIds.has(lf.node._id));
              if (descLeaves.length === 0) return null;
              const ys = descLeaves.map((lf) => lf.y);
              const yMin = Math.min(...ys) - vSp / 2;
              const yMax = Math.max(...ys) + vSp / 2;
              return (
                <rect
                  x={menuNd.x} y={yMin}
                  width={treeW - menuNd.x} height={yMax - yMin}
                  fill="currentColor" className="desc-highlight-rect"
                />
              );
            })()}

            {/* Tree edges */}
            {lay.edges.map((e, i) => (
              <line
                key={i}
                x1={e.x1}
                y1={e.y1}
                x2={e.x2}
                y2={e.y2}
                stroke="#666"
                strokeWidth={1.5}
              />
            ))}

            {/* Interactive node controls */}
            {lay.nodes.map((nd) => {
              const isRoot = nd.node._id === viewRootId;

              /* ── root node ── */
              if (isRoot) {
                if (viewRootId !== condensed._id) {
                  return (
                    <g
                      key={`ctrl-${nd.node._id}`}
                      className="tree-ctrl"
                      role="button"
                      aria-label="Navigate to parent clade"
                      onClick={handleDrillUp}
                    >
                      <circle cx={nd.x} cy={nd.y} r={9}
                        fill="#2a2a2a" stroke="#e8a020" strokeWidth={2} />
                      <text x={nd.x} y={nd.y + 5} textAnchor="middle"
                        fill="#e8a020" fontSize="14"
                        style={{ pointerEvents: "none" }}>◂</text>
                    </g>
                  );
                }
                return (
                  <circle key={`ctrl-${nd.node._id}`}
                    cx={nd.x} cy={nd.y} r={3} fill="#888" />
                );
              }

              /* ── leaf node ── */
              if (nd.isLeaf) {
                const cn = nodeById.get(nd.node._id);
                const canOpen = cn && cn.children.length > 0;
                if (canOpen) {
                  return (
                    <g
                      key={`ctrl-${nd.node._id}`}
                      className="tree-ctrl"
                      role="button"
                      aria-label="Expand clade"
                      onClick={() => handleOpen(nd.node._id)}
                    >
                      <circle cx={nd.x} cy={nd.y} r={7}
                        fill="#2a2a2a" stroke="#e8a020" strokeWidth={1.5} />
                      <text x={nd.x} y={nd.y + 4} textAnchor="middle"
                        fill="#e8a020" fontSize="14"
                        style={{ pointerEvents: "none" }}>+</text>
                    </g>
                  );
                }
                return (
                  <circle key={`ctrl-${nd.node._id}`}
                    cx={nd.x} cy={nd.y}
                    r={3}
                    fill="#e8a020"
                    stroke="none"
                    strokeWidth={1} />
                );
              }

              /* ── expanded internal node: unified ● menu button ── */
              const named = hasNodeName(nd.node);
              return (
                <g
                  key={`ctrl-${nd.node._id}`}
                  className="tree-ctrl"
                  role="button"
                  aria-label="Node options"
                  onClick={(e) => {
                    e.stopPropagation();
                    setMenuNodeId(
                      menuNodeId === nd.node._id ? null : nd.node._id,
                    );
                  }}
                >
                  {named && (
                    <circle cx={nd.x} cy={nd.y} r={11}
                      fill="none"
                      stroke="#e8a020" strokeWidth={1} />
                  )}
                  <circle cx={nd.x} cy={nd.y} r={7}
                    fill={menuNodeId === nd.node._id ? "#e8a020" : "#2a2a2a"}
                    stroke="#e8a020" strokeWidth={1.5} />
                  <text x={nd.x} y={nd.y + 4} textAnchor="middle"
                    fill={menuNodeId === nd.node._id ? "#2a2a2a" : "#e8a020"}
                    fontSize="11"
                    style={{ pointerEvents: "none" }}>●</text>
                </g>
              );
            })}
          </svg>

          {/* Node action menu popup */}
          {menuNodeId !== null && (() => {
            const menuNd = lay.nodes.find((x) => x.node._id === menuNodeId);
            if (!menuNd) return null;
            const menuNodeName = hasNodeName(menuNd.node)
              ? menuNd.node.name : null;
            return (
              <div
                className="node-menu"
                style={{ left: menuNd.x + 12, top: menuNd.y - 8 }}
                onClick={(e) => e.stopPropagation()}
              >
                {menuNodeName && (
                  <div className="node-menu-name">{capitalize(menuNodeName)}</div>
                )}
                <button
                  className="node-menu-btn"
                  onClick={() => {
                    handleDrillDown(menuNodeId);
                    setMenuNodeId(null);
                  }}
                >
                  Set as root
                </button>
                <button
                  className="node-menu-btn"
                  onClick={() => {
                    handleCollapseNode(menuNodeId);
                    setMenuNodeId(null);
                  }}
                >
                  Collapse
                </button>
              </div>
            );
          })()}

          {/* Taxa rows – just the taxa names, no labels or counts */}
          <div className="clade-rows">
            {leaves.map((lf) => {
              const taxaList =
                lf.node._taxa || leafTaxa(nodeById.get(lf.node._id));
              const seed = (globalSeed + 1) * 10000 + lf.node._id;
              const shuffled = shuffle(taxaList, seed);
              /* Move highlighted taxa to front */
              const hasHL = highlighted.size > 0;
              const ordered = hasHL
                ? [
                    ...shuffled.filter((t) => highlighted.has(t.ott_id)),
                    ...shuffled.filter((t) => !highlighted.has(t.ott_id)),
                  ]
                : shuffled;
              const isDesc = menuDescLeafIds && menuDescLeafIds.has(lf.node._id);
              return (
                <div
                  key={lf.node._id}
                  className={`clade-row${isDesc ? " clade-row-desc" : ""}`}
                  style={{ height: vSp }}
                >
                  <div className="clade-taxa">
                    {hasHL
                      ? ordered.map((t, i) => (
                          <span key={t.ott_id}>
                            {i > 0 && ", "}
                            {highlighted.has(t.ott_id) ? (
                              <strong className="clade-hl">
                                {capitalize(t.name)}
                              </strong>
                            ) : (
                              capitalize(t.name)
                            )}
                          </span>
                        ))
                      : ordered.map((t) => capitalize(t.name)).join(", ")}
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Bottom toolbar */}
        <div className="clade-bottom-bar">
          <span className="clade-expand-group">
            <button
              className="clade-btn"
              onClick={handleExpand}
              title="Expand tree until every leaf has at most N taxa"
            >
              🌳 Expand
            </button>
            <select
              className="clade-expand-select"
              value={expandMax}
              onChange={(e) => setExpandMax(Number(e.target.value))}
              aria-label="Max taxa per leaf"
              title="Max taxa per leaf"
            >
              <option value={1}>≤ 1</option>
              <option value={2}>≤ 2</option>
              <option value={5}>≤ 5</option>
              <option value={10}>≤ 10</option>
            </select>
          </span>
          <button
            className="clade-btn"
            onClick={handleCycleAll}
            title="Re-randomize order of all rows"
          >
            🔄 Shuffle
          </button>
          <button
            className="clade-btn"
            onClick={handleShareLink}
            title="Copy a shareable link to this view"
          >
            🔗 Share Link
          </button>
          <button
            className="clade-btn"
            onClick={() => setShowAsciiPicker(true)}
            title="Copy as ASCII tree text"
          >
            📝 Copy ASCII
          </button>
          {copyMsg && <span className="clade-copy-msg">{copyMsg}</span>}
        </div>
      </div>

      {/* ASCII name-choice modal */}
      {showAsciiPicker && (
        <div
          className="clade-modal-overlay"
          onClick={() => setShowAsciiPicker(false)}
        >
          <div
            className="clade-modal"
            onClick={(e) => e.stopPropagation()}
          >
            <p className="clade-modal-title">Copy ASCII tree using:</p>
            <div className="clade-modal-btns">
              <button
                className="clade-btn"
                onClick={() => handleCopyAscii(false)}
              >
                Common names
              </button>
              <button
                className="clade-btn"
                onClick={() => handleCopyAscii(true)}
              >
                Scientific names
              </button>
            </div>
            <button
              className="clade-modal-close"
              onClick={() => setShowAsciiPicker(false)}
            >
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
