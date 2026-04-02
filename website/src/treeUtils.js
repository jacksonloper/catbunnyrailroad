/**
 * Tree utilities – extracting subtrees and rendering them as ASCII art.
 *
 * These are pure functions with no React or DOM dependencies so they can be
 * tested without a browser environment.
 */

/** Capitalize the first letter of each word (mirrors CSS text-transform:capitalize) */
export function capitalize(str) {
  return str.replace(/\b\w/g, (ch) => ch.toUpperCase());
}

/**
 * Canonicalize a tree by sorting children at each internal node so that the
 * child whose subtree contains the alphabetically smallest leaf name comes
 * first.  This produces a unique, deterministic ordering for any given set
 * of leaves.
 *
 * Modifies the tree **in place** and returns the smallest leaf name found
 * in the subtree (used internally for the recursive sort key).
 */
export function canonicalizeTree(node) {
  if (!node.children || node.children.length === 0) return node.name;

  // Recursively canonicalize children and collect their sort keys
  const childKeys = node.children.map((child) => ({
    child,
    key: canonicalizeTree(child),
  }));

  // Sort children by their smallest leaf name
  childKeys.sort((a, b) => a.key.localeCompare(b.key));
  node.children = childKeys.map((k) => k.child);

  return childKeys[0].key;
}

/**
 * Extract an induced subtree containing only the specified ott_ids.
 * Keeps taxa nodes even if they are internal (have children).
 * Internal nodes with a single child are collapsed (unless they are taxa).
 */
export function extractSubtree(node, ottIdSet) {
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
  // Sort children canonically by smallest leaf name in each subtree
  canonicalizeTree({ children: keptChildren });
  const result = { name: node.name, ott_id: node.ott_id, children: keptChildren };
  if (isTaxon) result.isTaxon = true;
  return result;
}

/**
 * Render a tree node as an array of ASCII-art lines.
 *
 * Uses only pure ASCII characters: +-- for connectors and | for vertical bars.
 *
 * @param {object}   node              Tree node with {name, children}
 * @param {object}   [opts]            Options
 * @param {Map}      [opts.taxaByOttId]  Map from ott_id → taxa entry (for uniqname lookup)
 * @param {boolean}  [opts.useUniqNames] When true, prefer uniqname over node.name
 * @returns {string} The full ASCII tree as a single string (with trailing newline)
 */
export function renderTreeAscii(node, opts = {}) {
  const { taxaByOttId, useUniqNames } = opts;

  function getDisplayName(n) {
    if (useUniqNames && taxaByOttId) {
      const sp = taxaByOttId.get(n.ott_id);
      if (sp?.uniqname) return sp.uniqname;
    }
    return n.name;
  }

  function formatLabel(n) {
    const dn = getDisplayName(n);
    return useUniqNames ? dn : capitalize(dn);
  }

  /** Recursively render children (not the root itself). */
  function walk(n, prefix, isLast) {
    const connector = isLast ? "+-- " : "+-- ";
    const lines = [prefix + connector + formatLabel(n)];

    const kids = n.children || [];
    kids.forEach((child, i) => {
      const childIsLast = i === kids.length - 1;
      const childPrefix = prefix + (isLast ? "    " : "|   ");
      lines.push(...walk(child, childPrefix, childIsLast));
    });

    return lines;
  }

  // Root line has no connector or prefix
  const lines = [formatLabel(node)];
  const kids = node.children || [];
  kids.forEach((child, i) => {
    const childIsLast = i === kids.length - 1;
    lines.push(...walk(child, "", childIsLast));
  });

  return lines.join("\n") + "\n";
}

/**
 * Render a clade display tree as ASCII where leaves show comma-separated taxa.
 *
 * @param {object}   node               Tree node with {name, children, _taxa?}
 * @param {object}   [opts]             Options
 * @param {boolean}  [opts.useUniqNames] When true, show uniqname for each taxon
 * @returns {string} The full ASCII tree as a single string (with trailing newline)
 */
export function renderCladeAscii(node, opts = {}) {
  const { useUniqNames } = opts;

  function taxonLabel(t) {
    if (useUniqNames && t.uniqname) return t.uniqname;
    return capitalize(t.name);
  }

  function leafLabel(n) {
    const taxa = n._taxa || [];
    if (taxa.length === 0) return capitalize(n.name);
    return taxa.map(taxonLabel).join(", ");
  }

  function nodeLabel(n) {
    return capitalize(n.name);
  }

  function walk(n, prefix, isLast) {
    const connector = "+-- ";
    const isLeaf = !n.children || n.children.length === 0;
    const label = isLeaf ? leafLabel(n) : nodeLabel(n);
    const lines = [prefix + connector + label];

    if (!isLeaf) {
      n.children.forEach((child, i) => {
        const childIsLast = i === n.children.length - 1;
        const childPrefix = prefix + (isLast ? "    " : "|   ");
        lines.push(...walk(child, childPrefix, childIsLast));
      });
    }
    return lines;
  }

  const isLeaf = !node.children || node.children.length === 0;
  const rootLabel = isLeaf ? leafLabel(node) : nodeLabel(node);
  const lines = [rootLabel];
  const kids = node.children || [];
  kids.forEach((child, i) => {
    const childIsLast = i === kids.length - 1;
    lines.push(...walk(child, "", childIsLast));
  });

  return lines.join("\n") + "\n";
}
