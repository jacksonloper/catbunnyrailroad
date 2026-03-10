import { useState, useMemo, useRef, useEffect } from "react";
import taxa from "./data/taxa.json";
import tree from "./data/tree.json";
import { binarizeTree, embedTreeInMaze } from "./mazeEmbed.js";
import "./App.css";

// ---------------------------------------------------------------------------
// Tree utilities – work with the compact tree JSON
// ---------------------------------------------------------------------------

/** Collect the names of all taxa (isTaxon nodes) under a tree node */
function getTaxa(node) {
  let result = [];
  if (node.isTaxon) result.push(node.name);
  for (const child of node.children) {
    result = result.concat(getTaxa(child));
  }
  return result;
}

/** Find the path from root to the node with the given ott_id */
function findPath(node, ottId, path = []) {
  const current = [...path, node];
  if (node.ott_id === ottId) return current;
  for (const child of node.children) {
    const result = findPath(child, ottId, current);
    if (result) return result;
  }
  return null;
}

/** Find the path from root to a specific internal node (by reference) */
function findNodePath(root, target, path = []) {
  const current = [...path, root];
  if (root === target) return current;
  for (const child of root.children) {
    const result = findNodePath(child, target, current);
    if (result) return result;
  }
  return null;
}

/** Find the MRCA node for N taxa (by ott_id) */
function findMRCAMultiple(treeRoot, ottIds) {
  if (ottIds.length === 0) return null;
  const paths = ottIds.map((id) => findPath(treeRoot, id)).filter(Boolean);
  if (paths.length < 2) return null;

  let mrca = treeRoot;
  const minLen = Math.min(...paths.map((p) => p.length));
  for (let i = 0; i < minLen; i++) {
    if (paths.every((p) => p[i] === paths[0][i])) mrca = paths[0][i];
    else break;
  }
  return mrca;
}

/**
 * Extract an induced subtree containing only the specified ott_ids.
 * Keeps taxa nodes even if they are internal (have children).
 * Internal nodes with a single child are collapsed (unless they are taxa).
 */
function extractSubtree(node, ottIdSet) {
  const isTaxon = ottIdSet.has(node.ott_id);

  if (node.children.length === 0) {
    // Leaf: keep only if it's a requested taxon
    if (isTaxon) {
      return { name: node.name, ott_id: node.ott_id, children: [], isTaxon: true };
    }
    return null;
  }
  // Recurse into children and keep only non-null results
  const keptChildren = node.children
    .map((c) => extractSubtree(c, ottIdSet))
    .filter(Boolean);

  if (keptChildren.length === 0 && !isTaxon) return null;
  // Collapse internal nodes with a single child (unless this node is a taxon)
  if (keptChildren.length === 1 && !isTaxon) return keptChildren[0];
  const result = { name: node.name, ott_id: node.ott_id, children: keptChildren };
  if (isTaxon) result.isTaxon = true;
  return result;
}

// ---------------------------------------------------------------------------
// Trie-based autocomplete
// ---------------------------------------------------------------------------

class TrieNode {
  constructor() {
    this.children = {};
    this.items = [];
  }
}

function buildTrie(items) {
  const root = new TrieNode();
  for (const item of items) {
    // Index each word in the name so "swallowtail butterfly" matches "butterfly"
    const words = item.name.toLowerCase().split(/\s+/);
    const seenNodes = new Set(); // avoid duplicate insertions for same prefix
    for (const word of words) {
      let node = root;
      for (const ch of word) {
        if (!node.children[ch]) node.children[ch] = new TrieNode();
        node = node.children[ch];
        if (!seenNodes.has(node)) {
          node.items.push(item);
          seenNodes.add(node);
        }
      }
    }
  }
  return root;
}

function trieSearch(root, prefix) {
  let node = root;
  for (const ch of prefix.toLowerCase()) {
    if (!node.children[ch]) return [];
    node = node.children[ch];
  }
  return node.items;
}

// ---------------------------------------------------------------------------
// Components
// ---------------------------------------------------------------------------

