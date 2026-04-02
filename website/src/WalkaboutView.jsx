import { useMemo, useRef, useEffect, useState, useCallback } from "react";
import { capitalize } from "./treeUtils.js";
import "./WalkaboutView.css";

/* ───── layout constants ───── */
const CARD_W = 160;
const CARD_H = 200;
const PAD = 20;
const GAP = 12;
const LABEL_H = 26;

const MIN_ZOOM = 0.15;
const MAX_ZOOM = 3;
const ZOOM_STEP = 1.15;

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
  const [zoom, setZoom] = useState(1);
  const touchRef = useRef({ dist: 0, zoom: 1 });

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
    const scrollX = Math.max(0, (totalW * zoom - el.clientWidth) / 2);
    const scrollY = Math.max(0, (totalH * zoom - el.clientHeight) / 2);
    el.scrollLeft = scrollX;
    el.scrollTop = scrollY;
    // only run on first mount
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /** Zoom toward a point in container-viewport coords */
  const zoomAt = useCallback((newZoom, clientX, clientY) => {
    const el = containerRef.current;
    if (!el) return;
    const clamped = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, newZoom));
    const rect = el.getBoundingClientRect();
    // point in content coords before zoom
    const px = (el.scrollLeft + clientX - rect.left) / zoom;
    const py = (el.scrollTop + clientY - rect.top) / zoom;
    setZoom(clamped);
    // after React re-renders, adjust scroll so the point stays under cursor
    requestAnimationFrame(() => {
      el.scrollLeft = px * clamped - (clientX - rect.left);
      el.scrollTop = py * clamped - (clientY - rect.top);
    });
  }, [zoom]);

  /** Zoom centered on viewport */
  const zoomCenter = useCallback((newZoom) => {
    const el = containerRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    zoomAt(newZoom, rect.left + rect.width / 2, rect.top + rect.height / 2);
  }, [zoomAt]);

  // Wheel zoom
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const onWheel = (e) => {
      if (!e.ctrlKey && !e.metaKey) return;
      e.preventDefault();
      const factor = e.deltaY < 0 ? ZOOM_STEP : 1 / ZOOM_STEP;
      zoomAt(zoom * factor, e.clientX, e.clientY);
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [zoom, zoomAt]);

  // Pinch-to-zoom
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    function getTouchDist(e) {
      const [a, b] = [e.touches[0], e.touches[1]];
      return Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);
    }
    function getTouchCenter(e) {
      const [a, b] = [e.touches[0], e.touches[1]];
      return { x: (a.clientX + b.clientX) / 2, y: (a.clientY + b.clientY) / 2 };
    }

    const onTouchStart = (e) => {
      if (e.touches.length === 2) {
        touchRef.current = { dist: getTouchDist(e), zoom };
      }
    };
    const onTouchMove = (e) => {
      if (e.touches.length === 2) {
        e.preventDefault();
        const newDist = getTouchDist(e);
        const center = getTouchCenter(e);
        const scale = newDist / touchRef.current.dist;
        zoomAt(touchRef.current.zoom * scale, center.x, center.y);
      }
    };
    el.addEventListener("touchstart", onTouchStart, { passive: true });
    el.addEventListener("touchmove", onTouchMove, { passive: false });
    return () => {
      el.removeEventListener("touchstart", onTouchStart);
      el.removeEventListener("touchmove", onTouchMove);
    };
  }, [zoom, zoomAt]);

  const pct = Math.round(zoom * 100);

  return (
    <div className="walkabout-container" ref={containerRef}>
      <div
        className="walkabout-canvas"
        style={{
          width: totalW * zoom,
          height: totalH * zoom,
        }}
      >
        <div
          className="walkabout-inner"
          style={{
            width: totalW,
            height: totalH,
            transform: `scale(${zoom})`,
            transformOrigin: "0 0",
          }}
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
              : "rgba(255, 255, 255, 0.05)";
            const borderColor = hasColor
              ? hexToRgba(nd.color, 0.6)
              : "rgba(255, 255, 255, 0.08)";

            return (
              <div
                key={`node-${nd.ott_id || nd.name || i}`}
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

      {/* Zoom controls */}
      <div className="wb-zoom-controls">
        <button
          className="wb-zoom-btn"
          onClick={() => zoomCenter(zoom * ZOOM_STEP)}
          aria-label="Zoom in"
          title="Zoom in"
        >
          +
        </button>
        <span className="wb-zoom-level">{pct}%</span>
        <button
          className="wb-zoom-btn"
          onClick={() => zoomCenter(zoom / ZOOM_STEP)}
          aria-label="Zoom out"
          title="Zoom out"
        >
          −
        </button>
        <button
          className="wb-zoom-btn wb-zoom-fit"
          onClick={() => {
            const el = containerRef.current;
            if (!el) return;
            const fitZoom = Math.min(
              el.clientWidth / totalW,
              el.clientHeight / totalH,
              MAX_ZOOM,
            );
            setZoom(Math.max(MIN_ZOOM, fitZoom));
          }}
          aria-label="Fit to screen"
          title="Fit to screen"
        >
          ⊞
        </button>
      </div>
    </div>
  );
}
