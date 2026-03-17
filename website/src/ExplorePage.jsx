import { useMemo, useState } from "react";
import { useParams, useNavigate, Link } from "react-router-dom";
import taxa from "./data/taxa.json";
import tree from "./data/tree.json";
import { capitalize } from "./treeUtils.js";
import { buildTrie } from "./trieUtils.js";
import Autocomplete from "./Autocomplete.jsx";
import "./ExplorePage.css";

// ---------------------------------------------------------------------------
// Data lookups (module-level, computed once)
// ---------------------------------------------------------------------------

const taxaByOttId = new Map(taxa.map((t) => [t.ott_id, t]));

/** Find a node in the tree by ott_id */
function findNodeByOttId(node, ottId) {
  if (node.ott_id === ottId) return node;
  for (const child of node.children) {
    const result = findNodeByOttId(child, ottId);
    if (result) return result;
  }
  return null;
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

/** Collect all curated taxa (from taxa.json) that are descendants of a tree node */
function collectDescendantTaxa(node) {
  let results = [];
  if (taxaByOttId.has(node.ott_id)) results.push(taxaByOttId.get(node.ott_id));
  for (const child of node.children) {
    results = results.concat(collectDescendantTaxa(child));
  }
  return results;
}

/** Check if a node name is a meaningful name (not an auto-generated mrca label) */
function isMeaningfulName(name) {
  return name && !name.startsWith("mrca");
}

/** Find the MRCA node for two ott_ids */
function findMRCA(treeRoot, ottId1, ottId2) {
  const path1 = findPath(treeRoot, ottId1);
  const path2 = findPath(treeRoot, ottId2);
  if (!path1 || !path2) return null;

  let mrca = treeRoot;
  const minLen = Math.min(path1.length, path2.length);
  for (let i = 0; i < minLen; i++) {
    if (path1[i] === path2[i]) mrca = path1[i];
    else break;
  }
  return mrca;
}

/** Collect all curated taxa ott_ids under a tree node */
function collectDescendantOttIds(node) {
  let ids = [];
  if (taxaByOttId.has(node.ott_id)) ids.push(node.ott_id);
  for (const child of node.children) {
    ids = ids.concat(collectDescendantOttIds(child));
  }
  return ids;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const PAGE_SIZE = 24;

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function ExplorePage() {
  const { ottId: ottIdParam } = useParams();
  const navigate = useNavigate();
  const ottId = Number(ottIdParam);

  const [descendantLimit, setDescendantLimit] = useState(PAGE_SIZE);
  const [outsideLimit, setOutsideLimit] = useState(PAGE_SIZE);
  const [searchInput, setSearchInput] = useState("");

  // Trie for autocomplete search
  const trie = useMemo(() => buildTrie(taxa), []);

  // Reset pagination and search when taxon changes
  const [prevOttId, setPrevOttId] = useState(ottId);
  if (ottId !== prevOttId) {
    setPrevOttId(ottId);
    setDescendantLimit(PAGE_SIZE);
    setOutsideLimit(PAGE_SIZE);
    setSearchInput("");
  }

  // Current node in the tree
  const currentNode = useMemo(() => findNodeByOttId(tree, ottId), [ottId]);

  // Taxa.json entry for the current node (if curated)
  const currentTaxon = useMemo(
    () => taxaByOttId.get(ottId) || null,
    [ottId]
  );

  // Path from root to current node (for breadcrumb ancestry)
  const pathFromRoot = useMemo(() => {
    if (!currentNode) return [];
    return findPath(tree, ottId) || [];
  }, [currentNode, ottId]);

  // Named ancestors along the path (for breadcrumb display)
  const namedAncestors = useMemo(() => {
    // Exclude the current node itself; only show ancestors above
    return pathFromRoot
      .slice(0, -1)
      .filter((n) => isMeaningfulName(n.name))
      .map((n) => ({
        node: n,
        taxon: taxaByOttId.get(n.ott_id) || null,
        name: taxaByOttId.get(n.ott_id)?.name || n.name,
        ott_id: n.ott_id,
      }));
  }, [pathFromRoot]);

  // Descendant curated taxa (excluding self)
  const descendants = useMemo(() => {
    if (!currentNode) return [];
    const all = collectDescendantTaxa(currentNode);
    // Exclude the current taxon itself from descendants list
    return all.filter((t) => t.ott_id !== ottId);
  }, [currentNode, ottId]);

  // Is this a "leaf" in terms of curated descendants?
  const isLeaf = descendants.length === 0;

  // Outside species sorted by distance (how high up you have to go)
  const outsideSpecies = useMemo(() => {
    if (!currentNode) return [];

    const pathToNode = findPath(tree, ottId);
    if (!pathToNode) return [];
    const nodeIdx = pathToNode.length - 1;

    // Collect the set of all descendant ott_ids (including self)
    const descendantSet = new Set(
      collectDescendantTaxa(currentNode).map((t) => t.ott_id)
    );
    if (currentTaxon) descendantSet.add(ottId);

    const results = [];
    for (const sp of taxa) {
      if (descendantSet.has(sp.ott_id)) continue;

      const pathToSpecies = findPath(tree, sp.ott_id);
      if (!pathToSpecies) continue;

      // Find where the paths diverge
      let divergeIdx = 0;
      for (
        let i = 0;
        i < Math.min(pathToNode.length, pathToSpecies.length);
        i++
      ) {
        if (pathToNode[i] === pathToSpecies[i]) divergeIdx = i;
        else break;
      }

      const height = nodeIdx - divergeIdx;
      results.push({ ...sp, height });
    }

    results.sort((a, b) => a.height - b.height);
    return results;
  }, [currentNode, ottId, currentTaxon]);

  // Navigation helper
  function goTo(newOttId) {
    navigate(`/explore/${newOttId}`);
  }

  /** Compare: find MRCA of central taxon and another, then go to main page with all descendants */
  function handleCompare(otherOttId) {
    const mrca = findMRCA(tree, ottId, otherOttId);
    if (!mrca) return;

    // If the MRCA has an ott_id, use ?clade= (compact & stable)
    if (mrca.ott_id !== null && mrca.ott_id !== undefined) {
      navigate(`/?clade=${mrca.ott_id}`);
    } else {
      // Fallback: list all descendant taxa OTT IDs
      const ids = collectDescendantOttIds(mrca);
      navigate(`/?taxa=${ids.join(",")}`);
    }
  }

  // Build display name for current node
  const displayName = currentTaxon
    ? currentTaxon.name
    : currentNode?.name || "Unknown";

  if (!currentNode) {
    return (
      <div className="explore-page">
        <nav className="explore-nav">
          <Link to="/" className="explore-home-link">
            ← Cat Bunny Railroad
          </Link>
        </nav>
        <div className="explore-empty">
          <h1>Taxon not found</h1>
          <p>No taxon with OTT ID {ottId} exists in the tree.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="explore-page">
      {/* Top nav + search bar */}
      <nav className="explore-nav">
        <Link to="/" className="explore-home-link">
          ← Cat Bunny Railroad
        </Link>
        <div className="explore-search">
          <Autocomplete
            label="Search organisms"
            value={searchInput}
            onChange={setSearchInput}
            onSelect={(sp) => {
              setSearchInput("");
              goTo(sp.ott_id);
            }}
            trie={trie}
            selectedItem={null}
          />
        </div>
      </nav>

      {/* Breadcrumb ancestry */}
      {namedAncestors.length > 0 && (
        <div className="explore-breadcrumbs">
          {namedAncestors.map((a, i) => (
            <span key={a.ott_id}>
              {a.ott_id !== null && a.ott_id !== undefined ? (
                <button
                  className="breadcrumb-link"
                  onClick={() => goTo(a.ott_id)}
                  title={
                    a.taxon?.uniqname
                      ? `${capitalize(a.name)} (${a.taxon.uniqname})`
                      : capitalize(a.name)
                  }
                >
                  {capitalize(a.name)}
                </button>
              ) : (
                <span className="breadcrumb-text">{capitalize(a.name)}</span>
              )}
              {i < namedAncestors.length - 1 && (
                <span className="breadcrumb-sep"> › </span>
              )}
            </span>
          ))}
        </div>
      )}

      {/* Central taxon display */}
      <header className="explore-hero">
        {currentTaxon?.image_url && (
          <img
            className="explore-hero-img"
            src={currentTaxon.image_url}
            alt={displayName}
          />
        )}
        <div className="explore-hero-info">
          <h1 className="explore-hero-name">{capitalize(displayName)}</h1>
          {currentTaxon?.uniqname && (
            <p className="explore-hero-sci">{currentTaxon.uniqname}</p>
          )}
          {!currentTaxon && currentNode.name && (
            <p className="explore-hero-sci">
              {currentNode.name}
            </p>
          )}
          {!isLeaf && (
            <p className="explore-hero-count">
              {descendants.length} organism{descendants.length !== 1 ? "s" : ""}{" "}
              in this group
            </p>
          )}
        </div>
      </header>

      {/* Descendants section */}
      {!isLeaf && (
        <section className="explore-section">
          <h2 className="explore-section-title">
            Organisms in this group
          </h2>
          <ul className="explore-grid">
            {descendants.slice(0, descendantLimit).map((sp) => (
              <li
                key={sp.ott_id}
                className="explore-card"
                onClick={() => goTo(sp.ott_id)}
                role="button"
                tabIndex={0}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") goTo(sp.ott_id);
                }}
              >
                {sp.image_url ? (
                  <img
                    className="explore-card-img"
                    src={sp.image_url}
                    alt={sp.name}
                    loading="lazy"
                  />
                ) : (
                  <div className="explore-card-img placeholder">?</div>
                )}
                <span className="explore-card-name">
                  {capitalize(sp.name)}
                </span>
              </li>
            ))}
          </ul>
          {descendantLimit < descendants.length && (
            <div className="explore-show-more">
              <button
                className="show-more-btn"
                onClick={() => setDescendantLimit((l) => l + PAGE_SIZE)}
              >
                Show more ({Math.min(PAGE_SIZE, descendants.length - descendantLimit)} more)
              </button>
            </div>
          )}
        </section>
      )}

      {/* Outside species section */}
      {outsideSpecies.length > 0 && (
        <section className="explore-section">
          <h2 className="explore-section-title">
            Nearest relatives outside this group
          </h2>
          <ul className="explore-list">
            {outsideSpecies.slice(0, outsideLimit).map((sp) => (
              <li
                key={sp.ott_id}
                className="explore-list-item"
                onClick={() => goTo(sp.ott_id)}
                role="button"
                tabIndex={0}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") goTo(sp.ott_id);
                }}
              >
                {sp.image_url ? (
                  <img
                    className="explore-list-img"
                    src={sp.image_url}
                    alt={sp.name}
                    loading="lazy"
                  />
                ) : (
                  <div className="explore-list-img placeholder">?</div>
                )}
                <span className="explore-list-name">
                  {capitalize(sp.name)}
                </span>
                <span className="explore-list-distance">
                  ↑{sp.height} {sp.height === 1 ? "level" : "levels"} up
                </span>
                <button
                  className="explore-compare-btn"
                  onClick={(e) => {
                    e.stopPropagation();
                    handleCompare(sp.ott_id);
                  }}
                  title={`Compare ${capitalize(displayName)} & ${capitalize(sp.name)} – view their common ancestor group`}
                  aria-label={`Compare with ${capitalize(sp.name)}`}
                >
                  🌳
                </button>
              </li>
            ))}
          </ul>
          {outsideLimit < outsideSpecies.length && (
            <div className="explore-show-more">
              <button
                className="show-more-btn"
                onClick={() => setOutsideLimit((l) => l + PAGE_SIZE)}
              >
                Show more ({Math.min(PAGE_SIZE, outsideSpecies.length - outsideLimit)} more)
              </button>
            </div>
          )}
        </section>
      )}
    </div>
  );
}
