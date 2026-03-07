import { useState, useMemo, useRef, useEffect } from "react";
import species from "./data/species.json";
import tree from "./data/tree.json";
import "./App.css";

// ---------------------------------------------------------------------------
// Tree utilities – work with the compact tree JSON
// ---------------------------------------------------------------------------

/** Collect all leaf names under a tree node */
function getLeaves(node) {
  if (node.children.length === 0) return [node.name];
  return node.children.flatMap(getLeaves);
}

/** Find the path from root to a leaf with the given ott_id */
function findPath(node, ottId, path = []) {
  const current = [...path, node];
  if (node.ott_id === ottId && node.children.length === 0) return current;
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

/** Find the MRCA node for two species (by ott_id) */
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

// Build a lookup map for species data by name
const speciesByName = new Map(species.map((s) => [s.name, s]));

const OUTSIDE_PAGE_SIZE = 20;

function SpeciesCard({ sp }) {
  const speciesData = speciesByName.get(sp);
  return (
    <li className="species-card">
      {speciesData?.image_url ? (
        <img
          className="species-img"
          src={speciesData.image_url}
          alt={sp}
          loading="lazy"
        />
      ) : (
        <div className="species-img placeholder">?</div>
      )}
      <span className="species-name">{sp}</span>
      {speciesData?.broken && (
        <span
          className="broken-badge"
          title={`Approximate placement: ${sp} is not monophyletic in the synthetic tree${speciesData.mrca_name ? `. Placed at ${speciesData.mrca_name}` : ""}`}
        >
          ≈ {speciesData.mrca_name || "approx."}
        </span>
      )}
    </li>
  );
}

function App() {
  const trie = useMemo(() => buildTrie(species), []);

  const [inputA, setInputA] = useState("");
  const [inputB, setInputB] = useState("");
  const [selectedA, setSelectedA] = useState(null);
  const [selectedB, setSelectedB] = useState(null);
  const [cladeSpecies, setCladeSpecies] = useState(null);
  const [mrcaNode, setMrcaNode] = useState(null);
  const [showIncluded, setShowIncluded] = useState(false);
  const [showOutside, setShowOutside] = useState(false);
  const [outsideLimit, setOutsideLimit] = useState(OUTSIDE_PAGE_SIZE);

  // Compute in-clade species with distances to A and B, sorted from A to B
  const enrichedCladeSpecies = useMemo(() => {
    if (!cladeSpecies || !selectedA || !selectedB) return [];

    const pathA = findPath(tree, selectedA.ott_id);
    const pathB = findPath(tree, selectedB.ott_id);
    if (!pathA || !pathB) return [];

    return cladeSpecies
      .map((name) => {
        const sp = speciesByName.get(name);
        if (!sp) return null;

        const pathSp = findPath(tree, sp.ott_id);
        if (!pathSp) return null;

        let commonA = 0;
        for (let i = 0; i < Math.min(pathSp.length, pathA.length); i++) {
          if (pathSp[i] === pathA[i]) commonA = i;
          else break;
        }
        const levelA = pathSp.length - 1 - commonA;

        let commonB = 0;
        for (let i = 0; i < Math.min(pathSp.length, pathB.length); i++) {
          if (pathSp[i] === pathB[i]) commonB = i;
          else break;
        }
        const levelB = pathSp.length - 1 - commonB;

        return { name, levelA, levelB };
      })
      .filter(Boolean)
      .sort((a, b) => a.levelA - b.levelA || a.levelB - b.levelB);
  }, [cladeSpecies, selectedA, selectedB]);

  // Compute outside species with distances from the clade
  const outsideSpecies = useMemo(() => {
    if (!mrcaNode || !cladeSpecies) return [];

    const cladeSet = new Set(cladeSpecies);
    const pathToMRCA = findNodePath(tree, mrcaNode);
    if (!pathToMRCA) return [];
    const mrcaIdx = pathToMRCA.length - 1;

    const results = [];
    for (const sp of species) {
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
  }

  function handleInputBChange(val) {
    setInputB(val);
    if (selectedB && val !== selectedB.name) setSelectedB(null);
    setCladeSpecies(null);
  }

  function handleSubmit(e) {
    e.preventDefault();
    if (!selectedA || !selectedB) return;
    if (selectedA.ott_id === selectedB.ott_id) return;

    const mrca = findMRCA(tree, selectedA.ott_id, selectedB.ott_id);
    if (!mrca) return;

    const leaves = getLeaves(mrca);
    setCladeSpecies(leaves);
    setMrcaNode(mrca);
    setShowIncluded(false);
    setShowOutside(false);
    setOutsideLimit(OUTSIDE_PAGE_SIZE);
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
  }

  return (
    <div className="app">
      <h1>🐱🐰🚂 Cat Bunny Railroad</h1>
      <p className="subtitle">
        Pick two living things and discover what they have in common!
      </p>

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
              Animals in this group ({cladeSpecies.length})
            </button>
            {showIncluded && (
              <ul className="species-list">
                {enrichedCladeSpecies.map((sp) => {
                  const data = speciesByName.get(sp.name);
                  return (
                    <li key={sp.name} className="species-card">
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
                  {outsideSpecies.slice(0, outsideLimit).map((sp) => (
                    <li key={sp.ott_id} className="species-card">
                      {speciesByName.get(sp.name)?.image_url ? (
                        <img
                          className="species-img"
                          src={speciesByName.get(sp.name).image_url}
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
                  ))}
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
            {species.map((sp) => (
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
    </div>
  );
}

export default App;
