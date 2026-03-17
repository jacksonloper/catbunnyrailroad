/**
 * Nested-treemap layout for a taxonomy subtree.
 *
 * Uses d3-hierarchy's treemap() layout to compute nested rectangles where:
 * - Each leaf taxon is a rectangle (equal weight)
 * - Internal nodes are parent rectangles containing their children
 *
 * Inspired by https://observablehq.com/@d3/nested-treemap
 */

import { hierarchy, treemap, treemapBinary } from "d3-hierarchy";

/**
 * Assign a depth-based color to each internal rectangle.
 * Returns an HSL string that shifts hue with depth and lightens for deeper nodes.
 */
export function depthColor(depth, maxDepth) {
  const hue = (depth / Math.max(maxDepth, 1)) * 260;
  const lightness = 85 - (depth / Math.max(maxDepth, 1)) * 25;
  return `hsl(${Math.round(hue)}, 50%, ${Math.round(lightness)}%)`;
}

/**
 * Compute nested-treemap layout for a subtree.
 *
 * @param {object} subtree  – tree node with { name, ott_id, isTaxon, children }
 * @param {number} width    – width of the layout
 * @param {number} height   – height of the layout
 * @param {number} [padding=2] – padding between nested rectangles
 * @returns {{ rects: Array<{ x0, y0, x1, y1, node, depth, isLeaf }>, width: number, height: number, maxDepth: number }}
 */
export function computeTreemapLayout(subtree, width, height, padding = 2) {
  if (!subtree) return { rects: [], width, height, maxDepth: 0 };

  // Build d3 hierarchy and sum leaf values
  const root = hierarchy(subtree, (d) => d.children)
    .sum(() => 1)
    .sort((a, b) => b.value - a.value);

  // Compute the treemap layout
  const layout = treemap()
    .size([width, height])
    .tile(treemapBinary)
    .padding(padding)
    .round(true);

  layout(root);

  // Extract all rectangles
  const rects = [];
  let maxDepth = 0;

  root.each((d) => {
    if (d.depth > maxDepth) maxDepth = d.depth;
    rects.push({
      x0: d.x0,
      y0: d.y0,
      x1: d.x1,
      y1: d.y1,
      node: d.data,
      depth: d.depth,
      isLeaf: !d.children || d.children.length === 0,
    });
  });

  return { rects, width, height, maxDepth };
}
