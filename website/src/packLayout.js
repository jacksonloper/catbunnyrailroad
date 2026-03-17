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
 * Determine how a label should be oriented to fit inside a treemap cell,
 * or null if it doesn't fit in either orientation.
 *
 * The principle: a label is only shown when its estimated pixel width
 * (and height) fit entirely within the cell, with a small padding margin.
 * If horizontal doesn't fit, try rotating 90°.  If neither fits, hide it.
 *
 * @param {string} label    – the text to display
 * @param {number} cellW    – cell width in px
 * @param {number} cellH    – cell height in px
 * @param {number} [fontSize=7] – font size in px
 * @returns {"h"|"v"|null}  – "h" horizontal, "v" rotated 90°, or null (hidden)
 */
export function labelFit(label, cellW, cellH, fontSize = 7) {
  const charW = fontSize * 0.6; // approximate char width for sans-serif
  const textW = label.length * charW;
  const textH = fontSize;
  const pad = 2;

  // Horizontal: text runs left-to-right
  if (textW + pad <= cellW && textH + pad <= cellH) return "h";
  // Vertical: text rotated 90° (runs bottom-to-top)
  if (textW + pad <= cellH && textH + pad <= cellW) return "v";
  return null;
}

/**
 * Decide how to represent a leaf cell in the treemap.
 *
 * Priority order:
 *  1. "label-h" – horizontal text label fits
 *  2. "label-v" – vertical (90°-rotated) text label fits
 *  3. "img"     – cell is at least minImg × minImg so a square thumbnail fits
 *  4. "dot"     – cell exists but is too small for anything else; show a dot
 *
 * @param {string} label       – display name of the taxon
 * @param {number} cellW       – cell width in px
 * @param {number} cellH       – cell height in px
 * @param {number} [fontSize=7]  – font size in px (for label measurement)
 * @param {number} [minImg=6]    – minimum cell dimension to show a thumbnail
 * @returns {"label-h"|"label-v"|"img"|"dot"}
 */
export function cellRep(label, cellW, cellH, fontSize = 7, minImg = 6) {
  const fit = labelFit(label, cellW, cellH, fontSize);
  if (fit === "h") return "label-h";
  if (fit === "v") return "label-v";
  if (cellW >= minImg && cellH >= minImg) return "img";
  return "dot";
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
