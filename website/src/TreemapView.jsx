import { useState, useMemo, useRef } from "react";
import { capitalize } from "./treeUtils.js";
import { computeTreemapLayout, depthColor, cellRep } from "./packLayout.js";

/** Draw a rounded rect path on a Canvas 2D context (cross-browser, avoids ctx.roundRect) */
function traceRoundedRect(ctx, x, y, w, h, r) {
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.arcTo(x + w, y, x + w, y + r, r);
  ctx.lineTo(x + w, y + h - r);
  ctx.arcTo(x + w, y + h, x + w - r, y + h, r);
  ctx.lineTo(x + r, y + h);
  ctx.arcTo(x, y + h, x, y + h - r, r);
  ctx.lineTo(x, y + r);
  ctx.arcTo(x, y, x + r, y, r);
  ctx.closePath();
}

// Virtual canvas dimensions (large for zoom detail)
const TREEMAP_W = 2100;
const TREEMAP_H = 1500;
// Viewport CSS dimensions
const VIEW_W = 700;
const VIEW_H = 500;

/**
 * Self-contained treemap view with zoom/pan and SVG/PNG export.
 *
 * Props:
 *  - subtree       – tree node with { name, ott_id, isTaxon, children }
 *  - taxaByOttId   – Map<ott_id, taxon> for looking up image_url, uniqname, etc.
 *  - showUniqNames – whether to display unique/scientific names
 *  - setShowUniqNames – setter for the toggle
 *  - onBack        – callback when user clicks "Back to tree"
 *  - onClose       – callback when user clicks close ✕
 */
