import { useState, useMemo, useRef, useEffect } from "react";
import taxa from "./data/taxa.json";
import tree from "./data/tree.json";
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

/** Find the MRCA node for two taxa (by ott_id) */
function findMRCA(treeRoot, ottA, ottB) {
  const pathA = findPath(treeRoot, ottA);
  const pathB = findPath(treeRoot, ottB);
  if (!pathA || !pathB) return null;

  let mrca = treeRoot;
  for (let i = 0; i < Math.min(pathA.length, pathB.length); i++) {
    if (pathA[i] === pathB[i]) mrca = pathA[i];
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
    let node = root;
    for (const ch of item.name.toLowerCase()) {
      if (!node.children[ch]) node.children[ch] = new TrieNode();
      node = node.children[ch];
      node.items.push(item);
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

function SpeciesCard({ sp }) {
  const taxonData = taxaByName.get(sp);
  return (
    <li className="species-card">
      {taxonData?.image_url ? (
        <img
          className="species-img"
          src={taxonData.image_url}
          alt={sp}
          loading="lazy"
        />
      ) : (
        <div className="species-img placeholder">?</div>
      )}
      <span className="species-name">{sp}</span>
      {taxonData?.broken && (
        <span
          className="broken-badge"
          title={`Approximate placement: ${sp} is not monophyletic in the synthetic tree${taxonData.mrca_name ? `. Placed at ${taxonData.mrca_name}` : ""}`}
        >
          ≈ {taxonData.mrca_name || "approx."}
        </span>
      )}
    </li>
  );
}

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
 * Leaves get sequential y positions; internal node y = average of children.
 */
function layoutTree(root) {
  const depth = maxDepth(root);
  const hSpacing = 32; // horizontal pixels per depth level
  const vSpacing = 28; // vertical pixels per leaf row
  const nodes = [];
  const edges = [];
  let leafIndex = 0;

  function walk(node, d) {
    if (node.children.length === 0) {
      // Leaf
      const x = d * hSpacing;
      const y = leafIndex * vSpacing;
      leafIndex++;
      nodes.push({ x, y, node, isLeaf: true });
      return y;
    }
    // Internal node
    const childYs = node.children.map((c) => walk(c, d + 1));
    const y = childYs.reduce((a, b) => a + b, 0) / childYs.length;
    const x = d * hSpacing;
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

    // Vertical line at parent x
    const ys = validChildren.map((c) => c.y);
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

  return { nodes, edges, leafCount: leafIndex, hSpacing, vSpacing, depth };
}

function SubtreeView({ subtree, onClose }) {
  const [copied, setCopied] = useState(false);

  const layout = useMemo(() => layoutTree(subtree), [subtree]);
  const taxaNodes = layout.nodes.filter((n) => n.isLeaf || n.node.isTaxon);
  const ottIds = useMemo(() => collectSubtreeOtts(subtree), [subtree]);

  const labelOffset = 8;
  const imgSize = 20;
  // Measure longest label to set SVG width
  const maxLabelLen = taxaNodes.length > 0 ? Math.max(...taxaNodes.map((l) => l.node.name.length)) : 0;
  const rightPad = maxLabelLen * 7 + imgSize + labelOffset + 20;
  const svgWidth = (layout.depth + 1) * layout.hSpacing + rightPad;
  const svgHeight = layout.leafCount * layout.vSpacing;

  function handleCopy() {
    const text = ottIds.join(",");
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }).catch(() => {
      // Fallback: select text from a temporary element
      const ta = document.createElement("textarea");
      ta.value = text;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand("copy");
      document.body.removeChild(ta);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }

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
                </g>
              );
            })}
          </svg>
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

  const [inputA, setInputA] = useState("");
  const [inputB, setInputB] = useState("");
  const [selectedA, setSelectedA] = useState(null);
  const [selectedB, setSelectedB] = useState(null);
  const [cladeSpecies, setCladeSpecies] = useState(null);
  const [mrcaNode, setMrcaNode] = useState(null);
  const [showIncluded, setShowIncluded] = useState(false);
  const [showOutside, setShowOutside] = useState(false);
  const [outsideLimit, setOutsideLimit] = useState(OUTSIDE_PAGE_SIZE);
  const [selectedOrganisms, setSelectedOrganisms] = useState(new Set());
  const [showSubtree, setShowSubtree] = useState(false);
  const [showImport, setShowImport] = useState(false);
  const [importText, setImportText] = useState("");
  const [importError, setImportError] = useState("");
  const [formError, setFormError] = useState("");

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

  function toggleOrganism(name) {
    setSelectedOrganisms((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
  }

  // Build subtree from selected organisms (+ the pair if in MRCA flow)
  const subtree = useMemo(() => {
    if (!showSubtree || selectedOrganisms.size === 0) return null;
    const ottIds = new Set();
    for (const name of selectedOrganisms) {
      const sp = taxaByName.get(name);
      if (sp) ottIds.add(sp.ott_id);
    }
    // Include the user-entered pair if in the find MRCA flow
    if (selectedA) ottIds.add(selectedA.ott_id);
    if (selectedB) ottIds.add(selectedB.ott_id);
    if (ottIds.size < 2) return null;
    return extractSubtree(tree, ottIds);
  }, [showSubtree, selectedOrganisms, selectedA, selectedB]);

  // Compute in-clade taxa with distances to A and B, sorted from A to B
  const enrichedCladeSpecies = useMemo(() => {
    if (!cladeSpecies || !selectedA || !selectedB) return [];

    const pathA = findPath(tree, selectedA.ott_id);
    const pathB = findPath(tree, selectedB.ott_id);
    if (!pathA || !pathB) return [];

    return cladeSpecies
      .map((name) => {
        const sp = taxaByName.get(name);
        if (!sp) return null;

        const pathSp = findPath(tree, sp.ott_id);
        if (!pathSp) return null;

        // depth of LCA(A, taxon) — bigger = more A-like
        let lcaDepthA = 0;
        for (let i = 0; i < Math.min(pathSp.length, pathA.length); i++) {
          if (pathSp[i] === pathA[i]) lcaDepthA = i;
          else break;
        }

        // depth of LCA(B, taxon) — bigger = more B-like
        let lcaDepthB = 0;
        for (let i = 0; i < Math.min(pathSp.length, pathB.length); i++) {
          if (pathSp[i] === pathB[i]) lcaDepthB = i;
          else break;
        }

        // Tree distance: edges up from taxon to LCA + edges down from LCA to target
        const levelA = (pathSp.length - 1 - lcaDepthA) + (pathA.length - 1 - lcaDepthA);
        const levelB = (pathSp.length - 1 - lcaDepthB) + (pathB.length - 1 - lcaDepthB);

        return { name, levelA, levelB, lcaDepthA, lcaDepthB };
      })
      .filter(Boolean)
      .sort((x, y) => {
        // Sort from A to B using LCA-depth comparison
        if (x.lcaDepthA !== y.lcaDepthA) return y.lcaDepthA - x.lcaDepthA; // A-like first
        if (x.lcaDepthB !== y.lcaDepthB) return x.lcaDepthB - y.lcaDepthB; // B-like later
        return 0;
      });
  }, [cladeSpecies, selectedA, selectedB]);

  // Compute outside taxa with distances from the clade
  const outsideSpecies = useMemo(() => {
    if (!mrcaNode || !cladeSpecies) return [];

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

  function handleSelectA(sp) {
    setSelectedA(sp);
    setInputA(sp.name);
  }

  function handleSelectB(sp) {
    setSelectedB(sp);
    setInputB(sp.name);
  }

  function handleInputAChange(val) {
    setInputA(val);
    if (selectedA && val !== selectedA.name) setSelectedA(null);
    setCladeSpecies(null);
    setFormError("");
  }

  function handleInputBChange(val) {
    setInputB(val);
    if (selectedB && val !== selectedB.name) setSelectedB(null);
    setCladeSpecies(null);
    setFormError("");
  }

  function handleSubmit(e) {
    e.preventDefault();
    setFormError("");
    if (!selectedA || !selectedB) {
      setFormError("Please select both organisms from the suggestions.");
      return;
    }
    if (selectedA.ott_id === selectedB.ott_id) {
      setFormError("Please pick two different organisms.");
      return;
    }

    try {
      const mrca = findMRCA(tree, selectedA.ott_id, selectedB.ott_id);
      if (!mrca) {
        setFormError(
          `Could not find the common ancestor of ${selectedA.name} and ${selectedB.name}. ` +
          "Please try different organisms."
        );
        return;
      }

      const leaves = getTaxa(mrca);
      setCladeSpecies(leaves);
      setMrcaNode(mrca);
      setShowIncluded(false);
      setShowOutside(false);
      setOutsideLimit(OUTSIDE_PAGE_SIZE);
    } catch (err) {
      console.error("handleSubmit error:", err);
      setFormError("Something went wrong: " + err.message);
    }
  }

  function handleReset() {
    setInputA("");
    setInputB("");
    setSelectedA(null);
    setSelectedB(null);
    setCladeSpecies(null);
    setMrcaNode(null);
    setShowIncluded(false);
    setShowOutside(false);
    setOutsideLimit(OUTSIDE_PAGE_SIZE);
    setSelectedOrganisms(new Set());
    setShowSubtree(false);
    setShowImport(false);
    setImportText("");
    setImportError("");
    setFormError("");
  }

  return (
    <div className="app">
      <h1>🐱🐰🚂 Cat Bunny Railroad</h1>
      <p className="subtitle">
        Pick two living things and discover what they have in common!
      </p>

      <div className="import-bar">
        <button
          className="import-btn"
          onClick={() => setShowImport(true)}
        >
          📥 Import tree from OTT IDs
        </button>
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

      {selectedOrganisms.size > 0 && (
        <div className="make-tree-bar">
          <button
            className="make-tree-btn"
            onClick={() => setShowSubtree(true)}
            disabled={selectedOrganisms.size + (selectedA ? 1 : 0) + (selectedB ? 1 : 0) < 2}
          >
            🌳 Make tree ({selectedOrganisms.size} selected)
          </button>
          <button
            className="clear-selection-btn"
            onClick={() => { setSelectedOrganisms(new Set()); setShowSubtree(false); }}
          >
            Clear selection
          </button>
        </div>
      )}

      {showSubtree && subtree && (
        <SubtreeView subtree={subtree} onClose={() => setShowSubtree(false)} />
      )}

      <form className="picker" onSubmit={handleSubmit}>
        <div className="picker-inputs">
          <Autocomplete
            label="First organism"
            value={inputA}
            onChange={handleInputAChange}
            onSelect={handleSelectA}
            trie={trie}
            selectedItem={selectedA}
          />
          <Autocomplete
            label="Second organism"
            value={inputB}
            onChange={handleInputBChange}
            onSelect={handleSelectB}
            trie={trie}
            selectedItem={selectedB}
          />
        </div>
        <div className="picker-buttons">
          <button
            type="submit"
            disabled={!selectedA || !selectedB || selectedA.ott_id === selectedB.ott_id}
          >
            Find their family!
          </button>
          <button type="button" className="reset-btn" onClick={handleReset}>
            Reset
          </button>
        </div>
        {formError && <p className="form-error">{formError}</p>}
      </form>

      {cladeSpecies && (
        <div className="results">
          <h2>
            The family of{" "}
            <strong>{selectedA.name}</strong> and{" "}
            <strong>{selectedB.name}</strong>
          </h2>
          <p className="clade-info">
            They belong to a group of {cladeSpecies.length} organisms.
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
              <ul className="species-list">
                {enrichedCladeSpecies.map((sp) => {
                  const data = taxaByName.get(sp.name);
                  const isSelected = selectedOrganisms.has(sp.name);
                  return (
                    <li
                      key={sp.name}
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
                      {data?.image_url ? (
                        <img
                          className="species-img"
                          src={data.image_url}
                          alt={sp.name}
                          loading="lazy"
                        />
                      ) : (
                        <div className="species-img placeholder">?</div>
                      )}
                      <span className="species-name">{sp.name}</span>
                      <span className="distance-label">
                        ↑{sp.levelA} to {selectedA.name}, ↑{sp.levelB} to {selectedB.name}
                      </span>
                      {data?.broken && (
                        <span
                          className="broken-badge"
                          title={`Approximate placement: ${sp.name} is not monophyletic in the synthetic tree${data.mrca_name ? `. Placed at ${data.mrca_name}` : ""}`}
                        >
                          ≈ {data.mrca_name || "approx."}
                        </span>
                      )}
                    </li>
                  );
                })}
              </ul>
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

      {!cladeSpecies && (
        <div className="all-species">
          <h2>All organisms</h2>
          <ul className="species-list">
            {taxa.map((sp) => (
              <li key={sp.ott_id} className="species-card">
                {sp.image_url ? (
                  <img
                    className="species-img"
                    src={sp.image_url}
                    alt={sp.name}
                    loading="lazy"
                  />
                ) : (
                  <div className="species-img placeholder">?</div>
                )}
                <span className="species-name">{sp.name}</span>
                {sp.broken && (
                  <span
                    className="broken-badge"
                    title={`Approximate placement: ${sp.name} is not monophyletic in the synthetic tree${sp.mrca_name ? `. Placed at ${sp.mrca_name}` : ""}`}
                  >
                    ≈ {sp.mrca_name || "approx."}
                  </span>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}
      <ErrorConsole />
    </div>
  );
}

export default App;
