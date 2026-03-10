/**
 * Tree subdivision embedding in a square grid maze.
 *
 * Workflow:
 *   1. binarizeTree – ensure every internal node has ≤ 2 children.
 *   2. embedTreeInMaze – place the binary tree into an m × m grid so
 *      that tree edges become contiguous passages and everything else
 *      is a wall.
 *
 * The embedding uses recursive area-bisection: each subtree is
 * assigned a rectangular band of rows; its root sits at one column
 * and its children sit two columns to the right, each in their own
 * proportional slice of rows.  Edges are routed as L-shaped corridors.
 *
 * Tuned for small trees (≤ ~15 leaves).
 */

// ---------------------------------------------------------------------------
// Binarize – resolve polytomies by pairing up the last two children
// ---------------------------------------------------------------------------

/**
 * Return a deep copy of `node` in which every internal node has at most
 * 2 children.  Extra children are grouped into new unnamed internal nodes.
 */
export function binarizeTree(node) {
  const children = node.children.map(binarizeTree);
  const result = { ...node, children: [...children] };
  while (result.children.length > 2) {
    const right = result.children.pop();
    const left = result.children.pop();
    result.children.push({
      name: "",
      ott_id: null,
      children: [left, right],
    });
  }
  return result;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function countLeaves(node) {
  if (node.children.length === 0) return 1;
  return node.children.reduce((s, c) => s + countLeaves(c), 0);
}

function treeDepth(node) {
  if (node.children.length === 0) return 0;
  return 1 + Math.max(...node.children.map(treeDepth));
}

// ---------------------------------------------------------------------------
// Grid maze embedding
// ---------------------------------------------------------------------------

/**
 * Embed a **binary** tree into a square grid.
 *
 * @param {object} binTree – tree where every node has 0 or 2 children.
 * @returns {{ grid: object[][], size: number, placements: object[] }}
 *   grid[r][c].passage  – true if the cell is part of the tree
 *   grid[r][c].node     – the tree node placed here (or null)
 *   placements          – flat array of { node, row, col }
 */
export function embedTreeInMaze(binTree) {
  const nLeaves = countLeaves(binTree);
  const depth = treeDepth(binTree);

  // Vertical: 2 rows per leaf + 1 for spacing.
  // Horizontal: 2 columns per depth level + padding.
  const m = Math.max(nLeaves * 2 + 1, depth * 2 + 3, 7);

  const grid = Array.from({ length: m }, () =>
    Array.from({ length: m }, () => ({ passage: false, node: null }))
  );
  const placements = [];

  function mark(r, c, node) {
    if (r < 0 || r >= m || c < 0 || c >= m) return;
    grid[r][c].passage = true;
    if (node) {
      grid[r][c].node = node;
      placements.push({ node, row: r, col: c });
    }
  }

  /** Route an L-shaped corridor: vertical at c1, then horizontal at r2. */
  function connectL(r1, c1, r2, c2) {
    const rMin = Math.min(r1, r2);
    const rMax = Math.max(r1, r2);
    for (let r = rMin; r <= rMax; r++) mark(r, c1, null);
    const cMin = Math.min(c1, c2);
    const cMax = Math.max(c1, c2);
    for (let c = cMin; c <= cMax; c++) mark(r2, c, null);
  }

  /**
   * Recursively lay out `node` starting at column `col` within
   * the row band [rStart, rEnd).  Returns the row the node occupies.
   */
  function layout(node, col, rStart, rEnd) {
    const mid = Math.floor((rStart + rEnd) / 2);

    if (node.children.length === 0) {
      mark(mid, col, node);
      return mid;
    }

    mark(mid, col, node);

    if (node.children.length === 1) {
      const childCol = Math.min(col + 2, m - 1);
      const cr = layout(node.children[0], childCol, rStart, rEnd);
      connectL(mid, col, cr, childCol);
      return mid;
    }

    // Two children – split rows proportional to leaf counts
    const nL = countLeaves(node.children[0]);
    const nR = countLeaves(node.children[1]);
    const split = rStart + Math.round(((rEnd - rStart) * nL) / (nL + nR));

    const childCol = Math.min(col + 2, m - 1);
    const leftRow = layout(node.children[0], childCol, rStart, split);
    const rightRow = layout(node.children[1], childCol, split, rEnd);

    connectL(mid, col, leftRow, childCol);
    connectL(mid, col, rightRow, childCol);

    return mid;
  }

  layout(binTree, 1, 0, m);

  return { grid, size: m, placements };
}