export default function TreemapView({ subtree, taxaByOttId, showUniqNames, setShowUniqNames, onBack, onClose }) {
  const [showLegend, setShowLegend] = useState(false);
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const svgRef = useRef(null);
  const dragRef = useRef(null);
  const pinchRef = useRef(null);

  const treemapData = useMemo(
    () => computeTreemapLayout(subtree, TREEMAP_W, TREEMAP_H),
    [subtree],
  );

  /** Return the display name for a taxon node, respecting the uniqname toggle */
  function displayName(node) {
    if (showUniqNames) {
      const sp = taxaByOttId.get(node.ott_id);
      if (sp?.uniqname) return sp.uniqname;
    }
    return node.name;
  }

  // ---- zoom / pan helpers ----

  const clampPan = (px, py, z) => {
    const maxPx = Math.max(0, (TREEMAP_W * z - VIEW_W) / 2);
    const maxPy = Math.max(0, (TREEMAP_H * z - VIEW_H) / 2);
    return {
      x: Math.max(-maxPx, Math.min(maxPx, px)),
      y: Math.max(-maxPy, Math.min(maxPy, py)),
    };
  };

  const handleWheel = (e) => {
    e.preventDefault();
    const delta = e.deltaY > 0 ? 0.9 : 1.1;
    const next = Math.max(1, Math.min(10, zoom * delta));
    setZoom(next);
    setPan((p) => clampPan(p.x, p.y, next));
  };

  const handlePointerDown = (e) => {
    if (e.pointerType === "touch") return;
    e.currentTarget.setPointerCapture(e.pointerId);
    dragRef.current = { startX: e.clientX, startY: e.clientY, panX: pan.x, panY: pan.y };
  };
  const handlePointerMove = (e) => {
    if (!dragRef.current) return;
    const dx = e.clientX - dragRef.current.startX;
    const dy = e.clientY - dragRef.current.startY;
    setPan(clampPan(dragRef.current.panX + dx, dragRef.current.panY + dy, zoom));
  };
  const handlePointerUp = () => { dragRef.current = null; };

  const pinchDist = (ts) => Math.hypot(ts[0].clientX - ts[1].clientX, ts[0].clientY - ts[1].clientY);
  const handleTouchStart = (e) => {
    if (e.touches.length === 2) {
      e.preventDefault();
      pinchRef.current = { dist: pinchDist(e.touches), zoom };
    } else if (e.touches.length === 1) {
      dragRef.current = { startX: e.touches[0].clientX, startY: e.touches[0].clientY, panX: pan.x, panY: pan.y };
    }
  };
  const handleTouchMove = (e) => {
    if (e.touches.length === 2 && pinchRef.current) {
      e.preventDefault();
      const d = pinchDist(e.touches);
      const next = Math.max(1, Math.min(10, pinchRef.current.zoom * (d / pinchRef.current.dist)));
      setZoom(next);
      setPan((p) => clampPan(p.x, p.y, next));
    } else if (e.touches.length === 1 && dragRef.current) {
      const dx = e.touches[0].clientX - dragRef.current.startX;
      const dy = e.touches[0].clientY - dragRef.current.startY;
      setPan(clampPan(dragRef.current.panX + dx, dragRef.current.panY + dy, zoom));
    }
  };
  const handleTouchEnd = () => { dragRef.current = null; pinchRef.current = null; };

  const resetZoom = () => { setZoom(1); setPan({ x: 0, y: 0 }); };

  // ---- legend ----

  function buildLegendEntries() {
    const leafRects = treemapData.rects.filter((r) => r.isLeaf && r.node.isTaxon);
    const seen = new Set();
    const result = [];
    for (const r of leafRects) {
      if (seen.has(r.node.ott_id)) continue;
      seen.add(r.node.ott_id);
      const sp = taxaByOttId.get(r.node.ott_id);
      result.push({ name: displayName(r.node), imageUrl: sp?.image_url || null, ottId: r.node.ott_id });
    }
    result.sort((a, b) => a.name.localeCompare(b.name));
    return result;
  }

  // ---- SVG export ----

  async function handleSaveSvg() {
    const { rects, maxDepth } = treemapData;
    const leafRects = rects.filter((r) => r.isLeaf && r.node.isTaxon);

    // Pre-fetch images as data-URIs for self-contained SVG
    const uniqueUrls = new Set();
    for (const r of leafRects) {
      const sp = taxaByOttId.get(r.node.ott_id);
      if (sp?.image_url) uniqueUrls.add(sp.image_url);
    }
    const dataUrls = new Map();
    await Promise.all([...uniqueUrls].map(async (srcUrl) => {
      try {
        const resp = await fetch(srcUrl);
        if (!resp.ok) return;
        const blob = await resp.blob();
        const dataUrl = await new Promise((resolve) => {
          const reader = new FileReader();
          reader.onloadend = () => resolve(reader.result);
          reader.readAsDataURL(blob);
        });
        dataUrls.set(srcUrl, dataUrl);
      } catch (err) { console.warn("Failed to load image:", srcUrl, err); }
    }));

    const legendEntries = showLegend ? buildLegendEntries() : [];
    const legendImgSize = 16;
    const legendRowH = 22;
    const legendPadTop = 12;
    const legendH = legendEntries.length > 0 ? legendPadTop + legendEntries.length * legendRowH + 4 : 0;
    const totalH = TREEMAP_H + legendH;

    const lines = [];
    lines.push(`<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="${TREEMAP_W}" height="${totalH}" viewBox="0 0 ${TREEMAP_W} ${totalH}">`);
    lines.push(`<rect width="${TREEMAP_W}" height="${totalH}" fill="white"/>`);

    // Internal rects
    const sorted = [...rects].sort((a, b) => a.depth - b.depth);
    for (const r of sorted) {
      if (r.isLeaf) continue;
      const fill = depthColor(r.depth, maxDepth);
      lines.push(`<rect x="${r.x0}" y="${r.y0}" width="${r.x1 - r.x0}" height="${r.y1 - r.y0}" fill="${fill}" stroke="#fff" stroke-width="1" opacity="0.6"/>`);
    }

    // Leaf taxa
    for (const r of leafRects) {
      const sp = taxaByOttId.get(r.node.ott_id);
      const imgUrl = sp?.image_url;
      const resolvedUrl = dataUrls.get(imgUrl) ?? imgUrl;
      const rw = r.x1 - r.x0;
      const rh = r.y1 - r.y0;
      const cx = r.x0 + rw / 2;
      const cy = r.y0 + rh / 2;
      const dn = displayName(r.node);
      const capName = showUniqNames ? dn : capitalize(dn);
      const rep = cellRep(dn, rw, rh);

      if (rep === "dot") {
        const dotR = Math.max(1, Math.min(rw, rh) * 0.3);
        lines.push(`<circle cx="${cx}" cy="${cy}" r="${dotR}" fill="${resolvedUrl ? "#e07020" : "#888"}"/>`);
        continue;
      }
      if (rep === "img") {
        const imgS = Math.min(rw, rh) * 0.85;
        if (resolvedUrl) {
          lines.push(`<image href="${resolvedUrl.replace(/&/g, "&amp;").replace(/"/g, "&quot;")}" x="${cx - imgS / 2}" y="${cy - imgS / 2}" width="${imgS}" height="${imgS}" clip-path="inset(0 round 2px)"/>`);
        } else {
          lines.push(`<circle cx="${cx}" cy="${cy}" r="${imgS / 2}" fill="#e07020"/>`);
        }
        continue;
      }

      const fit = rep === "label-h" ? "h" : "v";
      const imgS = Math.min(rw, rh, 20) * 0.6;
      const showImg = fit === "h" && imgS + 11 <= rh;
      if (showImg) {
        if (resolvedUrl) {
          lines.push(`<image href="${resolvedUrl.replace(/&/g, "&amp;").replace(/"/g, "&quot;")}" x="${cx - imgS / 2}" y="${cy - imgS / 2 - 4}" width="${imgS}" height="${imgS}" clip-path="inset(0 round 3px)"/>`);
        } else {
          lines.push(`<circle cx="${cx}" cy="${cy - 4}" r="${imgS / 2}" fill="#e07020"/>`);
        }
      }
      const textY = showImg ? cy + imgS / 2 + 4 : cy;
      const baseline = showImg ? "" : ` dominant-baseline="central"`;
      const transform = fit === "v" ? ` transform="rotate(-90,${cx},${cy})"` : "";
      lines.push(`<text x="${cx}" y="${textY}" text-anchor="middle"${baseline} font-size="7" fill="#333" font-family="sans-serif"${transform}>${capName.replace(/&/g, "&amp;").replace(/</g, "&lt;")}</text>`);
    }

    // Legend
    if (showLegend && legendEntries.length > 0) {
      const ly0 = TREEMAP_H + legendPadTop;
      for (let i = 0; i < legendEntries.length; i++) {
        const e = legendEntries[i];
        const ry = ly0 + i * legendRowH;
        const resolvedUrl = e.imageUrl && (dataUrls.get(e.imageUrl) ?? e.imageUrl);
        if (resolvedUrl) {
          lines.push(`<image href="${resolvedUrl.replace(/&/g, "&amp;").replace(/"/g, "&quot;")}" x="4" y="${ry}" width="${legendImgSize}" height="${legendImgSize}" clip-path="inset(0 round 3px)"/>`);
        } else {
          lines.push(`<circle cx="${4 + legendImgSize / 2}" cy="${ry + legendImgSize / 2}" r="5" fill="#e07020"/>`);
        }
        const capName = showUniqNames ? e.name : capitalize(e.name);
        lines.push(`<text x="${4 + legendImgSize + 6}" y="${ry + legendImgSize / 2}" dominant-baseline="central" font-size="11" fill="#333" font-family="sans-serif">${capName.replace(/&/g, "&amp;").replace(/</g, "&lt;")}</text>`);
      }
    }

    lines.push("</svg>");
    const svgStr = lines.join("\n");
    const blob = new Blob([svgStr], { type: "image/svg+xml" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "treemap.svg";
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  // ---- PNG export ----

  async function handleSavePng() {
    const { rects, maxDepth } = treemapData;
    const leafRects = rects.filter((r) => r.isLeaf && r.node.isTaxon);

    const legendEntries = showLegend ? buildLegendEntries() : [];
    const legendImgSize = 16;
    const legendRowH = 22;
    const legendPadTop = 12;
    const legendH = legendEntries.length > 0 ? legendPadTop + legendEntries.length * legendRowH + 4 : 0;
    const totalH = TREEMAP_H + legendH;

    const printPx = 2550;
    const scale = printPx / Math.max(TREEMAP_W, totalH);
    const canvasW = Math.round(TREEMAP_W * scale);
    const canvasH = Math.round(totalH * scale);

    // Fetch images
    const uniqueUrls = new Set();
    for (const r of leafRects) {
      const sp = taxaByOttId.get(r.node.ott_id);
      if (sp?.image_url) uniqueUrls.add(sp.image_url);
    }
    for (const e of legendEntries) {
      if (e.imageUrl) uniqueUrls.add(e.imageUrl);
    }
    const bitmaps = new Map();
    await Promise.all([...uniqueUrls].map(async (url) => {
      try {
        const resp = await fetch(url);
        if (!resp.ok) return;
        const blob = await resp.blob();
        const bitmap = await createImageBitmap(blob);
        bitmaps.set(url, bitmap);
      } catch (err) { console.warn("Failed to load image:", url, err); }
    }));

    const canvas = document.createElement("canvas");
    canvas.width = canvasW;
    canvas.height = canvasH;
    const ctx = canvas.getContext("2d");

    ctx.fillStyle = "white";
    ctx.fillRect(0, 0, canvasW, canvasH);

    // Internal rects
    const sorted = [...rects].sort((a, b) => a.depth - b.depth);
    for (const r of sorted) {
      if (r.isLeaf) continue;
      ctx.globalAlpha = 0.6;
      ctx.fillStyle = depthColor(r.depth, maxDepth);
      ctx.fillRect(r.x0 * scale, r.y0 * scale, (r.x1 - r.x0) * scale, (r.y1 - r.y0) * scale);
      ctx.globalAlpha = 1;
      ctx.strokeStyle = "#fff";
      ctx.lineWidth = 1 * scale;
      ctx.strokeRect(r.x0 * scale, r.y0 * scale, (r.x1 - r.x0) * scale, (r.y1 - r.y0) * scale);
    }

    // Leaf taxa
    for (const r of leafRects) {
      const sp = taxaByOttId.get(r.node.ott_id);
      const rw = r.x1 - r.x0;
      const rh = r.y1 - r.y0;
      const cx = r.x0 + rw / 2;
      const cy = r.y0 + rh / 2;
      const dn = displayName(r.node);
      const capName = showUniqNames ? dn : capitalize(dn);
      const rep = cellRep(dn, rw, rh);

      if (rep === "dot") {
        const dotR = Math.max(1, Math.min(rw, rh) * 0.3);
        ctx.fillStyle = sp?.image_url ? "#e07020" : "#888";
        ctx.beginPath();
        ctx.arc(cx * scale, cy * scale, dotR * scale, 0, 2 * Math.PI);
        ctx.fill();
        continue;
      }
      if (rep === "img") {
        const imgS = Math.min(rw, rh) * 0.85;
        const bitmap = sp?.image_url && bitmaps.get(sp.image_url);
        if (bitmap) {
          const imgX = (cx - imgS / 2) * scale;
          const imgY = (cy - imgS / 2) * scale;
          const imgW = imgS * scale;
          const imgH = imgS * scale;
          ctx.save();
          ctx.beginPath();
          traceRoundedRect(ctx, imgX, imgY, imgW, imgH, 2 * scale);
          ctx.clip();
          ctx.drawImage(bitmap, imgX, imgY, imgW, imgH);
          ctx.restore();
        } else {
          ctx.fillStyle = "#e07020";
          ctx.beginPath();
          ctx.arc(cx * scale, cy * scale, (imgS / 2) * scale, 0, 2 * Math.PI);
          ctx.fill();
        }
        continue;
      }

      // label-h or label-v
      const fit = rep === "label-h" ? "h" : "v";
      const imgS = Math.min(rw, rh, 20) * 0.6;
      const showImg = fit === "h" && imgS + 11 <= rh;
      if (showImg) {
        const bitmap = sp?.image_url && bitmaps.get(sp.image_url);
        if (bitmap) {
          const imgX = (cx - imgS / 2) * scale;
          const imgY = (cy - imgS / 2 - 4) * scale;
          const imgW = imgS * scale;
          const imgH = imgS * scale;
          ctx.save();
          ctx.beginPath();
          traceRoundedRect(ctx, imgX, imgY, imgW, imgH, 3 * scale);
          ctx.clip();
          ctx.drawImage(bitmap, imgX, imgY, imgW, imgH);
          ctx.restore();
        } else {
          ctx.fillStyle = "#e07020";
          ctx.beginPath();
          ctx.arc(cx * scale, (cy - 4) * scale, (imgS / 2) * scale, 0, 2 * Math.PI);
          ctx.fill();
        }
      }
      ctx.font = `${7 * scale}px sans-serif`;
      ctx.fillStyle = "#333";
      ctx.textAlign = "center";
      if (fit === "v") {
        ctx.save();
        ctx.translate(cx * scale, cy * scale);
        ctx.rotate(-Math.PI / 2);
        ctx.textBaseline = "middle";
        ctx.fillText(capName, 0, 0);
        ctx.restore();
      } else {
        const textY = showImg ? cy + imgS / 2 + 4 : cy;
        ctx.textBaseline = showImg ? "top" : "middle";
        ctx.fillText(capName, cx * scale, textY * scale);
      }
    }

    // Legend
    if (showLegend && legendEntries.length > 0) {
      ctx.textAlign = "left";
      for (let i = 0; i < legendEntries.length; i++) {
        const e = legendEntries[i];
        const ry = (TREEMAP_H + legendPadTop + i * legendRowH) * scale;
        const bitmap = e.imageUrl && bitmaps.get(e.imageUrl);
        if (bitmap) {
          const imgX = 4 * scale;
          const imgW = legendImgSize * scale;
          const imgH = legendImgSize * scale;
          ctx.save();
          ctx.beginPath();
          traceRoundedRect(ctx, imgX, ry, imgW, imgH, 3 * scale);
          ctx.clip();
          ctx.drawImage(bitmap, imgX, ry, imgW, imgH);
          ctx.restore();
        } else {
          ctx.fillStyle = "#e07020";
          ctx.beginPath();
          ctx.arc((4 + legendImgSize / 2) * scale, ry + (legendImgSize / 2) * scale, 5 * scale, 0, 2 * Math.PI);
          ctx.fill();
        }
        const capName = showUniqNames ? e.name : capitalize(e.name);
        ctx.font = `${11 * scale}px sans-serif`;
        ctx.fillStyle = "#333";
        ctx.textBaseline = "middle";
        ctx.fillText(capName, (4 + legendImgSize + 6) * scale, ry + (legendImgSize / 2) * scale);
      }
    }

    canvas.toBlob((pngBlob) => {
      if (!pngBlob) return;
      const pngUrl = URL.createObjectURL(pngBlob);
      const a = document.createElement("a");
      a.href = pngUrl;
      a.download = "treemap.png";
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(pngUrl);
    }, "image/png");
  }

  // ---- render ----

  const { rects, maxDepth } = treemapData;
  const leafRects = rects.filter((r) => r.isLeaf && r.node.isTaxon);
  const internalRects = [...rects].filter((r) => !r.isLeaf).sort((a, b) => a.depth - b.depth);
  const legendEntries = showLegend ? buildLegendEntries() : [];

  const fontSize = 7;
  const minImg = 6;
  const baseScale = Math.min(VIEW_W / TREEMAP_W, VIEW_H / TREEMAP_H);

  return (
    <div className="subtree-overlay">
      <div className="subtree-panel">
        <div className="subtree-header">
          <h3>Treemap</h3>
          <div className="subtree-header-actions">
            <button className="subtree-copy-btn" onClick={() => { resetZoom(); onBack(); }}>
              🌳 Back to tree
            </button>
            <button className="subtree-copy-btn" onClick={handleSaveSvg} title="Save treemap as SVG">💾 SVG</button>
            <button className="subtree-copy-btn" onClick={handleSavePng} title="Save treemap as high-resolution PNG">💾 PNG</button>
            <button className="subtree-copy-btn" onClick={() => setZoom((z) => Math.min(10, z * 1.3))} title="Zoom in">➕</button>
            <button className="subtree-copy-btn" onClick={() => { const nz = Math.max(1, zoom * 0.77); setZoom(nz); setPan((p) => clampPan(p.x, p.y, nz)); }} title="Zoom out">➖</button>
            <button className="subtree-copy-btn" onClick={resetZoom} title="Reset zoom">↺</button>
            <label className="maze-size-label">
              <input type="checkbox" checked={showLegend} onChange={(e) => setShowLegend(e.target.checked)} />
              Legend
            </label>
            <label className="maze-size-label">
              <input type="checkbox" checked={showUniqNames} onChange={(e) => setShowUniqNames(e.target.checked)} />
              Unique names
            </label>
            <button className="subtree-close" aria-label="Close" onClick={onClose}>✕</button>
          </div>
        </div>
        <div className="subtree-content">
          <div
            className="treemap-viewport"
            style={{ width: VIEW_W, height: VIEW_H }}
            onWheel={handleWheel}
            onPointerDown={handlePointerDown}
            onPointerMove={handlePointerMove}
            onPointerUp={handlePointerUp}
            onPointerCancel={handlePointerUp}
            onTouchStart={handleTouchStart}
            onTouchMove={handleTouchMove}
            onTouchEnd={handleTouchEnd}
            onTouchCancel={handleTouchEnd}
          >
            <svg
              ref={svgRef}
              className="treemap-svg"
              width={TREEMAP_W}
              height={TREEMAP_H}
              viewBox={`0 0 ${TREEMAP_W} ${TREEMAP_H}`}
              style={{
                transform: `scale(${baseScale * zoom}) translate(${pan.x / (baseScale * zoom)}px, ${pan.y / (baseScale * zoom)}px)`,
                transformOrigin: "0 0",
              }}
            >
              {/* Internal rects (parents behind children) */}
              {internalRects.map((r, i) => (
                <rect
                  key={`i-${i}`}
                  x={r.x0} y={r.y0}
                  width={r.x1 - r.x0} height={r.y1 - r.y0}
                  fill={depthColor(r.depth, maxDepth)}
                  stroke="#fff" strokeWidth={1} opacity={0.6}
                />
              ))}
              {/* Leaf taxa: label → image → dot fallback */}
              {leafRects.map((r) => {
                const sp = taxaByOttId.get(r.node.ott_id);
                const rw = r.x1 - r.x0;
                const rh = r.y1 - r.y0;
                const cx = r.x0 + rw / 2;
                const cy = r.y0 + rh / 2;
                const dn = displayName(r.node);
                const rep = cellRep(dn, rw, rh, fontSize, minImg);

                if (rep === "dot") {
                  const dotR = Math.max(1, Math.min(rw, rh) * 0.3);
                  return (
                    <circle
                      key={r.node.ott_id ?? `t-${r.x0}-${r.y0}`}
                      cx={cx} cy={cy} r={dotR}
                      fill={sp?.image_url ? "#e07020" : "#888"}
                    />
                  );
                }

                if (rep === "img") {
                  const imgS = Math.min(rw, rh) * 0.85;
                  return (
                    <g key={r.node.ott_id ?? `t-${r.x0}-${r.y0}`}>
                      {sp?.image_url ? (
                        <image
                          href={sp.image_url}
                          x={cx - imgS / 2} y={cy - imgS / 2}
                          width={imgS} height={imgS}
                          clipPath="inset(0 round 2px)"
                        />
                      ) : (
                        <circle cx={cx} cy={cy} r={imgS / 2} fill="#e07020" />
                      )}
                    </g>
                  );
                }

                // label-h or label-v
                const fit = rep === "label-h" ? "h" : "v";
                const imgS = Math.min(rw, rh, 20) * 0.6;
                const showImg = fit === "h" && imgS + 11 <= rh;
                return (
                  <g key={r.node.ott_id ?? `t-${r.x0}-${r.y0}`}>
                    {showImg && (
                      sp?.image_url ? (
                        <image
                          href={sp.image_url}
                          x={cx - imgS / 2} y={cy - imgS / 2 - 4}
                          width={imgS} height={imgS}
                          clipPath="inset(0 round 3px)"
                        />
                      ) : (
                        <circle cx={cx} cy={cy - 4} r={imgS / 2} fill="#e07020" />
                      )
                    )}
                    <text
                      x={cx}
                      y={showImg ? cy + imgS / 2 + 4 : cy}
                      textAnchor="middle"
                      dominantBaseline={showImg ? undefined : "central"}
                      className="treemap-label"
                      transform={fit === "v" ? `rotate(-90,${cx},${cy})` : undefined}
                      style={showUniqNames ? { textTransform: "none" } : undefined}
                    >
                      {dn}
                    </text>
                  </g>
                );
              })}
            </svg>
          </div>
          {showLegend && legendEntries.length > 0 && (
            <div className="maze-legend">
              {legendEntries.map((e) => (
                <div key={e.ottId} className="maze-legend-item">
                  {e.imageUrl ? (
                    <img src={e.imageUrl} alt={e.name} className="maze-legend-img" />
                  ) : (
                    <span className="maze-legend-circle" />
                  )}
                  <span className="maze-legend-name" style={showUniqNames ? { textTransform: "none" } : undefined}>{e.name}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
