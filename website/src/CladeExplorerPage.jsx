import { useState, useMemo } from "react";
import taxa from "./data/taxa.json";
import tree from "./data/tree.json";
import { capitalize, renderCladeAscii } from "./treeUtils.js";
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
  if (kids.length === 1) return kids[0];
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

/* ───── helpers ───── */

/** Collect curated-taxa records under a condensed-tree node */
function leafTaxa(node) {
  if (node.children.length === 0) {
    const t = taxaByOttId.get(node.ott_id);
    return t ? [t] : [];
  }
  return node.children.flatMap(leafTaxa);
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

/* ───── component ───── */

export default function CladeExplorerPage() {
  const [viewRootId, setViewRootId] = useState(() => {
    const params = new URLSearchParams(window.location.search);
    const r = params.get("r");
    if (r !== null) {
      const id = parseInt(r, 10);
      if (nodeById.has(id)) return id;
    }
    return condensed._id;
  });
  const [expanded, setExpanded] = useState(() => {
    const params = new URLSearchParams(window.location.search);
    const e = params.get("e");
    if (e) {
      const ids = e.split(",").map((s) => parseInt(s, 10)).filter((id) => !isNaN(id));
      if (ids.length > 0) return new Set(ids);
    }
    return rootOnlyExpansion(condensed);
  });
  const [globalSeed, setGlobalSeed] = useState(0);
  const [menuNodeId, setMenuNodeId] = useState(null);
  const [showAsciiPicker, setShowAsciiPicker] = useState(false);
  const [copyMsg, setCopyMsg] = useState(null);
  const [searchInput, setSearchInput] = useState("");

  const viewRoot = nodeById.get(viewRootId);

  /* derived */
  const display = useMemo(
    () => buildDisplay(viewRoot, expanded),
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

  const handleShareLink = async () => {
    const params = new URLSearchParams();
    params.set("r", viewRootId);
    const ids = [...expanded].join(",");
    if (ids) params.set("e", ids);
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
      </div>

      <div className="clade-body">
        <div className="clade-display">
          {/* SVG tree with interactive controls */}
          <svg
            className="clade-svg"
            width={treeW}
            height={totalH}
            viewBox={`0 0 ${treeW} ${totalH}`}
          >
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
              return (
                <g
                  key={`ctrl-${nd.node._id}`}
                  className="tree-ctrl"
                  role="button"
                  aria-label="Node options"
                  onClick={() => setMenuNodeId(
                    menuNodeId === nd.node._id ? null : nd.node._id,
                  )}
                >
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
            return (
              <div
                className="node-menu"
                style={{ left: menuNd.x + 12, top: menuNd.y - 8 }}
              >
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
              return (
                <div
                  key={lf.node._id}
                  className="clade-row"
                  style={{ height: vSp }}
                >
                  <div className="clade-taxa">
                    {shuffled.map((t) => capitalize(t.name)).join(", ")}
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Bottom toolbar */}
        <div className="clade-bottom-bar">
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
