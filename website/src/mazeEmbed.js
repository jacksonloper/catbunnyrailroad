/**
 * Tree embedding using the heavy-child layout method.
 *
 * Workflow:
 *   1. binarizeTree – ensure every internal node has ≤ 2 children.
 *   2. layoutBinaryTree – produce a compact grid-coordinate layout using
 *      a heavy-child heuristic that alternates orientation and keeps
 *      the layout as square as possible.
 *
 * The heavy-child algorithm:
 *   1) Annotate each node with its subtree size and height.
 *   2) At each internal node, sort children so the heavier subtree
 *      gets the dominant (inline) position.
 *   3) Alternate between horizontal and vertical orientation at each
 *      level, trying multiple placement templates and picking the
 *      most compact (smallest area, most square) result.
 *   4) Unary nodes (single child) continue in the current direction
 *      without wasting space for a missing sibling.
 *
 * This is O(n) and produces compact, non-overlapping layouts.
 */

// ---------------------------------------------------------------------------
// Binarize – resolve polytomies by pairing up the last two children
// ---------------------------------------------------------------------------

/**
 * Return a deep copy of `node` in which every internal node has at most
 * 2 children.  Extra children are grouped into new unnamed internal nodes.
 */
export function binarizeTree(node) {
  if (!node.children || node.children.length === 0) {
    return { ...node, children: [] };
  }
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
// Heavy-child layout algorithm
// ---------------------------------------------------------------------------

/**
 * Annotate each node with subtree size and height.
 * Mutates node in place.
 */
export function annotateTree(node) {
  if (!node.children || node.children.length === 0) {
    node._size = 1;
    node._height = 0;
    return { size: 1, height: 0 };
  }
  let totalSize = 1;
  let maxHeight = 0;
  for (const child of node.children) {
    const info = annotateTree(child);
    totalSize += info.size;
    maxHeight = Math.max(maxHeight, info.height);
  }
  node._size = totalSize;
  node._height = 1 + maxHeight;
  return { size: totalSize, height: 1 + maxHeight };
}

function cloneLayout(layout) {
  return {
    width: layout.width,
    height: layout.height,
    root: { ...layout.root },
    nodes: layout.nodes.map((p) => ({ ...p })),
    edges: layout.edges.map((e) => ({ from: { ...e.from }, to: { ...e.to } })),
  };
}

function shiftLayout(layout, dx, dy) {
  const out = cloneLayout(layout);
  out.root.x += dx;
  out.root.y += dy;
  for (const p of out.nodes) {
    p.x += dx;
    p.y += dy;
  }
  for (const e of out.edges) {
    e.from.x += dx;
    e.from.y += dy;
    e.to.x += dx;
    e.to.y += dy;
  }
  return out;
}

function makeLeaf(node) {
  return {
    width: 1,
    height: 1,
    root: { x: 0, y: 0, node },
    nodes: [{ x: 0, y: 0, node }],
    edges: [],
  };
}

function unionLayouts(parts) {
  const out = {
    width: 0,
    height: 0,
    root: null,
    nodes: [],
    edges: [],
  };
  for (const p of parts) {
    out.width = Math.max(out.width, p.width);
    out.height = Math.max(out.height, p.height);
    out.nodes.push(...p.nodes);
    out.edges.push(...p.edges);
  }
  return out;
}

function bboxFromNodes(nodes) {
  let minX = Infinity,
    minY = Infinity,
    maxX = -Infinity,
    maxY = -Infinity;
  for (const p of nodes) {
    minX = Math.min(minX, p.x);
    minY = Math.min(minY, p.y);
    maxX = Math.max(maxX, p.x);
    maxY = Math.max(maxY, p.y);
  }
  return {
    minX,
    minY,
    maxX,
    maxY,
    width: maxX - minX + 1,
    height: maxY - minY + 1,
  };
}

function normalize(layout) {
  const box = bboxFromNodes(layout.nodes);
  const dx = -box.minX;
  const dy = -box.minY;
  const out = shiftLayout(layout, dx, dy);
  out.width = box.width;
  out.height = box.height;
  return out;
}

function scoreLayout(layout, lambda = 0.3) {
  const area = layout.width * layout.height;
  const squareness = Math.abs(layout.width - layout.height);
  return area + lambda * squareness;
}

function connect(parent, child) {
  return {
    from: { x: parent.x, y: parent.y },
    to: { x: child.x, y: child.y },
  };
}

function flip(orientation) {
  return orientation === "vertical" ? "horizontal" : "vertical";
}

/**
 * Lay out a binary tree using the heavy-child heuristic.
 *
 * @param {object} node – binary tree node with .children, ._size, ._height
 * @param {string} orientation – "vertical" or "horizontal"
 * @returns {{ width, height, root: {x,y,node}, nodes: {x,y,node}[], edges: {from:{x,y},to:{x,y}}[] }}
 */
export function layoutBinaryTree(node, orientation = "vertical") {
  if (!node) return null;
  if (!node.children || node.children.length === 0) return makeLeaf(node);

  const childLayouts = [];
  for (let i = 0; i < node.children.length; i++) {
    const child = node.children[i];
    childLayouts.push({
      side: i === 0 ? "left" : "right",
      node: child,
      layout: layoutBinaryTree(child, flip(orientation)),
    });
  }

  if (childLayouts.length === 1) {
    // Unary node: continue in current direction, no wasted sibling space.
    const ch = childLayouts[0].layout;
    let childShifted, root;
    if (orientation === "vertical") {
      childShifted = shiftLayout(ch, 0, 2);
      root = { x: childShifted.root.x, y: 0, node };
    } else {
      childShifted = shiftLayout(ch, 2, 0);
      root = { x: 0, y: childShifted.root.y, node };
    }
    const out = unionLayouts([childShifted]);
    out.root = root;
    out.nodes.push(root);
    out.edges.push(connect(root, childShifted.root));
    return normalize(out);
  }

  // Two children. Put heavier one in dominant position.
  childLayouts.sort((a, b) => (b.node._size || 0) - (a.node._size || 0));
  const heavy = childLayouts[0].layout;
  const light = childLayouts[1].layout;

  const candidates = [];

  if (orientation === "vertical") {
    // Template A: heavy below root, light to right
    {
      const H = shiftLayout(heavy, 0, 2);
      const L = shiftLayout(light, H.width + 2, 2);
      const root = { x: H.root.x, y: 0, node };
      const out = unionLayouts([H, L]);
      out.root = root;
      out.nodes.push(root);
      out.edges.push(connect(root, H.root));
      out.edges.push({
        from: { x: root.x, y: root.y },
        to: { x: L.root.x, y: L.root.y },
      });
      candidates.push(normalize(out));
    }
    // Template B: light to left, heavy to right
    {
      const L = shiftLayout(light, 0, 2);
      const H = shiftLayout(heavy, L.width + 2, 2);
      const root = { x: H.root.x, y: 0, node };
      const out = unionLayouts([L, H]);
      out.root = root;
      out.nodes.push(root);
      out.edges.push(connect(root, H.root));
      out.edges.push({
        from: { x: root.x, y: root.y },
        to: { x: L.root.x, y: L.root.y },
      });
      candidates.push(normalize(out));
    }
  } else {
    // Template A: heavy to right, light below
    {
      const H = shiftLayout(heavy, 2, 0);
      const L = shiftLayout(light, 2, H.height + 2);
      const root = { x: 0, y: H.root.y, node };
      const out = unionLayouts([H, L]);
      out.root = root;
      out.nodes.push(root);
      out.edges.push(connect(root, H.root));
      out.edges.push({
        from: { x: root.x, y: root.y },
        to: { x: L.root.x, y: L.root.y },
      });
      candidates.push(normalize(out));
    }
    // Template B: light above, heavy below
    {
      const L = shiftLayout(light, 2, 0);
      const H = shiftLayout(heavy, 2, L.height + 2);
      const root = { x: 0, y: H.root.y, node };
      const out = unionLayouts([L, H]);
      out.root = root;
      out.nodes.push(root);
      out.edges.push(connect(root, H.root));
      out.edges.push({
        from: { x: root.x, y: root.y },
        to: { x: L.root.x, y: L.root.y },
      });
      candidates.push(normalize(out));
    }
  }

  candidates.sort((a, b) => scoreLayout(a) - scoreLayout(b));
  return candidates[0];
}

// ---------------------------------------------------------------------------
// High-level entry point
// ---------------------------------------------------------------------------

/**
 * Lay out a binary tree using the heavy-child method, producing
 * grid coordinates and edge lists suitable for maze rendering.
 *
 * @param {object} binTree – binary tree (each node has 0–2 children)
 * @returns {{ width: number, height: number, placements: object[], edges: object[] }}
 *   placements – flat list of { node, row, col } (row=y, col=x)
 *   edges      – list of { from: {x,y}, to: {x,y} } for connecting lines
 */
export function embedTreeInMaze(binTree) {
  annotateTree(binTree);
  const layout = layoutBinaryTree(binTree, "vertical");
  if (!layout) return null;

  const placements = layout.nodes.map((n) => ({
    node: n.node,
    row: n.y,
    col: n.x,
  }));

  return {
    width: layout.width,
    height: layout.height,
    placements,
    edges: layout.edges,
  };
}