function Autocomplete({ label, value, onChange, onSelect, trie, selectedItem }) {
  const [showDropdown, setShowDropdown] = useState(false);
  const ref = useRef(null);

  const suggestions = useMemo(
    () => (value.length > 0 ? trieSearch(trie, value) : []),
    [value, trie]
  );

  // Close dropdown on outside click
  useEffect(() => {
    function handleClick(e) {
      if (ref.current && !ref.current.contains(e.target)) {
        setShowDropdown(false);
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, []);

  return (
    <div className="autocomplete" ref={ref}>
      <label>{label}</label>
      <input
        type="text"
        value={value}
        placeholder="Type a name..."
        onChange={(e) => {
          onChange(e.target.value);
          setShowDropdown(true);
        }}
        onFocus={() => setShowDropdown(true)}
      />
      {showDropdown && suggestions.length > 0 && !selectedItem && (
        <ul className="suggestions">
          {suggestions.map((sp) => (
            <li
              key={sp.ott_id}
              onClick={() => {
                onSelect(sp);
                setShowDropdown(false);
              }}
            >
              {sp.image_url && (
                <img src={sp.image_url} alt="" className="suggestion-img" />
              )}
              <span>{sp.name}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

// Build a lookup map for taxa data by name
const taxaByName = new Map(taxa.map((t) => [t.name, t]));
const taxaByOttId = new Map(taxa.map((t) => [t.ott_id, t]));

const OUTSIDE_PAGE_SIZE = 20;
const INGROUP_PAGE_SIZE = 20;

// ---------------------------------------------------------------------------
// SVG tree layout – topology-only cladogram (no internal labels)
// ---------------------------------------------------------------------------

/** Collect all taxa OTT IDs from a subtree node */
function collectSubtreeOtts(node) {
  let result = [];
  if (node.isTaxon) result.push(node.ott_id);
  for (const child of node.children) {
    result = result.concat(collectSubtreeOtts(child));
  }
  return result;
}

/** Compute max depth (number of edges from root to deepest leaf) */
function maxDepth(node) {
  if (node.children.length === 0) return 0;
  return 1 + Math.max(...node.children.map(maxDepth));
}

/**
 * Layout the tree for SVG rendering.
 * Returns { nodes: [{x, y, node, isLeaf}], edges: [{x1,y1,x2,y2}] }
 *
 * Every user-selected taxon (isTaxon node) gets its own sequential y-line,
 * whether it is a leaf or an internal node.  Non-taxon internal nodes are
 * vertically placed at the average of their descendant taxa positions.
 */
function layoutTree(root) {
  const depth = maxDepth(root);
  const hSpacing = 32; // horizontal pixels per depth level
  const vSpacing = 28; // vertical pixels per taxon row
  const nodes = [];
  const edges = [];
  let lineIndex = 0;

  function walk(node, d) {
    const x = d * hSpacing;

    if (node.children.length === 0) {
      // Leaf – always gets its own line
      const y = lineIndex * vSpacing;
      lineIndex++;
      nodes.push({ x, y, node, isLeaf: true });
      return y;
    }

    if (node.isTaxon) {
      // Internal taxon – gets its own line, then walk children
      const selfY = lineIndex * vSpacing;
      lineIndex++;
      node.children.forEach((c) => walk(c, d + 1));
      nodes.push({ x, y: selfY, node, isLeaf: false });
      return selfY;
    }

    // Non-taxon internal – avg of children
    const childYs = node.children.map((c) => walk(c, d + 1));
    const y = childYs.reduce((a, b) => a + b, 0) / childYs.length;
    nodes.push({ x, y, node, isLeaf: false });
    return y;
  }

  walk(root, 0);

  // Build edge list from laid-out node positions
  function buildEdges(node) {
    if (node.children.length === 0) return;
    const parentInfo = nodes.find((n) => n.node === node);
    if (!parentInfo) return;
    const childInfos = node.children.map((c) => nodes.find((n) => n.node === c));
    const validChildren = childInfos.filter(Boolean);
    if (validChildren.length === 0) return;

    // Vertical line at parent x – include parent y so that taxon internal
    // nodes that sit above/below their children are properly connected.
    const ys = [...validChildren.map((c) => c.y), parentInfo.y];
    const minY = Math.min(...ys);
    const maxY = Math.max(...ys);
    edges.push({ x1: parentInfo.x, y1: minY, x2: parentInfo.x, y2: maxY });

    // Horizontal lines to each child
    for (const ci of validChildren) {
      edges.push({ x1: parentInfo.x, y1: ci.y, x2: ci.x, y2: ci.y });
    }

    for (const child of node.children) {
      buildEdges(child);
    }
  }
  buildEdges(root);

  return { nodes, edges, leafCount: lineIndex, hSpacing, vSpacing, depth };
}

function SubtreeView({ subtree, onClose }) {
  const [copied, setCopied] = useState(false);
  const [copiedJson, setCopiedJson] = useState(false);
  const [activeComment, setActiveComment] = useState(null); // ott_id of open comment
  const [showMaze, setShowMaze] = useState(false);

  const layout = useMemo(() => layoutTree(subtree), [subtree]);
  const taxaNodes = layout.nodes.filter((n) => n.node.isTaxon);
  const ottIds = useMemo(() => collectSubtreeOtts(subtree), [subtree]);

  const mazeData = useMemo(() => {
    if (!showMaze) return null;
    const bin = binarizeTree(subtree);
    return embedTreeInMaze(bin);
  }, [showMaze, subtree]);

  const labelOffset = 8;
  const imgSize = 20;
  const pxPerChar = 7;      // approximate character width for label measurement
  const starPad = 30;       // extra right padding for comment stars
  // Measure longest label to set SVG width
  const maxLabelLen = taxaNodes.length > 0 ? Math.max(...taxaNodes.map((l) => l.node.name.length)) : 0;
  const rightPad = maxLabelLen * pxPerChar + imgSize + labelOffset + starPad;
  const svgWidth = (layout.depth + 1) * layout.hSpacing + rightPad;
  const svgHeight = layout.leafCount * layout.vSpacing;

  /** Enrich subtree with comments for JSON export */
  function enrichWithComments(node) {
    const result = { name: node.name, ott_id: node.ott_id, children: (node.children || []).map(enrichWithComments) };
    if (node.isTaxon) result.isTaxon = true;
    const sp = taxaByOttId.get(node.ott_id);
    if (sp?.comments) result.comments = sp.comments;
    return result;
  }

  function copyToClipboard(text, onSuccess) {
    navigator.clipboard.writeText(text).then(onSuccess).catch(() => {
      const ta = document.createElement("textarea");
      ta.value = text;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand("copy");
      document.body.removeChild(ta);
      onSuccess();
    });
  }

  function handleCopy() {
    copyToClipboard(ottIds.join(","), () => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }

  function handleCopyJson() {
    const enriched = enrichWithComments(subtree);
    copyToClipboard(JSON.stringify(enriched, null, 2), () => {
      setCopiedJson(true);
      setTimeout(() => setCopiedJson(false), 2000);
    });
  }

  const activeCommentData = activeComment != null ? taxaByOttId.get(activeComment) : null;

  // ---- Maze view ----
  if (showMaze && mazeData) {
    const cellSize = 20;
    const mazeSvgW = mazeData.size * cellSize;
    const mazeSvgH = mazeData.size * cellSize;
    // Gather taxa placements for labels
    const taxaPlacements = mazeData.placements.filter((p) => p.node.isTaxon);

    return (
      <div className="subtree-overlay">
        <div className="subtree-panel">
          <div className="subtree-header">
            <h3>Maze</h3>
            <div className="subtree-header-actions">
              <button
                className="subtree-copy-btn"
                onClick={() => setShowMaze(false)}
              >
                🌳 Back to tree
              </button>
              <button className="subtree-close" aria-label="Close" onClick={onClose}>✕</button>
            </div>
          </div>
          <div className="subtree-content">
            <svg
              className="maze-svg"
              width={mazeSvgW}
              height={mazeSvgH}
              viewBox={`0 0 ${mazeSvgW} ${mazeSvgH}`}
            >
              {/* Dark background (walls) */}
              <rect width={mazeSvgW} height={mazeSvgH} fill="#2d2d2d" />
              {/* Passage cells */}
              {mazeData.grid.map((row, r) =>
                row.map((cell, c) =>
                  cell.passage ? (
                    <rect
                      key={`${r}-${c}`}
                      x={c * cellSize + 1}
                      y={r * cellSize + 1}
                      width={cellSize - 2}
                      height={cellSize - 2}
                      rx={2}
                      fill="#f5f0e1"
                    />
                  ) : null
                )
              )}
              {/* Taxa markers + labels */}
              {taxaPlacements.map((p) => {
                const cx = (p.col + 0.5) * cellSize;
                const cy = (p.row + 0.5) * cellSize;
                const sp = taxaByOttId.get(p.node.ott_id);
                return (
                  <g key={p.node.ott_id ?? `${p.row}-${p.col}`}>
                    {sp?.image_url ? (
                      <image
                        href={sp.image_url}
                        x={cx - 8}
                        y={cy - 8}
                        width={16}
                        height={16}
                        clipPath="inset(0 round 3px)"
                      />
                    ) : (
                      <circle cx={cx} cy={cy} r={5} fill="#e07020" />
                    )}
                    <text
                      x={cx + 12}
                      y={cy}
                      dominantBaseline="central"
                      className="maze-label"
                    >
                      {p.node.name}
                    </text>
                  </g>
                );
              })}
            </svg>
          </div>
        </div>
      </div>
    );
  }

  // ---- Normal tree view ----
  return (
    <div className="subtree-overlay">
      <div className="subtree-panel">
        <div className="subtree-header">
          <h3>Subtree</h3>
          <div className="subtree-header-actions">
            <button
              className="subtree-copy-btn"
              onClick={handleCopy}
              title="Copy OTT IDs to clipboard"
            >
              {copied ? "✓ Copied!" : "📋 Copy OTT IDs"}
            </button>
            <button
              className="subtree-copy-btn"
              onClick={handleCopyJson}
              title="Copy subtree JSON to clipboard"
            >
              {copiedJson ? "✓ Copied!" : "📋 Copy JSON"}
            </button>
            <button
              className="subtree-copy-btn"
              onClick={() => setShowMaze(true)}
              title="Show tree as a grid maze"
            >
              🔲 Maze
            </button>
            <button className="subtree-close" aria-label="Close subtree view" onClick={onClose}>✕</button>
          </div>
        </div>
        <div className="subtree-content">
          <svg
            className="subtree-svg"
            width={svgWidth}
            height={svgHeight + 10}
            viewBox={`-4 -${layout.vSpacing / 2} ${svgWidth + 8} ${svgHeight + layout.vSpacing}`}
          >
            {/* Edges */}
            {layout.edges.map((e, i) => (
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
            {/* Taxa labels (leaves and internal taxa) */}
            {taxaNodes.map((l) => {
              const sp = taxaByOttId.get(l.node.ott_id);
              const starX = l.x + labelOffset + (sp?.image_url ? imgSize + 4 : 0) + l.node.name.length * pxPerChar + 4;
              return (
                <g key={l.node.ott_id ?? l.node.name}>
                  {sp?.image_url && (
                    <image
                      href={sp.image_url}
                      x={l.x + labelOffset}
                      y={l.y - imgSize / 2}
                      width={imgSize}
                      height={imgSize}
                      clipPath="inset(0 round 4px)"
                    />
                  )}
                  <text
                    x={l.x + labelOffset + (sp?.image_url ? imgSize + 4 : 0)}
                    y={l.y}
                    dominantBaseline="central"
                    className="subtree-leaf-label"
                  >
                    {l.node.name}
                  </text>
                  {sp?.comments && (
                    <text
                      x={starX}
                      y={l.y}
                      dominantBaseline="central"
                      className="subtree-comment-star"
                      onClick={() => setActiveComment(activeComment === l.node.ott_id ? null : l.node.ott_id)}
                      style={{ cursor: "pointer" }}
                    >
                      ★
                    </text>
                  )}
                </g>
              );
            })}
          </svg>
          {activeCommentData?.comments && (
            <div className="subtree-comment-modal-overlay" onClick={() => setActiveComment(null)}>
              <div className="subtree-comment-modal" onClick={(e) => e.stopPropagation()}>
                <h4>{activeCommentData.name}</h4>
                <p>{activeCommentData.comments}</p>
                <button onClick={() => setActiveComment(null)}>Close</button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Error console – captures console.error/warn and shows them in a floating
// red overlay so mobile users can see what's going wrong.
// ---------------------------------------------------------------------------

function ErrorConsole() {
  const [messages, setMessages] = useState([]);
  const nextId = useRef(0);

  useEffect(() => {
    const origError = console.error;
    const origWarn = console.warn;

    function push(level, args) {
      const text = Array.from(args)
        .map((a) => {
          if (typeof a === "string") return a;
          try { return JSON.stringify(a); } catch { return String(a); }
        })
        .join(" ");
      const id = nextId.current++;
      // Keep at most 20 messages
      setMessages((prev) => [...prev.slice(-19), { id, level, text }]);
    }

    console.error = function (...args) {
      origError.apply(console, args);
      push("error", args);
    };
    console.warn = function (...args) {
      origWarn.apply(console, args);
      push("warn", args);
    };

    function onError(e) {
      push("error", [e.message || String(e)]);
    }
    function onRejection(e) {
      push("error", ["Unhandled: " + (e.reason?.message || String(e.reason))]);
    }
    window.addEventListener("error", onError);
    window.addEventListener("unhandledrejection", onRejection);

    return () => {
      console.error = origError;
      console.warn = origWarn;
      window.removeEventListener("error", onError);
      window.removeEventListener("unhandledrejection", onRejection);
    };
  }, []);

  function dismiss(id) {
    setMessages((prev) => prev.filter((m) => m.id !== id));
  }

  if (messages.length === 0) return null;

  return (
    <div className="error-console">
      <div className="error-console-header">
        <span>⚠ Console</span>
        <button onClick={() => setMessages([])}>Clear</button>
      </div>
      <div className="error-console-body">
        {messages.map((m) => (
          <div key={m.id} className={`error-console-msg error-console-${m.level}`}>
            <span className="error-console-text">{m.text}</span>
            <button className="error-console-dismiss" onClick={() => dismiss(m.id)}>✕</button>
          </div>
        ))}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main App
// ---------------------------------------------------------------------------

function App() {
  const trie = useMemo(() => buildTrie(taxa), []);

  // Central list state
  const [listInput, setListInput] = useState("");
  const [selectedOrganisms, setSelectedOrganisms] = useState(new Set());

  // Display state
  const [showIncluded, setShowIncluded] = useState(true);
  const [showOutside, setShowOutside] = useState(true);
  const [inGroupLimit, setInGroupLimit] = useState(INGROUP_PAGE_SIZE);
  const [outsideLimit, setOutsideLimit] = useState(OUTSIDE_PAGE_SIZE);
  const [showSubtree, setShowSubtree] = useState(false);
  const [showImport, setShowImport] = useState(false);
  const [importText, setImportText] = useState("");
  const [importError, setImportError] = useState("");

  // Compute OTT IDs from the list
  const listOttIds = useMemo(() => {
    const ids = [];
    for (const name of selectedOrganisms) {
      const sp = taxaByName.get(name);
      if (sp) ids.push(sp.ott_id);
    }
    return ids;
  }, [selectedOrganisms]);

  // Compute MRCA from the list (needs 2+)
  const mrcaNode = useMemo(() => {
    if (listOttIds.length < 2) return null;
    return findMRCAMultiple(tree, listOttIds);
  }, [listOttIds]);

  // In-group: all taxa under the MRCA
  const cladeSpecies = useMemo(() => {
    if (!mrcaNode) return [];
    return getTaxa(mrcaNode);
  }, [mrcaNode]);

  // Outside species sorted by distance from MRCA
  const outsideSpecies = useMemo(() => {
    if (!mrcaNode || !cladeSpecies.length) return [];

    const cladeSet = new Set(cladeSpecies);
    const pathToMRCA = findNodePath(tree, mrcaNode);
    if (!pathToMRCA) return [];
    const mrcaIdx = pathToMRCA.length - 1;

    const results = [];
    for (const sp of taxa) {
      if (cladeSet.has(sp.name)) continue;

      const pathToSpecies = findPath(tree, sp.ott_id);
      if (!pathToSpecies) continue;

      // Find where the paths diverge
      let divergeIdx = 0;
      for (let i = 0; i < Math.min(pathToMRCA.length, pathToSpecies.length); i++) {
        if (pathToMRCA[i] === pathToSpecies[i]) divergeIdx = i;
        else break;
      }

      const height = mrcaIdx - divergeIdx;
      results.push({ name: sp.name, ott_id: sp.ott_id, height });
    }

    results.sort((a, b) => a.height - b.height);
    return results;
  }, [mrcaNode, cladeSpecies]);

  // Build subtree from selected organisms
  const subtree = useMemo(() => {
    if (!showSubtree || selectedOrganisms.size < 2) return null;
    const ottIds = new Set();
    for (const name of selectedOrganisms) {
      const sp = taxaByName.get(name);
      if (sp) ottIds.add(sp.ott_id);
    }
    if (ottIds.size < 2) return null;
    return extractSubtree(tree, ottIds);
  }, [showSubtree, selectedOrganisms]);

  function addToList(sp) {
    setSelectedOrganisms((prev) => {
      const next = new Set(prev);
      next.add(sp.name);
      return next;
    });
    setListInput("");
    setInGroupLimit(INGROUP_PAGE_SIZE);
    setOutsideLimit(OUTSIDE_PAGE_SIZE);
  }

  function removeFromList(name) {
    setSelectedOrganisms((prev) => {
      const next = new Set(prev);
      next.delete(name);
      return next;
    });
    setInGroupLimit(INGROUP_PAGE_SIZE);
    setOutsideLimit(OUTSIDE_PAGE_SIZE);
  }

  function toggleOrganism(name) {
    setSelectedOrganisms((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
    setInGroupLimit(INGROUP_PAGE_SIZE);
    setOutsideLimit(OUTSIDE_PAGE_SIZE);
  }

  function handleImportTree() {
    const ids = importText
      .split(/[\s,]+/)
      .map((s) => parseInt(s.trim(), 10))
      .filter((n) => !isNaN(n) && n > 0);
    if (ids.length < 2) {
      setImportError("Please enter at least 2 valid OTT IDs.");
      return;
    }
    // Match OTT IDs to taxa names
    const names = new Set();
    for (const id of ids) {
      const sp = taxaByOttId.get(id);
      if (sp) names.add(sp.name);
    }
    if (names.size < 2) {
      setImportError(`Only ${names.size} of the entered OTT IDs matched known organisms. Need at least 2.`);
      return;
    }
    setImportError("");
    setSelectedOrganisms(names);
    setShowSubtree(true);
    setShowImport(false);
    setImportText("");
  }

  function handleClearList() {
    setSelectedOrganisms(new Set());
    setShowSubtree(false);
    setListInput("");
  }

  return (
    <div className="app">
      <h1>🐱🐰🚂 Cat Bunny Railroad</h1>
      <p className="subtitle">
        Build a list of living things and discover what they have in common!
      </p>

      {/* List management section */}
      <div className="list-section">
        <div className="list-header">
          <h2>{selectedOrganisms.size === 0 ? "Start your list" : `Your list (${selectedOrganisms.size})`}</h2>
          <div className="list-header-actions">
            <button
              className="import-btn"
              onClick={() => setShowImport(true)}
            >
              📥 Import OTT IDs
            </button>
            {selectedOrganisms.size > 0 && (
              <button className="clear-selection-btn" onClick={handleClearList}>
                Clear list
              </button>
            )}
          </div>
        </div>

        <Autocomplete
          label="Add an organism"
          value={listInput}
          onChange={setListInput}
          onSelect={addToList}
          trie={trie}
          selectedItem={null}
        />

        {selectedOrganisms.size > 0 && (
          <div className="list-chips">
            {[...selectedOrganisms].map((name) => {
              const data = taxaByName.get(name);
              return (
                <span key={name} className="list-chip">
                  {data?.image_url && (
                    <img src={data.image_url} alt="" className="chip-img" />
                  )}
                  {name}
                  <button
                    className="chip-remove"
                    onClick={() => removeFromList(name)}
                    aria-label={`Remove ${name}`}
                  >✕</button>
                </span>
              );
            })}
          </div>
        )}

        {selectedOrganisms.size >= 2 && (
          <div className="list-actions">
            <button
              className="make-tree-btn"
              onClick={() => setShowSubtree(true)}
            >
              🌳 Make tree ({selectedOrganisms.size} selected)
            </button>
          </div>
        )}
      </div>

      {showImport && (
        <div className="subtree-overlay">
          <div className="subtree-panel import-panel">
            <div className="subtree-header">
              <h3>Import tree from OTT IDs</h3>
              <button className="subtree-close" aria-label="Close" onClick={() => setShowImport(false)}>✕</button>
            </div>
            <div className="subtree-content import-content">
              <p className="import-hint">
                Paste a comma-separated list of OTT IDs (e.g. copied from another tree):
              </p>
              <textarea
                className="import-textarea"
                value={importText}
                onChange={(e) => { setImportText(e.target.value); setImportError(""); }}
                placeholder="563166,247341,864596"
                rows={4}
              />
              {importError && <p className="import-error">{importError}</p>}
              <button
                className="make-tree-btn import-go-btn"
                onClick={handleImportTree}
                disabled={
                  importText
                    .split(/[\s,]+/)
                    .filter((s) => /^\d+$/.test(s.trim())).length < 2
                }
              >
                🌳 Build tree
              </button>
            </div>
          </div>
        </div>
      )}

      {showSubtree && subtree && (
        <SubtreeView subtree={subtree} onClose={() => setShowSubtree(false)} />
      )}

      {/* MRCA results */}
      {mrcaNode && (
        <div className="results">
          <h2>Common ancestor group</h2>
          <p className="clade-info">
            Your {selectedOrganisms.size} organisms share a common ancestor
            {" "}({cladeSpecies.length} organisms in this group).
          </p>

          <div className="collapsible-section">
            <button
              className="collapsible-toggle"
              onClick={() => setShowIncluded(!showIncluded)}
            >
              <span className="toggle-arrow">{showIncluded ? "▼" : "▶"}</span>
              Organisms in this group ({cladeSpecies.length})
            </button>
            {showIncluded && (
              <>
                <ul className="species-list">
                  {cladeSpecies.slice(0, inGroupLimit).map((name) => {
                    const data = taxaByName.get(name);
                    const isSelected = selectedOrganisms.has(name);
                    return (
                      <li
                        key={name}
                        className={`species-card ${isSelected ? "selected" : ""}`}
                        onClick={() => toggleOrganism(name)}
                        tabIndex={0}
                        onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); toggleOrganism(name); } }}
                      >
                        <input
                          type="checkbox"
                          className="species-checkbox"
                          checked={isSelected}
                          onChange={() => toggleOrganism(name)}
                          onClick={(e) => e.stopPropagation()}
                        />
                        {data?.image_url ? (
                          <img
                            className="species-img"
                            src={data.image_url}
                            alt={name}
                            loading="lazy"
                          />
                        ) : (
                          <div className="species-img placeholder">?</div>
                        )}
                        <span className="species-name">{name}</span>
                        {data?.comments && (
                          <span
                            className="comment-star-inline"
                            title={data.comments}
                          >★</span>
                        )}
                      </li>
                    );
                  })}
                </ul>
                {inGroupLimit < cladeSpecies.length && (
                  <div className="show-more-container">
                    <button
                      className="show-more-btn"
                      onClick={() => setInGroupLimit((l) => l + INGROUP_PAGE_SIZE)}
                    >
                      Show more ({Math.min(INGROUP_PAGE_SIZE, cladeSpecies.length - inGroupLimit)} more)
                    </button>
                  </div>
                )}
              </>
            )}
          </div>

          <div className="collapsible-section">
            <button
              className="collapsible-toggle"
              onClick={() => setShowOutside(!showOutside)}
            >
              <span className="toggle-arrow">{showOutside ? "▼" : "▶"}</span>
              Nearest relatives outside this group ({outsideSpecies.length})
            </button>
            {showOutside && (
              <>
                <ul className="species-list">
                  {outsideSpecies.slice(0, outsideLimit).map((sp) => {
                    const isSelected = selectedOrganisms.has(sp.name);
                    return (
                      <li
                        key={sp.ott_id}
                        className={`species-card ${isSelected ? "selected" : ""}`}
                        onClick={() => toggleOrganism(sp.name)}
                        tabIndex={0}
                        onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); toggleOrganism(sp.name); } }}
                      >
                        <input
                          type="checkbox"
                          className="species-checkbox"
                          checked={isSelected}
                          onChange={() => toggleOrganism(sp.name)}
                          onClick={(e) => e.stopPropagation()}
                        />
                        {taxaByName.get(sp.name)?.image_url ? (
                          <img
                            className="species-img"
                            src={taxaByName.get(sp.name).image_url}
                            alt={sp.name}
                            loading="lazy"
                          />
                        ) : (
                          <div className="species-img placeholder">?</div>
                        )}
                        <span className="species-name">{sp.name}</span>
                        <span className="distance-label">
                          ↑{sp.height} {sp.height === 1 ? "level" : "levels"} up
                        </span>
                      </li>
                    );
                  })}
                </ul>
                {outsideLimit < outsideSpecies.length && (
                  <div className="show-more-container">
                    <button
                      className="show-more-btn"
                      onClick={() => setOutsideLimit((l) => l + OUTSIDE_PAGE_SIZE)}
                    >
                      Show more ({Math.min(OUTSIDE_PAGE_SIZE, outsideSpecies.length - outsideLimit)} more)
                    </button>
                  </div>
                )}
              </>
            )}
          </div>
        </div>
      )}


      <ErrorConsole />
    </div>
  );
}

export default App;
