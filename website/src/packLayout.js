/**
 * Circle-packing layout for a taxonomy subtree.
 *
 * Uses d3-hierarchy's pack() layout to compute nested circles where:
 * - Each leaf taxon is a circle (equal weight)
 * - Internal nodes are parent circles containing their children
 *
 * Inspired by https://observablehq.com/@d3/pack/2
 */

import { hierarchy, pack } from "d3-hierarchy";

/**
 * Assign a depth-based color to each internal circle.
 * Returns an HSL string that shifts hue with depth and lightens for deeper nodes.
 */
export function depthColor(depth, maxDepth) {
  const hue = (depth / Math.max(maxDepth, 1)) * 260;
  const lightness = 85 - (depth / Math.max(maxDepth, 1)) * 25;
  return `hsl(${Math.round(hue)}, 50%, ${Math.round(lightness)}%)`;
}

/**
 * Compute circle-packing layout for a subtree.
 *
 * @param {object} subtree  – tree node with { name, ott_id, isTaxon, children }
 * @param {number} size     – width & height of the layout (square)
 * @param {number} [padding=3] – padding between sibling circles
 * @returns {{ circles: Array<{ x, y, r, node, depth, isLeaf }>, size: number, maxDepth: number }}
 */
export function computePackLayout(subtree, size, padding = 3) {
  if (!subtree) return { circles: [], size, maxDepth: 0 };

  // Build d3 hierarchy and sum leaf values
  const root = hierarchy(subtree, (d) => d.children)
    .sum(() => 1)
    .sort((a, b) => b.value - a.value);

  // Compute the pack layout
  const packLayout = pack()
    .size([size, size])
    .padding(padding);

  packLayout(root);

  // Extract all circles
  const circles = [];
  let maxDepth = 0;

  root.each((d) => {
    if (d.depth > maxDepth) maxDepth = d.depth;
    circles.push({
      x: d.x,
      y: d.y,
      r: d.r,
      node: d.data,
      depth: d.depth,
      isLeaf: !d.children || d.children.length === 0,
    });
  });

  return { circles, size, maxDepth };
}
