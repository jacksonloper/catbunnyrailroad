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
  const [cladeName, setCladeName] = useState("");

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
    setCladeName(mrca.name || "their common ancestor");
  }

  function handleReset() {
    setInputA("");
    setInputB("");
    setSelectedA(null);
    setSelectedB(null);
    setCladeSpecies(null);
    setCladeName("");
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
            Their most recent common ancestor is in the group{" "}
            <strong>{cladeName}</strong>. All {cladeSpecies.length} organisms in
            that group:
          </p>
          <ul className="species-list">
            {cladeSpecies.map((name) => (
              <SpeciesCard key={name} sp={name} />
            ))}
          </ul>
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
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

export default App;
