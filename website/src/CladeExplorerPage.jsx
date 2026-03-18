import { useState, useMemo } from "react";
import taxa from "./data/taxa.json";
import tree from "./data/tree.json";
import { capitalize } from "./treeUtils.js";
import Navbar from "./Navbar.jsx";
import "./CladeExplorerPage.css";

/* ───── module-level data ───── */

const taxaByOttId = new Map(taxa.map((t) => [t.ott_id, t]));
const allOttIds = new Set(taxa.map((t) => t.ott_id));

/**
 * Build a condensed tree containing only curated taxa as leaves.
 * Internal-taxon nodes (nodes that are both curated taxa AND have
 * descendants that are also curated taxa) get an extra leaf-child
 * so that every curated taxon is a leaf in the result.
 * Single-child chains are collapsed.
 */
function buildCondensed(node) {
  const isTaxon = allOttIds.has(node.ott_id);
  if (!node.children || node.children.length === 0) {
    return isTaxon
      ? { name: node.name, ott_id: node.ott_id, children: [] }
      : null;
  }
  let kids = node.children.map(buildCondensed).filter(Boolean);
  if (kids.length === 0) {
    return isTaxon
      ? { name: node.name, ott_id: node.ott_id, children: [] }
      : null;
  }
  if (isTaxon) {
    kids = [
      { name: node.name, ott_id: node.ott_id, children: [] },
      ...kids,
    ];
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
(function buildNodeMaps(n) {
  nodeById.set(n._id, n);
  n.children.forEach((c) => {
    parentOf.set(c._id, n);
    buildNodeMaps(c);
  });
})(condensed);

/* ───── helpers ───── */

/** Collect curated-taxa records under a condensed-tree node */
function leafTaxa(node) {
  if (node.children.length === 0) {
    const t = taxaByOttId.get(node.ott_id);
    return t ? [t] : [];
  }
  return node.children.flatMap(leafTaxa);
}

/** List the visible clade-leaves given an expanded set */
function displayLeaves(node, exp) {
  if (!exp.has(node._id) || node.children.length === 0) return [node];
  return node.children.flatMap((c) => displayLeaves(c, exp));
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

/** Greedily expand clades until we reach n visible rows */
function initExpansion(root, n) {
  const exp = new Set();
  if (root.children.length === 0) return exp;
  exp.add(root._id);
  for (;;) {
    const lvs = displayLeaves(root, exp);
    if (lvs.length >= n) break;
    let best = null;
    let bestN = 0;
    for (const lv of lvs) {
      if (lv.children.length === 0) continue;
      if (lvs.length - 1 + lv.children.length > n) continue;
      const cnt = leafTaxa(lv).length;
      if (cnt > bestN) {
        best = lv;
        bestN = cnt;
      }
    }
    if (!best) break;
    exp.add(best._id);
  }
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
  const [n, setN] = useState(10);
  const [viewRootId, setViewRootId] = useState(condensed._id);
  const [expanded, setExpanded] = useState(() => initExpansion(condensed, 10));
  const [globalSeed, setGlobalSeed] = useState(0);

  const viewRoot = nodeById.get(viewRootId);

  /* derived */
  const display = useMemo(
    () => buildDisplay(viewRoot, expanded),
    [viewRoot, expanded],
  );
  const vSp = 48;
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
    if (leafCount - 1 + cn.children.length > n) return;
    setExpanded((prev) => new Set([...prev, id]));
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
    setExpanded(initExpansion(node, n));
  };

  const handleDrillUp = () => {
    const parent = parentOf.get(viewRootId);
    if (!parent) return;
    setViewRootId(parent._id);
    setExpanded(initExpansion(parent, n));
  };

  const handleCycleAll = () => {
    setGlobalSeed((prev) => prev + 1);
  };

  const handleChangeN = (newN) => {
    setN(newN);
    setExpanded(initExpansion(viewRoot, newN));
  };

  return (
    <div className="clade-page">
      <Navbar />
      <div className="clade-toolbar">
        <h1 className="clade-title">Clade Explorer</h1>
        <div className="clade-n-ctrl">
          <label>
            Rows:{" "}
            <select
              value={n}
              onChange={(e) => handleChangeN(Number(e.target.value))}
            >
              {[5, 8, 10, 12, 15, 20].map((v) => (
                <option key={v} value={v}>
                  {v}
                </option>
              ))}
            </select>
          </label>
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
                      <circle cx={nd.x} cy={nd.y} r={7}
                        fill="#2a2a2a" stroke="#e8a020" strokeWidth={1.5} />
                      <text x={nd.x} y={nd.y + 4} textAnchor="middle"
                        fill="#e8a020" fontSize="11"
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
                const canOpen =
                  cn &&
                  cn.children.length > 0 &&
                  leafCount - 1 + cn.children.length <= n;
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
                const hasHidden = cn && cn.children.length > 0;
                return (
                  <circle key={`ctrl-${nd.node._id}`}
                    cx={nd.x} cy={nd.y}
                    r={hasHidden ? 5 : 3}
                    fill={hasHidden ? "#555" : "#e8a020"}
                    stroke={hasHidden ? "#888" : "none"}
                    strokeWidth={1} />
                );
              }

              /* ── penultimate node (all children are leaves): − button ── */
              if (nd.isPenultimate) {
                return (
                  <g
                    key={`ctrl-${nd.node._id}`}
                    className="tree-ctrl"
                    role="button"
                    aria-label="Collapse clade"
                    onClick={() => handleCollapseNode(nd.node._id)}
                  >
                    <circle cx={nd.x} cy={nd.y} r={7}
                      fill="#2a2a2a" stroke="#e8a020" strokeWidth={1.5} />
                    <text x={nd.x} y={nd.y + 4} textAnchor="middle"
                      fill="#e8a020" fontSize="14"
                      style={{ pointerEvents: "none" }}>−</text>
                  </g>
                );
              }

              /* ── deep internal node: drill-down ▸ ── */
              return (
                <g
                  key={`ctrl-${nd.node._id}`}
                  className="tree-ctrl"
                  role="button"
                  aria-label="Focus on this clade"
                  onClick={() => handleDrillDown(nd.node._id)}
                >
                  <circle cx={nd.x} cy={nd.y} r={7}
                    fill="#2a2a2a" stroke="#e8a020" strokeWidth={1.5} />
                  <text x={nd.x} y={nd.y + 4} textAnchor="middle"
                    fill="#e8a020" fontSize="11"
                    style={{ pointerEvents: "none" }}>▸</text>
                </g>
              );
            })}
          </svg>

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

        {/* Single shuffle button at the bottom */}
        <div className="clade-bottom-bar">
          <button
            className="clade-btn"
            onClick={handleCycleAll}
            title="Re-randomize order of all rows"
          >
            🔄 Shuffle
          </button>
        </div>
      </div>
    </div>
  );
}
