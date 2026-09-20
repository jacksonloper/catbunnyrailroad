/**
 * placement-overrides.js
 *
 * Manual placement overrides for taxa that the Open Tree of Life synthetic
 * tree places wrongly (or not at all).  Today that means fossil taxa: they
 * have no DNA, so none of the molecular megatrees include them, their
 * taxonomy backbone (from GBIF) is flat, and the few morphological studies
 * in the synthesis are ranked low and occasionally mis-curated.
 *
 * Every override is a workaround for a specific upstream problem that is
 * listed in UPSTREAM.md.  When the upstream problem is fixed, delete the
 * override row.  The build warns when an override appears to be a no-op
 * (the taxon is already sister to its anchor), which is the signal that
 * the row can go.
 *
 * Data lives in placement_overrides.csv at the repo root.  Columns:
 *
 *   ott_id        – the taxon to move (must be in taxa.csv)
 *   anchor_a      – ott_id of a node already in the tree
 *   anchor_b      – optional second ott_id; the anchor is MRCA(a, b).
 *                   Leave blank to anchor on anchor_a's node itself.
 *   clade_name    – display name for the new parent node that joins the
 *                   moved taxon and the anchor clade
 *   clade_ott_id  – optional OTT id for that new node (must not already
 *                   be present in the tree)
 *   upstream_ref  – key into UPSTREAM.md explaining why this exists
 *   reason        – one-line human explanation
 *
 * Rows are applied in file order, so a later row may anchor on a
 * clade_ott_id created by an earlier row.
 *
 * Semantics of one row: detach the taxon (with its subtree) from wherever
 * Open Tree put it, collapse any internal node left with a single child,
 * then insert a new node in place of the anchor clade whose children are
 * [anchor clade, moved taxon].
 */

/** Parse raw CSV rows (as produced by build-data's parseCsv) into overrides. */
export function parseOverrideRows(rows) {
  return rows
    .filter((row) => row.ott_id)
    .map((row) => {
      const override = {
        ott_id: Number(row.ott_id),
        anchor_a: Number(row.anchor_a),
        anchor_b: row.anchor_b ? Number(row.anchor_b) : null,
        clade_name: row.clade_name || "",
        clade_ott_id: row.clade_ott_id ? Number(row.clade_ott_id) : null,
        upstream_ref: row.upstream_ref || "",
        reason: row.reason || "",
      };
      if (!override.ott_id || !override.anchor_a) {
        throw new Error(
          `placement_overrides.csv: row for "${row.ott_id}" needs ott_id and anchor_a`
        );
      }
      if (override.anchor_a === override.ott_id || override.anchor_b === override.ott_id) {
        throw new Error(
          `placement_overrides.csv: ott${override.ott_id} cannot anchor on itself`
        );
      }
      return override;
    });
}

/** Path (array of nodes) from root to the node with ott_id, or null. */
function findPath(node, ottId) {
  if (node.ott_id === ottId) return [node];
  for (const child of node.children || []) {
    const p = findPath(child, ottId);
    if (p) return [node, ...p];
  }
  return null;
}

function findMRCAPath(root, ottA, ottB) {
  const pathA = findPath(root, ottA);
  if (!pathA) return null;
  if (ottB == null) return pathA;
  const pathB = findPath(root, ottB);
  if (!pathB) return null;
  const common = [];
  for (let i = 0; i < Math.min(pathA.length, pathB.length); i++) {
    if (pathA[i] !== pathB[i]) break;
    common.push(pathA[i]);
  }
  return common;
}

/**
 * Detach `node` (last element of `path`) from the tree and collapse any
 * non-taxon ancestor left with a single child.  Returns the (possibly new)
 * root.
 */
function detach(root, path) {
  const node = path[path.length - 1];
  const parent = path[path.length - 2];
  parent.children = parent.children.filter((c) => c !== node);

  // Walk upward collapsing single-child, non-taxon nodes.
  for (let i = path.length - 2; i >= 0; i--) {
    const current = path[i];
    if (current.children.length !== 1 || current.isTaxon) break;
    const only = current.children[0];
    if (i === 0) return only; // root collapsed
    const grand = path[i - 1];
    grand.children = grand.children.map((c) => (c === current ? only : c));
  }
  return root;
}

/**
 * Apply overrides to a compact tree ({ name, ott_id, children, isTaxon }).
 * Mutates the tree and returns the root (which may change).
 *
 * `log` receives human-readable progress lines; `warn` receives warnings
 * such as "this override looks like a no-op now".
 */
export function applyPlacementOverrides(root, overrides, { log = () => {}, warn = () => {} } = {}) {
  for (const ov of overrides) {
    const label = `ott${ov.ott_id}`;

    const path = findPath(root, ov.ott_id);
    if (!path) throw new Error(`placement override: ${label} not found in tree`);
    if (path.length < 2) throw new Error(`placement override: ${label} is the root`);
    const node = path[path.length - 1];

    if (ov.clade_ott_id && findPath(root, ov.clade_ott_id)) {
      throw new Error(
        `placement override: clade_ott_id ${ov.clade_ott_id} (${ov.clade_name}) ` +
        `already exists in the tree – Open Tree may now place it; check UPSTREAM.md ` +
        `entry ${ov.upstream_ref || "?"}`
      );
    }

    // No-op detection: already sister to the anchor clade under a 2-child
    // parent?  Then Open Tree agrees with us and the row can be deleted.
    const anchorPathBefore = findMRCAPath(root, ov.anchor_a, ov.anchor_b);
    if (anchorPathBefore) {
      const anchorBefore = anchorPathBefore[anchorPathBefore.length - 1];
      const parent = path[path.length - 2];
      if (
        parent.children.length === 2 &&
        parent.children.includes(anchorBefore) &&
        !anchorPathBefore.includes(node)
      ) {
        warn(
          `override for ${label} (${node.name}) looks like a no-op: Open Tree already ` +
          `places it as sister to its anchor. Consider removing it ` +
          `(see UPSTREAM.md ${ov.upstream_ref || ""}).`
        );
      }
    }

    root = detach(root, path);

    const anchorPath = findMRCAPath(root, ov.anchor_a, ov.anchor_b);
    if (!anchorPath || anchorPath.length === 0) {
      throw new Error(
        `placement override: anchor for ${label} (ott${ov.anchor_a}` +
        `${ov.anchor_b ? ", ott" + ov.anchor_b : ""}) not found in tree`
      );
    }
    const anchor = anchorPath[anchorPath.length - 1];
    const newNode = {
      name: ov.clade_name,
      ott_id: ov.clade_ott_id || null,
      children: [anchor, node],
    };
    if (anchorPath.length === 1) {
      root = newNode;
    } else {
      const anchorParent = anchorPath[anchorPath.length - 2];
      anchorParent.children = anchorParent.children.map((c) =>
        c === anchor ? newNode : c
      );
    }
    log(
      `  Moved "${node.name}" (${label}) to be sister of "${anchor.name || "(unnamed)"}" ` +
      `under new node "${ov.clade_name}"${ov.upstream_ref ? ` [${ov.upstream_ref}]` : ""}`
    );
  }
  return root;
}
