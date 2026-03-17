import { useState, useMemo } from "react";
import { Link } from "react-router-dom";
import taxa from "./data/taxa.json";
import tree from "./data/tree.json";
import { capitalize } from "./treeUtils.js";
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
let _nid = 0;
function _assignId(n) {
  n._id = _nid++;
  n.children.forEach(_assignId);
}
_assignId(condensed);

/* lookup maps */
const nodeById = new Map();
const parentOf = new Map();
(function _maps(n) {
  nodeById.set(n._id, n);
  n.children.forEach((c) => {
    parentOf.set(c._id, n);
    _maps(c);
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

function isMeaningful(name) {
  return name && !/^mrca/.test(name);
}

/* ───── layout (matches SubtreeView style) ───── */

function layoutTree(root, vSp) {
  const hSp = 28;
  const nodes = [];
  const edges = [];
  let li = 0;

  function walk(n, d) {
    const x = d * hSp;
    if (n.children.length === 0) {
      const y = li * vSp + vSp / 2;
      li++;
      nodes.push({ x, y, node: n, isClade: true });
      return y;
    }
    const cys = n.children.map((c) => walk(c, d + 1));
    const y = (Math.min(...cys) + Math.max(...cys)) / 2;
    nodes.push({ x, y, node: n, isClade: false });
    return y;
  }
  walk(root, 0);

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
    cis.forEach((ci) =>
      edges.push({ x1: pi.x, y1: ci.y, x2: ci.x, y2: ci.y }),
    );
    n.children.forEach(be);
  })(root);

  return { nodes, edges, leafCount: li, hSp, vSp };
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
  const [expanded, setExpanded] = useState(() => initExpansion(condensed, 10));
  const [seeds, setSeeds] = useState({});

  /* derived */
  const display = useMemo(
    () => buildDisplay(condensed, expanded),
    [expanded],
  );
  const vSp = 48;
  const lay = useMemo(() => layoutTree(display, vSp), [display]);
  const clades = useMemo(
    () => lay.nodes.filter((nd) => nd.isClade),
    [lay],
  );
  const cladeCount = clades.length;
  const currentLeafCount = useMemo(
    () => displayLeaves(condensed, expanded).length,
    [expanded],
  );

  const treeDepth = useMemo(() => {
    const md = (nd) =>
      nd.children.length === 0
        ? 0
        : 1 + Math.max(...nd.children.map(md));
    return md(display);
  }, [display]);

  const treeW = (treeDepth + 1) * lay.hSp + 8;
  const totalH = Math.max(cladeCount, n) * vSp;

  /* handlers */
  const handleOpen = (id) => {
    const cn = nodeById.get(id);
    if (!cn || cn.children.length === 0) return;
    if (currentLeafCount - 1 + cn.children.length > n) return;
    setExpanded((prev) => new Set([...prev, id]));
  };

  const handleCollapse = (id) => {
    const par = parentOf.get(id);
    if (!par || !expanded.has(par._id)) return;
    setExpanded((prev) => {
      const next = new Set(prev);
      next.delete(par._id);
      return next;
    });
  };

  const handleCycle = (id) => {
    setSeeds((prev) => ({ ...prev, [id]: (prev[id] || 0) + 1 }));
  };

  const handleChangeN = (newN) => {
    setN(newN);
    setExpanded(initExpansion(condensed, newN));
    setSeeds({});
  };

  return (
    <div className="clade-page">
      <nav className="clade-nav">
        <Link to="/" className="clade-home">
          ← Home
        </Link>
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
      </nav>

      <div className="clade-body">
        <div className="clade-display">
          {/* SVG tree topology */}
          <svg
            className="clade-svg"
            width={treeW}
            height={totalH}
            viewBox={`0 0 ${treeW} ${totalH}`}
          >
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
            {clades.map((c) => (
              <circle
                key={c.node._id}
                cx={c.x}
                cy={c.y}
                r={4}
                fill="#e8a020"
              />
            ))}
          </svg>

          {/* Clade rows */}
          <div className="clade-rows">
            {clades.map((c) => {
              const taxa_list = c.node._taxa || leafTaxa(nodeById.get(c.node._id));
              const seed =
                ((seeds[c.node._id] || 0) + 1) * 10000 + c.node._id;
              const shuffled = shuffle(taxa_list, seed);
              const name = isMeaningful(c.node.name)
                ? capitalize(c.node.name)
                : null;
              const cn = nodeById.get(c.node._id);
              const openable =
                cn &&
                cn.children.length > 0 &&
                currentLeafCount - 1 + cn.children.length <= n;
              const collapsible =
                parentOf.has(c.node._id) &&
                expanded.has(parentOf.get(c.node._id)._id);

              return (
                <div
                  key={c.node._id}
                  className="clade-row"
                  style={{ height: vSp }}
                >
                  <div className="clade-info">
                    {name && <span className="clade-name">{name}</span>}
                    <span className="clade-count">({taxa_list.length})</span>
                  </div>
                  <div className="clade-taxa">
                    {shuffled.map((t) => capitalize(t.name)).join(", ")}
                  </div>
                  <div className="clade-btns">
                    <button
                      className="clade-btn"
                      disabled={!openable}
                      onClick={() => handleOpen(c.node._id)}
                      title="Split into subclades"
                    >
                      +
                    </button>
                    <button
                      className="clade-btn"
                      disabled={!collapsible}
                      onClick={() => handleCollapse(c.node._id)}
                      title="Merge with siblings"
                    >
                      −
                    </button>
                    <button
                      className="clade-btn"
                      onClick={() => handleCycle(c.node._id)}
                      title="Re-randomize order"
                    >
                      🔄
                    </button>
                  </div>
                </div>
              );
            })}

            {/* Empty rows */}
            {Array.from({ length: n - cladeCount }, (_, i) => (
              <div
                key={`empty-${i}`}
                className="clade-row clade-row-empty"
                style={{ height: vSp }}
              >
                <span className="clade-empty-label">(empty)</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
