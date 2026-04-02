import { useMemo, useRef, useEffect } from "react";
import { capitalize } from "./treeUtils.js";
import "./WalkaboutView.css";

/* ───── layout constants ───── */
const CARD_W = 160;
const CARD_H = 200;
const PAD = 20;
const GAP = 12;
const LABEL_H = 26;

/* ───── bottom-up layout algorithm ───── */

/**
 * Compute sizes bottom-up for every node.
 * Returns { w, h, horizontal, labelH, children: [...childLayouts] }
 */
function computeLayout(node, taxaByOttId) {
  const isLeaf = !node.children || node.children.length === 0;

  if (isLeaf) {
    return { node, w: CARD_W, h: CARD_H, children: [], labelH: 0 };
  }

  const childLayouts = node.children.map((c) => computeLayout(c, taxaByOttId));
  const hasLabel = node.name && !node.name.startsWith("mrca");
  const labelH = hasLabel ? LABEL_H : 0;

  if (childLayouts.length === 1) {
    const cl = childLayouts[0];
    const w = cl.w + 2 * PAD;
    const h = cl.h + 2 * PAD + labelH;
    return { node, w, h, horizontal: true, children: childLayouts, labelH };
  }

  // Try horizontal (children side by side)
  const hW =
    childLayouts.reduce((s, c) => s + c.w, 0) +
    GAP * (childLayouts.length - 1) +
    2 * PAD;
  const hH = Math.max(...childLayouts.map((c) => c.h)) + 2 * PAD + labelH;

  // Try vertical (children stacked)
  const vW = Math.max(...childLayouts.map((c) => c.w)) + 2 * PAD;
  const vH =
    childLayouts.reduce((s, c) => s + c.h, 0) +
    GAP * (childLayouts.length - 1) +
    2 * PAD +
    labelH;

  // Choose the arrangement with better aspect ratio (closer to golden ratio)
  const target = 1.6;
  const hAspect = Math.abs(hW / hH - target);
  const vAspect = Math.abs(vW / vH - target);
  const horizontal = hAspect <= vAspect;

  const w = horizontal ? hW : vW;
  const h = horizontal ? hH : vH;

  return { node, w, h, horizontal, children: childLayouts, labelH };
}

/**
 * Assign (x, y) positions top-down.
 * Mutates layout objects in place.
 */
function assignPositions(layout, x, y) {
  layout.x = x;
  layout.y = y;

  if (layout.children.length === 0) return;

  const startX = x + PAD;
  const startY = y + PAD + layout.labelH;

  if (layout.horizontal) {
    let cx = startX;
    for (const child of layout.children) {
      // Center vertically within available height
      const availH = layout.h - 2 * PAD - layout.labelH;
      const cy = startY + (availH - child.h) / 2;
      assignPositions(child, cx, cy);
      cx += child.w + GAP;
    }
  } else {
    let cy = startY;
    for (const child of layout.children) {
      // Center horizontally within available width
      const availW = layout.w - 2 * PAD;
      const cx = startX + (availW - child.w) / 2;
      assignPositions(child, cx, cy);
      cy += child.h + GAP;
    }
  }
}

/**
 * Collect all layout nodes into a flat array for rendering.
 */
function collectNodes(layout, result = []) {
  result.push(layout);
  for (const child of layout.children) {
    collectNodes(child, result);
  }
  return result;
}

/**
 * Convert a hex color to rgba with given alpha.
 */
function hexToRgba(hex, alpha) {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

/* ───── component ───── */

export default function WalkaboutView({ condensed, taxaByOttId }) {
  const containerRef = useRef(null);

  // Compute layout
  const { allNodes, totalW, totalH } = useMemo(() => {
    const root = computeLayout(condensed, taxaByOttId);
    assignPositions(root, 0, 0);
    const nodes = collectNodes(root);
    return { allNodes: nodes, totalW: root.w, totalH: root.h };
  }, [condensed, taxaByOttId]);

  // On mount, scroll to center so user starts in middle of the view
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const scrollX = Math.max(0, (totalW - el.clientWidth) / 2);
    const scrollY = Math.max(0, (totalH - el.clientHeight) / 2);
    el.scrollLeft = scrollX;
    el.scrollTop = scrollY;
  }, [totalW, totalH]);

  return (
    <div className="walkabout-container" ref={containerRef}>
      <div
        className="walkabout-canvas"
        style={{ width: totalW, height: totalH }}
      >
        {allNodes.map((lyt, i) => {
          const nd = lyt.node;
          const isLeaf = lyt.children.length === 0;

          if (isLeaf) {
            const t = taxaByOttId.get(nd.ott_id);
            const name = t ? t.name : nd.name;
            const imgUrl = t?.image_url || null;
            return (
              <div
                key={`leaf-${nd.ott_id || i}`}
                className="wb-card"
                style={{ left: lyt.x, top: lyt.y, width: lyt.w, height: lyt.h }}
              >
                {imgUrl ? (
                  <img
                    className="wb-card-img"
                    src={imgUrl}
                    alt={name}
                    loading="lazy"
                  />
                ) : (
                  <div className="wb-card-placeholder">🌿</div>
                )}
                <div className="wb-card-name">{capitalize(name)}</div>
              </div>
            );
          }

          // Internal node rectangle
          const hasColor = nd.color;
          const hasLabel = nd.name && !nd.name.startsWith("mrca");
          const bg = hasColor
            ? hexToRgba(nd.color, 0.22)
            : "rgba(255, 255, 255, 0.02)";
          const borderColor = hasColor
            ? hexToRgba(nd.color, 0.6)
            : "rgba(255, 255, 255, 0.06)";

          return (
            <div
              key={`node-${nd.ott_id || i}-${lyt.x}`}
              className="wb-node"
              style={{
                left: lyt.x,
                top: lyt.y,
                width: lyt.w,
                height: lyt.h,
                background: bg,
                borderColor: borderColor,
                borderWidth: hasColor ? 2 : 1,
              }}
            >
              {hasLabel && (
                <span className="wb-node-label">{capitalize(nd.name)}</span>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
