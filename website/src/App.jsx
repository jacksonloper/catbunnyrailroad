import { useState, useMemo, useRef, useEffect, useCallback } from "react";
import { Link, useSearchParams, useNavigate } from "react-router-dom";
import taxa from "./data/taxa.json";
import tree from "./data/tree.json";
import MazeWorker from "./mazeWorker.js?worker";
import { capitalize, extractSubtree, renderTreeAscii } from "./treeUtils.js";
import { buildTrie } from "./trieUtils.js";
import Autocomplete from "./Autocomplete.jsx";
import Navbar from "./Navbar.jsx";
import "./App.css";

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

// ---------------------------------------------------------------------------
// Tree utilities – work with the compact tree JSON
// ---------------------------------------------------------------------------

/** Collect the names of all taxa (isTaxon nodes) under a tree node */
function getTaxa(node) {
  let result = [];
  if (node.isTaxon) result.push(node.name);
  for (const child of node.children) {
    result = result.concat(getTaxa(child));
  }
  return result;
}

/** Find the path from root to the node with the given ott_id */
function findPath(node, ottId, path = []) {
  const current = [...path, node];
  if (node.ott_id === ottId) return current;
  for (const child of node.children) {
    const result = findPath(child, ottId, current);
    if (result) return result;
  }
  return null;
}

/** Find the path from root to a specific internal node (by reference) */
function findNodePath(root, target, path = []) {
  const current = [...path, root];
  if (root === target) return current;
  for (const child of root.children) {
    const result = findNodePath(child, target, current);
    if (result) return result;
  }
  return null;
}

/** Find the MRCA node for N taxa (by ott_id) */
function findMRCAMultiple(treeRoot, ottIds) {
  if (ottIds.length === 0) return null;
  const paths = ottIds.map((id) => findPath(treeRoot, id)).filter(Boolean);
  if (paths.length < 2) return null;

  let mrca = treeRoot;
  const minLen = Math.min(...paths.map((p) => p.length));
  for (let i = 0; i < minLen; i++) {
    if (paths.every((p) => p[i] === paths[0][i])) mrca = paths[0][i];
    else break;
  }
  return mrca;
}

// ---------------------------------------------------------------------------
// Components
// ---------------------------------------------------------------------------

// Build a lookup map for taxa data by name
const taxaByName = new Map(taxa.map((t) => [t.name, t]));
const taxaByOttId = new Map(taxa.map((t) => [t.ott_id, t]));

/* ───── preset lists ───── */

const PRESET_LISTS = [
  {
    label: "Herbs & Spices",
    ottIds: [
      305911, 305918, 61897, 907458, 778824, 820645, 382249, 382237, 378039,
      498475, 2476, 2485, 105027, 1070795, 571537, 27827, 355945, 880695,
      830200, 130944, 321836, 501622, 626975, 748370, 781600, 1063866, 168258,
      1063872, 792711, 472526, 97780, 311088, 473836, 473831, 216347, 833635,
      309279, 359058, 961856, 498463, 671429, 2472, 1007994, 142360, 542824,
      713007, 481247, 130603, 200286, 1011084,
    ],
  },
  {
    label: "Underwater Creatures",
    ottIds: [
      951293, 753585, 5342311, 568126, 373931, 983579, 641212, 555379, 80121,
      478542, 451009, 169168, 511973, 176550, 1067466, 78477, 833188, 199334,
      698406, 243396,
    ],
  },
];

// ---------------------------------------------------------------------------
// Clade helpers – find a tree node by ott_id, collect descendant taxa names,
// and precompute descendant-taxa counts so we know which taxa have ≥2
// descendants in the curated list.
// ---------------------------------------------------------------------------

/** Find a node in the full tree by ott_id */
function findNodeByOttId(node, ottId) {
  if (node.ott_id === ottId) return node;
  for (const child of node.children) {
    const result = findNodeByOttId(child, ottId);
    if (result) return result;
  }
  return null;
}

/** Collect names of all taxa.json entries that are descendants of a tree node */
function collectTaxaNames(node) {
  let names = [];
  if (taxaByOttId.has(node.ott_id)) names.push(taxaByOttId.get(node.ott_id).name);
  for (const child of node.children) {
    names = names.concat(collectTaxaNames(child));
  }
  return names;
}

/** Precompute: for each taxon in taxa.json, how many curated taxa are in its subtree */
const descendantTaxaCounts = (() => {
  const counts = new Map();
  function walk(node) {
    let count = taxaByOttId.has(node.ott_id) ? 1 : 0;
    for (const child of node.children) count += walk(child);
    if (taxaByOttId.has(node.ott_id)) counts.set(node.ott_id, count);
    return count;
  }
  walk(tree);
  return counts;
})();

const OUTSIDE_PAGE_SIZE = 20;
const INGROUP_PAGE_SIZE = 20;

// ---------------------------------------------------------------------------
// SVG tree layout – topology-only cladogram (no internal labels)
// ---------------------------------------------------------------------------

/** Collect all taxa OTT IDs from a subtree node */
function collectSubtreeOtts(node) {
  let result = [];
  if (node.isTaxon) result.push(node.ott_id);
  for (const child of node.children) {
    result = result.concat(collectSubtreeOtts(child));
  }
  return result;
}

/** Compute max depth (number of edges from root to deepest leaf) */
function maxDepth(node) {
  if (node.children.length === 0) return 0;
  return 1 + Math.max(...node.children.map(maxDepth));
}

/**
 * Layout the tree for SVG rendering.
 * Returns { nodes: [{x, y, node, isLeaf}], edges: [{x1,y1,x2,y2}] }
 *
 * Every user-selected taxon (isTaxon node) gets its own sequential y-line,
 * whether it is a leaf or an internal node.  Non-taxon internal nodes are
 * vertically placed at the average of their descendant taxa positions.
 */
function layoutTree(root) {
  const depth = maxDepth(root);
  const hSpacing = 32; // horizontal pixels per depth level
  const vSpacing = 28; // vertical pixels per taxon row
  const nodes = [];
  const edges = [];
  let lineIndex = 0;

  function walk(node, d) {
    const x = d * hSpacing;

    if (node.children.length === 0) {
      // Leaf – always gets its own line
      const y = lineIndex * vSpacing;
      lineIndex++;
      nodes.push({ x, y, node, isLeaf: true });
      return y;
    }

    if (node.isTaxon) {
      // Internal taxon – gets its own line, then walk children
      const selfY = lineIndex * vSpacing;
      lineIndex++;
      node.children.forEach((c) => walk(c, d + 1));
      nodes.push({ x, y: selfY, node, isLeaf: false });
      return selfY;
    }

    // Non-taxon internal – avg of children
    const childYs = node.children.map((c) => walk(c, d + 1));
    const y = childYs.reduce((a, b) => a + b, 0) / childYs.length;
    nodes.push({ x, y, node, isLeaf: false });
    return y;
  }

  walk(root, 0);

  // Build edge list from laid-out node positions
  function buildEdges(node) {
    if (node.children.length === 0) return;
    const parentInfo = nodes.find((n) => n.node === node);
    if (!parentInfo) return;
    const childInfos = node.children.map((c) => nodes.find((n) => n.node === c));
    const validChildren = childInfos.filter(Boolean);
    if (validChildren.length === 0) return;

    // Vertical line at parent x – include parent y so that taxon internal
    // nodes that sit above/below their children are properly connected.
    const ys = [...validChildren.map((c) => c.y), parentInfo.y];
    const minY = Math.min(...ys);
    const maxY = Math.max(...ys);
    edges.push({ x1: parentInfo.x, y1: minY, x2: parentInfo.x, y2: maxY });

    // Horizontal lines to each child
    for (const ci of validChildren) {
      edges.push({ x1: parentInfo.x, y1: ci.y, x2: ci.x, y2: ci.y });
    }

    for (const child of node.children) {
      buildEdges(child);
    }
  }
  buildEdges(root);

  return { nodes, edges, leafCount: lineIndex, hSpacing, vSpacing, depth };
}

function isValidMazeSize(text) {
  if (!/^\s*\d+\s*$/.test(text)) return false;
  const v = parseInt(text, 10);
  return v >= 3 && v <= 50;
}

function countTreeNodes(node) {
  if (!node.children || node.children.length === 0) return 1;
  return 1 + node.children.reduce((s, c) => s + countTreeNodes(c), 0);
}

function SubtreeView({ subtree, onClose }) {
  const navigate = useNavigate();
  const [copied, setCopied] = useState(false);
  const [copiedJson, setCopiedJson] = useState(false);
  const [copiedLink, setCopiedLink] = useState(false);
  const [activeComment, setActiveComment] = useState(null); // ott_id of open comment
  const [showMaze, setShowMaze] = useState(false);
  const [showUniqNames, setShowUniqNames] = useState(false);
  const defaultMazeSize = useMemo(() => {
    const n = countTreeNodes(subtree);
    // Heuristic: grid needs ~3× the tree nodes to have room for paths
    return Math.max(5, Math.ceil(Math.sqrt(n * 3)));
  }, [subtree]);
  const [mazeSizeText, setMazeSizeText] = useState(() => String(defaultMazeSize));
  const [mazeData, setMazeData] = useState(null);
  const [mazeError, setMazeError] = useState("");
  const [mazeLoading, setMazeLoading] = useState(false);
  const [mazeWallView, setMazeWallView] = useState(false);
  const [showLegend, setShowLegend] = useState(false);
  const treeSvgRef = useRef(null);
  const workerRef = useRef(null);

  // Cancel any in-flight worker
  const cancelWorker = useCallback(() => {
    if (workerRef.current) {
      workerRef.current.terminate();
      workerRef.current = null;
    }
    setMazeLoading(false);
  }, []);

  /** Return the display name for a taxon node, respecting the uniqname toggle */
  function displayName(node) {
    if (showUniqNames) {
      const sp = taxaByOttId.get(node.ott_id);
      if (sp?.uniqname) return sp.uniqname;
    }
    return node.name;
  }

  // Start a maze attempt: generate random spanning tree + check embedding
  const handleTryMaze = useCallback(() => {
    const m = parseInt(mazeSizeText, 10);
    if (!isValidMazeSize(mazeSizeText)) return;

    cancelWorker();
    setMazeData(null);
    setMazeError("");
    setMazeLoading(true);

    const worker = new MazeWorker();
    workerRef.current = worker;

    worker.onmessage = (e) => {
      workerRef.current = null;
      setMazeLoading(false);
      const { result, attempts } = e.data;
      if (result) {
        setMazeData(result);
      } else {
        setMazeError(`Could not embed tree after ${attempts} attempt${attempts === 1 ? "" : "s"}. Try again or increase size.`);
      }
    };

    worker.onerror = () => {
      workerRef.current = null;
      setMazeLoading(false);
      setMazeError("Maze generation failed unexpectedly.");
    };

    worker.postMessage({ subtree, mazeSize: m });
  }, [mazeSizeText, subtree, cancelWorker]);

  // Cleanup worker on unmount
  useEffect(() => () => cancelWorker(), [cancelWorker]);

  const layout = useMemo(() => layoutTree(subtree), [subtree]);
  const taxaNodes = layout.nodes.filter((n) => n.node.isTaxon);
  const ottIds = useMemo(() => collectSubtreeOtts(subtree), [subtree]);

  const labelOffset = 8;
  const imgSize = 20;
  const pxPerChar = 7;      // approximate character width for label measurement
  const starPad = 30;       // extra right padding for comment stars
  // Measure longest label to set SVG width
  const maxLabelLen = taxaNodes.length > 0 ? Math.max(...taxaNodes.map((l) => displayName(l.node).length)) : 0;
  const rightPad = maxLabelLen * pxPerChar + imgSize + labelOffset + starPad;
  const svgWidth = (layout.depth + 1) * layout.hSpacing + rightPad;
  const svgHeight = layout.leafCount * layout.vSpacing;

  /** Enrich subtree with comments for JSON export */
  function enrichWithComments(node) {
    const result = { name: node.name, ott_id: node.ott_id, children: (node.children || []).map(enrichWithComments) };
    if (node.isTaxon) result.isTaxon = true;
    const sp = taxaByOttId.get(node.ott_id);
    if (sp?.comments) result.comments = sp.comments;
    return result;
  }

  function copyToClipboard(text, onSuccess) {
    navigator.clipboard.writeText(text).then(onSuccess).catch(() => {
      const ta = document.createElement("textarea");
      ta.value = text;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand("copy");
      document.body.removeChild(ta);
      onSuccess();
    });
  }

  function handleCopy() {
    copyToClipboard(ottIds.join(","), () => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }

  function handleCopyJson() {
    const enriched = enrichWithComments(subtree);
    copyToClipboard(JSON.stringify(enriched, null, 2), () => {
      setCopiedJson(true);
      setTimeout(() => setCopiedJson(false), 2000);
    });
  }

  function handleCopyLink() {
    copyToClipboard(window.location.href, () => {
      setCopiedLink(true);
      setTimeout(() => setCopiedLink(false), 2000);
    });
  }

  async function handleSaveTreePng() {
    const svgEl = treeSvgRef.current;
    if (!svgEl) return;

    // Use the same dimensions as the on-screen SVG
    const vbParts = svgEl.getAttribute("viewBox").split(/\s+/).map(Number);
    const vbX = vbParts[0], vbY = vbParts[1], vbW = vbParts[2], vbH = vbParts[3];

    // 300 DPI × 8.5 inches = 2550 px on the long side
    const printPx = 2550;
    const scale = printPx / Math.max(vbW, vbH);
    const canvasW = Math.round(vbW * scale);
    const canvasH = Math.round(vbH * scale);

    // Fetch unique images
    const uniqueUrls = new Set();
    for (const l of taxaNodes) {
      const sp = taxaByOttId.get(l.node.ott_id);
      if (sp?.image_url) uniqueUrls.add(sp.image_url);
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

    // White background
    ctx.fillStyle = "white";
    ctx.fillRect(0, 0, canvasW, canvasH);

    // Translate so viewBox origin is at (0,0) on canvas
    ctx.save();
    ctx.translate(-vbX * scale, -vbY * scale);

    // Draw edges
    ctx.strokeStyle = "#666";
    ctx.lineWidth = 1.5 * scale;
    for (const e of layout.edges) {
      ctx.beginPath();
      ctx.moveTo(e.x1 * scale, e.y1 * scale);
      ctx.lineTo(e.x2 * scale, e.y2 * scale);
      ctx.stroke();
    }

    // Draw taxa labels and images
    for (const l of taxaNodes) {
      const sp = taxaByOttId.get(l.node.ott_id);
      const dn = displayName(l.node);

      // Draw image if available
      if (sp?.image_url) {
        const bitmap = bitmaps.get(sp.image_url);
        if (bitmap) {
          const imgX = (l.x + labelOffset) * scale;
          const imgY = (l.y - imgSize / 2) * scale;
          const imgW = imgSize * scale;
          const imgH = imgSize * scale;
          ctx.save();
          ctx.beginPath();
          traceRoundedRect(ctx, imgX, imgY, imgW, imgH, 4 * scale);
          ctx.clip();
          ctx.drawImage(bitmap, imgX, imgY, imgW, imgH);
          ctx.restore();
        }
      }

      // Draw label
      const textX = (l.x + labelOffset + (sp?.image_url ? imgSize + 4 : 0)) * scale;
      const textY = l.y * scale;
      ctx.font = `600 ${0.85 * 16 * scale}px sans-serif`;
      ctx.fillStyle = "#222";
      ctx.textBaseline = "middle";
      ctx.fillText(showUniqNames ? dn : capitalize(dn), textX, textY);
    }

    ctx.restore();

    canvas.toBlob((pngBlob) => {
      if (!pngBlob) return;
      const url = URL.createObjectURL(pngBlob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "tree.png";
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    }, "image/png");
  }

  /** Export the current subtree as an ASCII art text file */
  function handleSaveTreeAscii() {
    if (!subtree) return;

    const text = renderTreeAscii(subtree, {
      taxaByOttId,
      useUniqNames: showUniqNames,
    });
    const blob = new Blob([text], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "tree.txt";
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }

  const activeCommentData = activeComment != null ? taxaByOttId.get(activeComment) : null;

  /** Compute wall segments for the dual "wall view" of the maze */
  function computeWallSegments(data, cs) {
    const { width: gw, height: gh, mazeEdges } = data;
    // Build set of passage keys
    const passageSet = new Set();
    for (const e of mazeEdges) {
      const key = `${Math.min(e.from.y, e.to.y)},${Math.min(e.from.x, e.to.x)}-${Math.max(e.from.y, e.to.y)},${Math.max(e.from.x, e.to.x)}`;
      passageSet.add(key);
    }
    const segs = [];
    // Internal vertical walls (between (r,c) and (r,c+1))
    for (let r = 0; r < gh; r++) {
      for (let c = 0; c < gw - 1; c++) {
        const key = `${r},${c}-${r},${c + 1}`;
        if (!passageSet.has(key)) {
          segs.push({ x1: (c + 1) * cs, y1: r * cs, x2: (c + 1) * cs, y2: (r + 1) * cs });
        }
      }
    }
    // Internal horizontal walls (between (r,c) and (r+1,c))
    for (let r = 0; r < gh - 1; r++) {
      for (let c = 0; c < gw; c++) {
        const key = `${r},${c}-${r + 1},${c}`;
        if (!passageSet.has(key)) {
          segs.push({ x1: c * cs, y1: (r + 1) * cs, x2: (c + 1) * cs, y2: (r + 1) * cs });
        }
      }
    }
    // Outer boundary
    const W = gw * cs, H = gh * cs;
    segs.push({ x1: 0, y1: 0, x2: W, y2: 0 });
    segs.push({ x1: 0, y1: H, x2: W, y2: H });
    segs.push({ x1: 0, y1: 0, x2: 0, y2: H });
    segs.push({ x1: W, y1: 0, x2: W, y2: H });
    return segs;
  }

  /** Build legend entries for the maze taxa.  When two taxa share the same
   *  image_url they are given distinct single-letter labels so the legend
   *  remains unambiguous.  Returns an array of { name, imageUrl, label }
   *  objects sorted by name.  `label` is null when no disambiguation is needed.
   */
  function buildLegendEntries() {
    if (!mazeData) return [];
    const taxaPlacements = mazeData.placements.filter((p) => p.node?.isTaxon);

    // Gather entries with image URLs
    const entries = taxaPlacements.map((p) => {
      const sp = taxaByOttId.get(p.node.ott_id);
      return { name: displayName(p.node), imageUrl: sp?.image_url || null, ottId: p.node.ott_id };
    });

    // Detect duplicated image URLs
    const urlCounts = new Map();
    for (const e of entries) {
      if (e.imageUrl) urlCounts.set(e.imageUrl, (urlCounts.get(e.imageUrl) || 0) + 1);
    }

    // Assign letter labels to taxa that share an image
    let nextLabel = 0;
    const urlLabels = new Map(); // imageUrl → Map<ottId, letter>
    for (const e of entries) {
      if (e.imageUrl && urlCounts.get(e.imageUrl) > 1) {
        if (!urlLabels.has(e.imageUrl)) urlLabels.set(e.imageUrl, new Map());
        const group = urlLabels.get(e.imageUrl);
        if (!group.has(e.ottId)) {
          // A–Z, then AA, AB, …
          const lbl = nextLabel < 26
            ? String.fromCharCode(65 + nextLabel)
            : String.fromCharCode(65 + Math.floor(nextLabel / 26) - 1) + String.fromCharCode(65 + (nextLabel % 26));
          group.set(e.ottId, lbl);
          nextLabel++;
        }
      }
    }

    // Build final array – deduplicate by ottId
    const seen = new Set();
    const result = [];
    for (const e of entries) {
      if (seen.has(e.ottId)) continue;
      seen.add(e.ottId);
      const group = e.imageUrl && urlLabels.get(e.imageUrl);
      result.push({
        name: e.name,
        imageUrl: e.imageUrl,
        label: group ? group.get(e.ottId) : null,
        ottId: e.ottId,
      });
    }
    result.sort((a, b) => a.name.localeCompare(b.name));
    return result;
  }

  /** Map from ottId → label letter (or null) for maze marker overlays */
  function buildLabelMap() {
    const entries = buildLegendEntries();
    const map = new Map();
    for (const e of entries) {
      if (e.label) map.set(e.ottId, e.label);
    }
    return map;
  }

  /** Build a standalone SVG string for the current maze, styled for white-paper printing.
   *  @param {object} opts
   *  @param {boolean} [opts.omitImages] – replace images with circles (for PNG base layer)
   *  @param {Map<string,string>} [opts.imageDataUrls] – map of original URL → data-URL for standalone SVG
   *  @param {boolean} [opts.withLegend] – append an image:name legend below the maze
   */
  function buildPrintSvg({ omitImages = false, imageDataUrls, withLegend = false } = {}) {
    if (!mazeData) return null;
    const cellSize = 20;
    const w = mazeData.width * cellSize;
    const h = mazeData.height * cellSize;
    const taxaPlacements = mazeData.placements.filter((p) => p.node?.isTaxon);
    const labelMap = buildLabelMap();

    // Compute legend dimensions
    const legendEntries = withLegend ? buildLegendEntries() : [];
    const legendImgSize = 16;
    const legendRowH = 22;
    const legendPadTop = 12;
    const legendH = withLegend && legendEntries.length > 0
      ? legendPadTop + legendEntries.length * legendRowH + 4
      : 0;
    const totalH = h + legendH;

    const lines = [];
    lines.push(`<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="${w}" height="${totalH}" viewBox="0 0 ${w} ${totalH}">`);
    lines.push(`<rect width="${w}" height="${totalH}" fill="white"/>`);
    if (mazeWallView) {
      // Wall view: draw wall segments
      const walls = computeWallSegments(mazeData, cellSize);
      for (const s of walls) {
        lines.push(`<line x1="${s.x1}" y1="${s.y1}" x2="${s.x2}" y2="${s.y2}" stroke="#444" stroke-width="2" stroke-linecap="round"/>`);
      }
    } else {
      // Path view: draw passage edges
      for (const e of mazeData.mazeEdges) {
        lines.push(`<line x1="${(e.from.x + 0.5) * cellSize}" y1="${(e.from.y + 0.5) * cellSize}" x2="${(e.to.x + 0.5) * cellSize}" y2="${(e.to.y + 0.5) * cellSize}" stroke="#444" stroke-width="2" stroke-linecap="round"/>`);
      }
      for (const e of mazeData.edges) {
        lines.push(`<line x1="${(e.from.x + 0.5) * cellSize}" y1="${(e.from.y + 0.5) * cellSize}" x2="${(e.to.x + 0.5) * cellSize}" y2="${(e.to.y + 0.5) * cellSize}" stroke="#444" stroke-width="2" stroke-linecap="round"/>`);
      }
    }
    // Taxa markers
    for (const p of taxaPlacements) {
      const cx = (p.col + 0.5) * cellSize;
      const cy = (p.row + 0.5) * cellSize;
      const sp = taxaByOttId.get(p.node.ott_id);
      const imgUrl = sp?.image_url;
      const resolvedUrl = !omitImages && (imageDataUrls?.get(imgUrl) ?? imgUrl);
      if (resolvedUrl) {
        lines.push(`<image href="${resolvedUrl.replace(/&/g, "&amp;").replace(/"/g, "&quot;")}" x="${cx - 8}" y="${cy - 8}" width="16" height="16" clip-path="inset(0 round 3px)"/>`);
      } else {
        lines.push(`<circle cx="${cx}" cy="${cy}" r="5" fill="#e07020"/>`);
      }
      const lbl = labelMap.get(p.node.ott_id);
      if (lbl) {
        lines.push(`<text x="${cx + 7}" y="${cy - 5}" font-size="8" font-weight="bold" fill="#d04000" font-family="sans-serif">${lbl}</text>`);
      }
    }
    // Legend
    if (withLegend && legendEntries.length > 0) {
      const ly0 = h + legendPadTop;
      for (let i = 0; i < legendEntries.length; i++) {
        const e = legendEntries[i];
        const ry = ly0 + i * legendRowH;
        const resolvedUrl = !omitImages && e.imageUrl && (imageDataUrls?.get(e.imageUrl) ?? e.imageUrl);
        if (resolvedUrl) {
          lines.push(`<image href="${resolvedUrl.replace(/&/g, "&amp;").replace(/"/g, "&quot;")}" x="4" y="${ry}" width="${legendImgSize}" height="${legendImgSize}" clip-path="inset(0 round 3px)"/>`);
        } else {
          lines.push(`<circle cx="${4 + legendImgSize / 2}" cy="${ry + legendImgSize / 2}" r="5" fill="#e07020"/>`);
        }
        const capName = showUniqNames ? e.name : capitalize(e.name);
        const displayName = e.label ? `${e.label} – ${capName}` : capName;
        lines.push(`<text x="${4 + legendImgSize + 6}" y="${ry + legendImgSize / 2}" dominant-baseline="central" font-size="11" fill="#333" font-family="sans-serif">${displayName.replace(/&/g, "&amp;").replace(/</g, "&lt;")}</text>`);
      }
    }
    lines.push("</svg>");
    return lines.join("\n");
  }

  /** Fetch image URLs and convert to base64 data URLs for embedding in SVG/PNG exports. */
  async function fetchImageDataUrls() {
    const taxaPlacements = mazeData.placements.filter((p) => p.node?.isTaxon);
    const urls = new Set();
    for (const p of taxaPlacements) {
      const sp = taxaByOttId.get(p.node.ott_id);
      if (sp?.image_url) urls.add(sp.image_url);
    }
    const dataUrls = new Map();
    await Promise.all([...urls].map(async (srcUrl) => {
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
    return dataUrls;
  }

  async function handleSaveMazeSvg() {
    const imageDataUrls = await fetchImageDataUrls();
    const svgStr = buildPrintSvg({ imageDataUrls, withLegend: showLegend });
    if (!svgStr) return;
    const blob = new Blob([svgStr], { type: "image/svg+xml" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "maze.svg";
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  async function handleSaveMazePng() {
    if (!mazeData) return;

    const cellSize = 20;

    // 300 DPI × 8.5 inches = 2550 px on the long side
    const printPx = 2550;
    const svgW = mazeData.width * cellSize;
    const svgH = mazeData.height * cellSize;

    // Legend dimensions must match buildPrintSvg
    const legendEntries = showLegend ? buildLegendEntries() : [];
    const legendImgSize = 16;
    const legendRowH = 22;
    const legendPadTop = 12;
    const legendH = legendEntries.length > 0 ? legendPadTop + legendEntries.length * legendRowH + 4 : 0;
    const totalSvgH = svgH + legendH;

    const scale = printPx / Math.max(svgW, totalSvgH);
    const canvasW = Math.round(svgW * scale);
    const canvasH = Math.round(totalSvgH * scale);

    // Fetch all unique image URLs and create ImageBitmaps (never taints canvas)
    const taxaPlacements = mazeData.placements.filter((p) => p.node?.isTaxon);
    const labelMap = buildLabelMap();
    const uniqueUrls = new Set();
    for (const p of taxaPlacements) {
      const sp = taxaByOttId.get(p.node.ott_id);
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

    // Draw everything directly on canvas (avoids SVG-as-image taint issues)
    const canvas = document.createElement("canvas");
    canvas.width = canvasW;
    canvas.height = canvasH;
    const ctx = canvas.getContext("2d");

    ctx.fillStyle = "white";
    ctx.fillRect(0, 0, canvasW, canvasH);

    // Draw maze structure
    ctx.strokeStyle = "#444";
    ctx.lineWidth = 2 * scale;
    ctx.lineCap = "round";

    if (mazeWallView) {
      const walls = computeWallSegments(mazeData, cellSize);
      for (const s of walls) {
        ctx.beginPath();
        ctx.moveTo(s.x1 * scale, s.y1 * scale);
        ctx.lineTo(s.x2 * scale, s.y2 * scale);
        ctx.stroke();
      }
    } else {
      for (const e of mazeData.mazeEdges) {
        ctx.beginPath();
        ctx.moveTo((e.from.x + 0.5) * cellSize * scale, (e.from.y + 0.5) * cellSize * scale);
        ctx.lineTo((e.to.x + 0.5) * cellSize * scale, (e.to.y + 0.5) * cellSize * scale);
        ctx.stroke();
      }
      for (const e of mazeData.edges) {
        ctx.beginPath();
        ctx.moveTo((e.from.x + 0.5) * cellSize * scale, (e.from.y + 0.5) * cellSize * scale);
        ctx.lineTo((e.to.x + 0.5) * cellSize * scale, (e.to.y + 0.5) * cellSize * scale);
        ctx.stroke();
      }
    }

    // Draw taxa markers
    for (const p of taxaPlacements) {
      const cx = (p.col + 0.5) * cellSize * scale;
      const cy = (p.row + 0.5) * cellSize * scale;
      const sp = taxaByOttId.get(p.node.ott_id);
      const bitmap = sp?.image_url && bitmaps.get(sp.image_url);
      if (bitmap) {
        const imgX = cx - 8 * scale;
        const imgY = cy - 8 * scale;
        const imgW = 16 * scale;
        const imgH = 16 * scale;
        ctx.save();
        ctx.beginPath();
        traceRoundedRect(ctx, imgX, imgY, imgW, imgH, 3 * scale);
        ctx.clip();
        ctx.drawImage(bitmap, imgX, imgY, imgW, imgH);
        ctx.restore();
      } else {
        ctx.fillStyle = "#e07020";
        ctx.beginPath();
        ctx.arc(cx, cy, 5 * scale, 0, 2 * Math.PI);
        ctx.fill();
      }
      const lbl = labelMap.get(p.node.ott_id);
      if (lbl) {
        ctx.font = `bold ${8 * scale}px sans-serif`;
        ctx.fillStyle = "#d04000";
        ctx.textBaseline = "alphabetic";
        ctx.fillText(lbl, cx + 7 * scale, cy - 5 * scale);
      }
    }

    // Draw legend
    if (showLegend && legendEntries.length > 0) {
      for (let i = 0; i < legendEntries.length; i++) {
        const e = legendEntries[i];
        const ry = (svgH + legendPadTop + i * legendRowH) * scale;
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
        const displayName = e.label ? `${e.label} \u2013 ${capName}` : capName;
        ctx.font = `${11 * scale}px sans-serif`;
        ctx.fillStyle = "#333";
        ctx.textBaseline = "middle";
        ctx.fillText(displayName, (4 + legendImgSize + 6) * scale, ry + (legendImgSize / 2) * scale);
      }
    }

    canvas.toBlob((pngBlob) => {
      if (!pngBlob) return;
      const pngUrl = URL.createObjectURL(pngBlob);
      const a = document.createElement("a");
      a.href = pngUrl;
      a.download = "maze.png";
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(pngUrl);
    }, "image/png");
  }

  // ---- Maze view ----
  if (showMaze) {
    const cellSize = 20;

    return (
      <div className="subtree-overlay">
        <div className="subtree-panel">
          <div className="subtree-header">
            <h3>Maze</h3>
            <div className="subtree-header-actions">
              <label className="maze-size-label">
                Size:
                <input
                  type="text"
                  className={`maze-size-input${isValidMazeSize(mazeSizeText) ? "" : " maze-size-invalid"}`}
                  value={mazeSizeText}
                  onChange={(e) => setMazeSizeText(e.target.value)}
                  onBlur={() => { if (!isValidMazeSize(mazeSizeText)) setMazeSizeText(String(defaultMazeSize)); }}
                />
              </label>
              <button
                className="subtree-copy-btn"
                onClick={handleTryMaze}
                disabled={mazeLoading || !isValidMazeSize(mazeSizeText)}
                title="Generate a new random maze and try to embed the tree"
              >
                {mazeLoading ? "⏳ Working…" : "🎲 Try"}
              </button>
              <button
                className="subtree-copy-btn"
                onClick={() => { setShowMaze(false); cancelWorker(); setMazeData(null); setMazeError(""); }}
              >
                🌳 Back to tree
              </button>
              {mazeData && (
                <button
                  className="subtree-copy-btn"
                  onClick={handleSaveMazeSvg}
                  title="Save maze as SVG for printing"
                >
                  💾 SVG
                </button>
              )}
              {mazeData && (
                <button
                  className="subtree-copy-btn"
                  onClick={handleSaveMazePng}
                  title="Save maze as high-resolution PNG for printing"
                >
                  💾 PNG
                </button>
              )}
              {mazeData && (
                <label className="maze-size-label">
                  <input
                    type="checkbox"
                    checked={mazeWallView}
                    onChange={(e) => setMazeWallView(e.target.checked)}
                  />
                  Walls
                </label>
              )}
              {mazeData && (
                <label className="maze-size-label">
                  <input
                    type="checkbox"
                    checked={showLegend}
                    onChange={(e) => setShowLegend(e.target.checked)}
                  />
                  Legend
                </label>
              )}
              <label className="maze-size-label">
                <input
                  type="checkbox"
                  checked={showUniqNames}
                  onChange={(e) => setShowUniqNames(e.target.checked)}
                />
                Unique names
              </label>
              <button className="subtree-close" aria-label="Close" onClick={onClose}>✕</button>
            </div>
          </div>
          <div className="subtree-content">
            {!mazeData && !mazeLoading && !mazeError && (
              <p className="maze-hint">Pick a grid size and click 🎲 Try to generate a maze.</p>
            )}
            {mazeLoading && <p className="maze-loading">Generating maze…</p>}
            {mazeError && <p className="maze-error">{mazeError}</p>}
            {mazeData && (() => {
              const mazeSvgW = mazeData.width * cellSize;
              const mazeSvgH = mazeData.height * cellSize;
              const taxaPlacements = mazeData.placements.filter((p) => p.node?.isTaxon);
              const wallSegs = mazeWallView ? computeWallSegments(mazeData, cellSize) : null;
              const labelMap = showLegend ? buildLabelMap() : new Map();
              const legendEntries = showLegend ? buildLegendEntries() : [];
              return (
                <>
                <svg
                  className="maze-svg"
                  width={mazeSvgW}
                  height={mazeSvgH}
                  viewBox={`0 0 ${mazeSvgW} ${mazeSvgH}`}
                >
                  {mazeWallView ? (
                    /* Wall view */
                    wallSegs.map((s, i) => (
                      <line
                        key={`w-${i}`}
                        x1={s.x1} y1={s.y1} x2={s.x2} y2={s.y2}
                        className="maze-edge"
                      />
                    ))
                  ) : (
                    <>
                      {/* Maze passage edges */}
                      {mazeData.mazeEdges.map((e, i) => (
                        <line
                          key={`me-${i}`}
                          x1={(e.from.x + 0.5) * cellSize} y1={(e.from.y + 0.5) * cellSize}
                          x2={(e.to.x + 0.5) * cellSize} y2={(e.to.y + 0.5) * cellSize}
                          className="maze-edge"
                        />
                      ))}
                      {/* Embedded tree edges */}
                      {mazeData.edges.map((e, i) => (
                        <line
                          key={`e-${i}`}
                          x1={(e.from.x + 0.5) * cellSize} y1={(e.from.y + 0.5) * cellSize}
                          x2={(e.to.x + 0.5) * cellSize} y2={(e.to.y + 0.5) * cellSize}
                          className="maze-edge"
                        />
                      ))}
                    </>
                  )}
                  {/* Taxa markers (images) */}
                  {taxaPlacements.map((p) => {
                    const cx = (p.col + 0.5) * cellSize;
                    const cy = (p.row + 0.5) * cellSize;
                    const sp = taxaByOttId.get(p.node.ott_id);
                    const lbl = labelMap.get(p.node.ott_id);
                    return (
                      <g key={p.node.ott_id ?? `t-${p.row}-${p.col}`}>
                        {sp?.image_url ? (
                          <image
                            href={sp.image_url}
                            x={cx - 8}
                            y={cy - 8}
                            width={16}
                            height={16}
                            clipPath="inset(0 round 3px)"
                          />
                        ) : (
                          <circle cx={cx} cy={cy} r={5} fill="#e07020" />
                        )}
                        {lbl && (
                          <text
                            x={cx + 7} y={cy - 5}
                            fontSize="8" fontWeight="bold" fill="#d04000"
                            style={{ fontFamily: "sans-serif" }}
                          >
                            {lbl}
                          </text>
                        )}
                      </g>
                    );
                  })}
                </svg>
                {showLegend && legendEntries.length > 0 && (
                  <div className="maze-legend">
                    {legendEntries.map((e) => (
                      <div key={e.ottId} className="maze-legend-item">
                        {e.imageUrl ? (
                          <img src={e.imageUrl} alt={e.name} className="maze-legend-img" />
                        ) : (
                          <span className="maze-legend-circle" />
                        )}
                        <span className="maze-legend-name" style={showUniqNames ? { textTransform: "none" } : undefined}>{e.label ? `${e.label} – ${e.name}` : e.name}</span>
                      </div>
                    ))}
                  </div>
                )}
                </>
              );
            })()}
          </div>
        </div>
      </div>
    );
  }

  // ---- Normal tree view ----
  return (
    <div className="subtree-overlay">
      <div className="subtree-panel">
        <div className="subtree-header">
          <h3>Subtree</h3>
          <div className="subtree-header-actions">
            <button
              className="subtree-copy-btn"
              onClick={handleCopy}
              title="Copy OTT IDs to clipboard"
            >
              {copied ? "✓ Copied!" : "📋 Copy OTT IDs"}
            </button>
            <button
              className="subtree-copy-btn"
              onClick={handleCopyJson}
              title="Copy subtree JSON to clipboard"
            >
              {copiedJson ? "✓ Copied!" : "📋 Copy JSON"}
            </button>
            <button
              className="subtree-copy-btn"
              onClick={handleCopyLink}
              title="Copy shareable link to clipboard"
            >
              {copiedLink ? "✓ Copied!" : "🔗 Share"}
            </button>
            <button
              className="subtree-copy-btn"
              onClick={() => { setShowMaze(true); setMazeData(null); setMazeError(""); }}
              title="Show tree as a grid maze"
            >
              🔲 Maze
            </button>
            <button
              className="subtree-copy-btn"
              onClick={handleSaveTreePng}
              title="Save tree as high-resolution PNG"
            >
              💾 PNG
            </button>
            <button
              className="subtree-copy-btn"
              onClick={handleSaveTreeAscii}
              title="Save tree as ASCII text"
            >
              📄 ASCII
            </button>
            <label className="maze-size-label">
              <input
                type="checkbox"
                checked={showUniqNames}
                onChange={(e) => setShowUniqNames(e.target.checked)}
              />
              Unique names
            </label>
            <button className="subtree-close" aria-label="Close subtree view" onClick={onClose}>✕</button>
          </div>
        </div>
        <div className="subtree-content">
          <svg
            ref={treeSvgRef}
            className="subtree-svg"
            width={svgWidth}
            height={svgHeight + 10}
            viewBox={`-4 -${layout.vSpacing / 2} ${svgWidth + 8} ${svgHeight + layout.vSpacing}`}
          >
            {/* Edges */}
            {layout.edges.map((e, i) => (
              <line
                key={i}
                x1={e.x1}
                y1={e.y1}
                x2={e.x2}
                y2={e.y2}
                stroke="#666"
                strokeWidth={1.5}
              />
            ))}
            {/* Taxa labels (leaves and internal taxa) */}
            {taxaNodes.map((l) => {
              const sp = taxaByOttId.get(l.node.ott_id);
              const dn = displayName(l.node);
              const starX = l.x + labelOffset + (sp?.image_url ? imgSize + 4 : 0) + dn.length * pxPerChar + 4;
              const exploreX = starX + (sp?.comments ? pxPerChar + 4 : 0);
              return (
                <g key={l.node.ott_id ?? l.node.name}>
                  {sp?.image_url && (
                    <image
                      href={sp.image_url}
                      x={l.x + labelOffset}
                      y={l.y - imgSize / 2}
                      width={imgSize}
                      height={imgSize}
                      clipPath="inset(0 round 4px)"
                    />
                  )}
                  <text
                    x={l.x + labelOffset + (sp?.image_url ? imgSize + 4 : 0)}
                    y={l.y}
                    dominantBaseline="central"
                    className="subtree-leaf-label"
                    style={showUniqNames ? { textTransform: "none" } : undefined}
                  >
                    {dn}
                  </text>
                  {sp?.comments && (
                    <text
                      x={starX}
                      y={l.y}
                      dominantBaseline="central"
                      className="subtree-comment-star"
                      onClick={() => setActiveComment(activeComment === l.node.ott_id ? null : l.node.ott_id)}
                      style={{ cursor: "pointer" }}
                    >
                      ★
                    </text>
                  )}
                  {l.node.ott_id && (
                    <text
                      x={exploreX}
                      y={l.y}
                      dominantBaseline="central"
                      className="subtree-explore-icon"
                      onClick={() => navigate(`/explore/${l.node.ott_id}`)}
                      style={{ cursor: "pointer" }}
                    >
                      🔍
                    </text>
                  )}
                </g>
              );
            })}
          </svg>
          {activeCommentData?.comments && (
            <div className="subtree-comment-modal-overlay" onClick={() => setActiveComment(null)}>
              <div className="subtree-comment-modal" onClick={(e) => e.stopPropagation()}>
                <h4>{activeCommentData.name}</h4>
                <p>{activeCommentData.comments}</p>
                <button onClick={() => setActiveComment(null)}>Close</button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Error console – captures console.error/warn and shows them in a floating
// red overlay so mobile users can see what's going wrong.
// ---------------------------------------------------------------------------

function ErrorConsole() {
  const [messages, setMessages] = useState([]);
  const nextId = useRef(0);

  useEffect(() => {
    const origError = console.error;
    const origWarn = console.warn;

    function push(level, args) {
      const text = Array.from(args)
        .map((a) => {
          if (typeof a === "string") return a;
          try { return JSON.stringify(a); } catch { return String(a); }
        })
        .join(" ");
      const id = nextId.current++;
      // Keep at most 20 messages
      setMessages((prev) => [...prev.slice(-19), { id, level, text }]);
    }

    console.error = function (...args) {
      origError.apply(console, args);
      push("error", args);
    };
    console.warn = function (...args) {
      origWarn.apply(console, args);
      push("warn", args);
    };

    function onError(e) {
      push("error", [e.message || String(e)]);
    }
    function onRejection(e) {
      push("error", ["Unhandled: " + (e.reason?.message || String(e.reason))]);
    }
    window.addEventListener("error", onError);
    window.addEventListener("unhandledrejection", onRejection);

    return () => {
      console.error = origError;
      console.warn = origWarn;
      window.removeEventListener("error", onError);
      window.removeEventListener("unhandledrejection", onRejection);
    };
  }, []);

  function dismiss(id) {
    setMessages((prev) => prev.filter((m) => m.id !== id));
  }

  if (messages.length === 0) return null;

  return (
    <div className="error-console">
      <div className="error-console-header">
        <span>⚠ Console</span>
        <button onClick={() => setMessages([])}>Clear</button>
      </div>
      <div className="error-console-body">
        {messages.map((m) => (
          <div key={m.id} className={`error-console-msg error-console-${m.level}`}>
            <span className="error-console-text">{m.text}</span>
            <button className="error-console-dismiss" onClick={() => dismiss(m.id)}>✕</button>
          </div>
        ))}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main App
// ---------------------------------------------------------------------------

/** Parse URL search params to determine initial selection state */
function parseUrlParams(searchParams) {
  const cladeParam = searchParams.get("clade");
  const taxaParam = searchParams.get("taxa");

  if (cladeParam) {
    const ottId = parseInt(cladeParam, 10);
    if (!isNaN(ottId)) {
      const node = findNodeByOttId(tree, ottId);
      if (node) {
        const names = collectTaxaNames(node);
        if (names.length >= 2) return { organisms: new Set(names), showTree: true };
      }
    }
  } else if (taxaParam) {
    const ids = taxaParam
      .split(",")
      .map((s) => parseInt(s.trim(), 10))
      .filter((n) => !isNaN(n));
    const names = new Set();
    for (const id of ids) {
      const sp = taxaByOttId.get(id);
      if (sp) names.add(sp.name);
    }
    if (names.size >= 2) return { organisms: names, showTree: true };
  }
  return { organisms: new Set(), showTree: false };
}

function App() {
  const [searchParams] = useSearchParams();
  const trie = useMemo(() => buildTrie(taxa), []);

  // Parse URL params on mount (supports navigation from ExplorePage with ?clade= or ?taxa=)
  const urlInit = useMemo(() => parseUrlParams(searchParams), [searchParams]);

  // Central list state
  const [listInput, setListInput] = useState("");
  const [selectedOrganisms, setSelectedOrganisms] = useState(urlInit.organisms);

  // Display state
  const [showIncluded, setShowIncluded] = useState(true);
  const [showOutside, setShowOutside] = useState(true);
  const [inGroupLimit, setInGroupLimit] = useState(INGROUP_PAGE_SIZE);
  const [outsideLimit, setOutsideLimit] = useState(OUTSIDE_PAGE_SIZE);
  const [showSubtree, setShowSubtree] = useState(urlInit.showTree);
  const [showImport, setShowImport] = useState(false);
  const [importText, setImportText] = useState("");
  const [importError, setImportError] = useState("");

  // When URL params change (e.g. navigating from ExplorePage), sync state
  const [prevUrlInit, setPrevUrlInit] = useState(urlInit);
  if (urlInit !== prevUrlInit) {
    setPrevUrlInit(urlInit);
    if (urlInit.organisms.size > 0) {
      setSelectedOrganisms(urlInit.organisms);
      setShowSubtree(urlInit.showTree);
    }
  }

  // Compute OTT IDs from the list
  const listOttIds = useMemo(() => {
    const ids = [];
    for (const name of selectedOrganisms) {
      const sp = taxaByName.get(name);
      if (sp) ids.push(sp.ott_id);
    }
    return ids;
  }, [selectedOrganisms]);

  // Compute MRCA from the list (needs 2+)
  const mrcaNode = useMemo(() => {
    if (listOttIds.length < 2) return null;
    return findMRCAMultiple(tree, listOttIds);
  }, [listOttIds]);

  // In-group: all taxa under the MRCA
  const cladeSpecies = useMemo(() => {
    if (!mrcaNode) return [];
    return getTaxa(mrcaNode);
  }, [mrcaNode]);

  // Outside species sorted by distance from MRCA
  const outsideSpecies = useMemo(() => {
    if (!mrcaNode || !cladeSpecies.length) return [];

    const cladeSet = new Set(cladeSpecies);
    const pathToMRCA = findNodePath(tree, mrcaNode);
    if (!pathToMRCA) return [];
    const mrcaIdx = pathToMRCA.length - 1;

    const results = [];
    for (const sp of taxa) {
      if (cladeSet.has(sp.name)) continue;

      const pathToSpecies = findPath(tree, sp.ott_id);
      if (!pathToSpecies) continue;

      // Find where the paths diverge
      let divergeIdx = 0;
      for (let i = 0; i < Math.min(pathToMRCA.length, pathToSpecies.length); i++) {
        if (pathToMRCA[i] === pathToSpecies[i]) divergeIdx = i;
        else break;
      }

      const height = mrcaIdx - divergeIdx;
      results.push({ name: sp.name, ott_id: sp.ott_id, height });
    }

    results.sort((a, b) => a.height - b.height);
    return results;
  }, [mrcaNode, cladeSpecies]);

  // Build subtree from selected organisms
  const subtree = useMemo(() => {
    if (!showSubtree || selectedOrganisms.size < 2) return null;
    const ottIds = new Set();
    for (const name of selectedOrganisms) {
      const sp = taxaByName.get(name);
      if (sp) ottIds.add(sp.ott_id);
    }
    if (ottIds.size < 2) return null;
    return extractSubtree(tree, ottIds);
  }, [showSubtree, selectedOrganisms]);

  function addToList(sp) {
    setSelectedOrganisms((prev) => {
      const next = new Set(prev);
      next.add(sp.name);
      return next;
    });
    setListInput("");
    setInGroupLimit(INGROUP_PAGE_SIZE);
    setOutsideLimit(OUTSIDE_PAGE_SIZE);
  }

  function removeFromList(name) {
    setSelectedOrganisms((prev) => {
      const next = new Set(prev);
      next.delete(name);
      return next;
    });
    setInGroupLimit(INGROUP_PAGE_SIZE);
    setOutsideLimit(OUTSIDE_PAGE_SIZE);
  }

  function toggleOrganism(name) {
    setSelectedOrganisms((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
    setInGroupLimit(INGROUP_PAGE_SIZE);
    setOutsideLimit(OUTSIDE_PAGE_SIZE);
  }

  function handleImportTree() {
    const ids = importText
      .split(/[\s,]+/)
      .map((s) => parseInt(s.trim(), 10))
      .filter((n) => !isNaN(n) && n > 0);
    if (ids.length < 2) {
      setImportError("Please enter at least 2 valid OTT IDs.");
      return;
    }
    // Match OTT IDs to taxa names
    const names = new Set();
    for (const id of ids) {
      const sp = taxaByOttId.get(id);
      if (sp) names.add(sp.name);
    }
    if (names.size < 2) {
      setImportError(`Only ${names.size} of the entered OTT IDs matched known organisms. Need at least 2.`);
      return;
    }
    setImportError("");
    setSelectedOrganisms(names);
    setShowSubtree(true);
    setShowImport(false);
    setImportText("");
    // Update URL for the imported taxa
    const validIds = [...names].map((n) => taxaByName.get(n)?.ott_id).filter(Boolean);
    const url = new URL(window.location);
    url.search = "";
    url.searchParams.set("taxa", validIds.join(","));
    window.history.replaceState({}, "", url);
  }

  function handleClearList() {
    setSelectedOrganisms(new Set());
    setShowSubtree(false);
    setListInput("");
    const url = new URL(window.location);
    url.search = "";
    window.history.replaceState({}, "", url);
  }

  function handlePresetSelect(e) {
    const idx = parseInt(e.target.value, 10);
    e.target.value = "";
    if (isNaN(idx) || idx < 0 || idx >= PRESET_LISTS.length) return;
    const preset = PRESET_LISTS[idx];
    const names = new Set();
    for (const id of preset.ottIds) {
      const sp = taxaByOttId.get(id);
      if (sp) names.add(sp.name);
    }
    if (names.size < 2) return;
    setSelectedOrganisms(names);
    setShowSubtree(true);
    const validIds = [...names].map((n) => taxaByName.get(n)?.ott_id).filter(Boolean);
    const url = new URL(window.location);
    url.search = "";
    url.searchParams.set("taxa", validIds.join(","));
    window.history.replaceState({}, "", url);
  }

  /** Update URL and show tree for the current selection */
  function handleShowSubtree() {
    setShowSubtree(true);
    const ids = [];
    for (const name of selectedOrganisms) {
      const sp = taxaByName.get(name);
      if (sp) ids.push(sp.ott_id);
    }
    const url = new URL(window.location);
    url.search = "";
    url.searchParams.set("taxa", ids.join(","));
    window.history.replaceState({}, "", url);
  }

  /** Close tree and clear URL params */
  function handleCloseSubtree() {
    setShowSubtree(false);
    const url = new URL(window.location);
    url.search = "";
    window.history.replaceState({}, "", url);
  }

  /** Replace the selection with a taxon and all its descendants, then show tree */
  function selectClade(ottId) {
    const node = findNodeByOttId(tree, ottId);
    if (!node) return;
    const names = collectTaxaNames(node);
    if (names.length < 2) return;
    setSelectedOrganisms(new Set(names));
    setShowSubtree(true);
    const url = new URL(window.location);
    url.search = "";
    url.searchParams.set("clade", ottId);
    window.history.replaceState({}, "", url);
  }

  return (
    <div className="app">
      <Navbar />
      <h1>🐱🐰🚂 Cat Bunny Railroad</h1>
      <p className="subtitle">
        Build a list of living things and discover what they have in common!
      </p>

      {/* List management section */}
      <div className="list-section">
        <div className="list-header">
          <h2>{selectedOrganisms.size === 0 ? "Start your list" : `Your list (${selectedOrganisms.size})`}</h2>
          <div className="list-header-actions">
            <select
              className="preset-select"
              onChange={handlePresetSelect}
              value=""
              aria-label="Load a preset list"
            >
              <option value="" disabled>Presets…</option>
              {PRESET_LISTS.map((p, i) => (
                <option key={i} value={i}>{p.label}</option>
              ))}
            </select>
            <button
              className="import-btn"
              onClick={() => setShowImport(true)}
            >
              📥 Import OTT IDs
            </button>
            {selectedOrganisms.size > 0 && (
              <button className="clear-selection-btn" onClick={handleClearList}>
                Clear list
              </button>
            )}
          </div>
        </div>

        <Autocomplete
          label="Add an organism"
          value={listInput}
          onChange={setListInput}
          onSelect={addToList}
          trie={trie}
          selectedItem={null}
        />

        {selectedOrganisms.size > 0 && (
          <div className="list-chips">
            {[...selectedOrganisms].map((name) => {
              const data = taxaByName.get(name);
              return (
                <span key={name} className="list-chip">
                  {data?.image_url && (
                    <img src={data.image_url} alt="" className="chip-img" />
                  )}
                  {name}
                  {data && descendantTaxaCounts.get(data.ott_id) >= 2 && (
                    <button
                      className="clade-btn"
                      onClick={() => selectClade(data.ott_id)}
                      title={`Select ${name} and all its descendants`}
                      aria-label={`Select ${name} clade`}
                    >🌿</button>
                  )}
                  <button
                    className="chip-remove"
                    onClick={() => removeFromList(name)}
                    aria-label={`Remove ${name}`}
                  >✕</button>
                </span>
              );
            })}
          </div>
        )}

        {selectedOrganisms.size >= 2 && (
          <div className="list-actions">
            <button
              className="make-tree-btn"
              onClick={handleShowSubtree}
            >
              🌳 Make tree ({selectedOrganisms.size} selected)
            </button>
          </div>
        )}
      </div>

      {showImport && (
        <div className="subtree-overlay">
          <div className="subtree-panel import-panel">
            <div className="subtree-header">
              <h3>Import tree from OTT IDs</h3>
              <button className="subtree-close" aria-label="Close" onClick={() => setShowImport(false)}>✕</button>
            </div>
            <div className="subtree-content import-content">
              <p className="import-hint">
                Paste a comma-separated list of OTT IDs (e.g. copied from another tree):
              </p>
              <textarea
                className="import-textarea"
                value={importText}
                onChange={(e) => { setImportText(e.target.value); setImportError(""); }}
                placeholder="563166,247341,864596"
                rows={4}
              />
              {importError && <p className="import-error">{importError}</p>}
              <button
                className="make-tree-btn import-go-btn"
                onClick={handleImportTree}
                disabled={
                  importText
                    .split(/[\s,]+/)
                    .filter((s) => /^\d+$/.test(s.trim())).length < 2
                }
              >
                🌳 Build tree
              </button>
            </div>
          </div>
        </div>
      )}

      {showSubtree && subtree && (
        <SubtreeView subtree={subtree} onClose={handleCloseSubtree} />
      )}

      {/* MRCA results */}
      {mrcaNode && (
        <div className="results">
          <h2>Common ancestor group</h2>
          <p className="clade-info">
            Your {selectedOrganisms.size} organisms share a common ancestor
            {" "}({cladeSpecies.length} organisms in this group).
          </p>

          <div className="collapsible-section">
            <button
              className="collapsible-toggle"
              onClick={() => setShowIncluded(!showIncluded)}
            >
              <span className="toggle-arrow">{showIncluded ? "▼" : "▶"}</span>
              Organisms in this group ({cladeSpecies.length})
            </button>
            {showIncluded && (
              <>
                <ul className="species-list">
                  {cladeSpecies.slice(0, inGroupLimit).map((name) => {
                    const data = taxaByName.get(name);
                    const isSelected = selectedOrganisms.has(name);
                    return (
                      <li
                        key={name}
                        className={`species-card ${isSelected ? "selected" : ""}`}
                        onClick={() => toggleOrganism(name)}
                        tabIndex={0}
                        onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); toggleOrganism(name); } }}
                      >
                        <input
                          type="checkbox"
                          className="species-checkbox"
                          checked={isSelected}
                          onChange={() => toggleOrganism(name)}
                          onClick={(e) => e.stopPropagation()}
                        />
                        {data?.image_url ? (
                          <img
                            className="species-img"
                            src={data.image_url}
                            alt={name}
                            loading="lazy"
                          />
                        ) : (
                          <div className="species-img placeholder">?</div>
                        )}
                        <span className="species-name">{name}</span>
                        {data?.comments && (
                          <span
                            className="comment-star-inline"
                            title={data.comments}
                          >★</span>
                        )}
                        {data && descendantTaxaCounts.get(data.ott_id) >= 2 && (
                          <button
                            className="clade-btn"
                            onClick={(e) => { e.stopPropagation(); selectClade(data.ott_id); }}
                            title={`Select ${name} and all its descendants`}
                            aria-label={`Select ${name} clade`}
                          >🌿</button>
                        )}
                        {data?.ott_id && (
                          <Link
                            to={`/explore/${data.ott_id}`}
                            className="explore-btn"
                            onClick={(e) => e.stopPropagation()}
                            title={`Explore ${name}`}
                            aria-label={`Explore ${name}`}
                          >🔍</Link>
                        )}
                      </li>
                    );
                  })}
                </ul>
                {inGroupLimit < cladeSpecies.length && (
                  <div className="show-more-container">
                    <button
                      className="show-more-btn"
                      onClick={() => setInGroupLimit((l) => l + INGROUP_PAGE_SIZE)}
                    >
                      Show more ({Math.min(INGROUP_PAGE_SIZE, cladeSpecies.length - inGroupLimit)} more)
                    </button>
                  </div>
                )}
              </>
            )}
          </div>

          <div className="collapsible-section">
            <button
              className="collapsible-toggle"
              onClick={() => setShowOutside(!showOutside)}
            >
              <span className="toggle-arrow">{showOutside ? "▼" : "▶"}</span>
              Nearest relatives outside this group ({outsideSpecies.length})
            </button>
            {showOutside && (
              <>
                <ul className="species-list">
                  {outsideSpecies.slice(0, outsideLimit).map((sp) => {
                    const isSelected = selectedOrganisms.has(sp.name);
                    return (
                      <li
                        key={sp.ott_id}
                        className={`species-card ${isSelected ? "selected" : ""}`}
                        onClick={() => toggleOrganism(sp.name)}
                        tabIndex={0}
                        onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); toggleOrganism(sp.name); } }}
                      >
                        <input
                          type="checkbox"
                          className="species-checkbox"
                          checked={isSelected}
                          onChange={() => toggleOrganism(sp.name)}
                          onClick={(e) => e.stopPropagation()}
                        />
                        {taxaByName.get(sp.name)?.image_url ? (
                          <img
                            className="species-img"
                            src={taxaByName.get(sp.name).image_url}
                            alt={sp.name}
                            loading="lazy"
                          />
                        ) : (
                          <div className="species-img placeholder">?</div>
                        )}
                        <span className="species-name">{sp.name}</span>
                        <span className="distance-label">
                          ↑{sp.height} {sp.height === 1 ? "level" : "levels"} up
                        </span>
                        {descendantTaxaCounts.get(sp.ott_id) >= 2 && (
                          <button
                            className="clade-btn"
                            onClick={(e) => { e.stopPropagation(); selectClade(sp.ott_id); }}
                            title={`Select ${sp.name} and all its descendants`}
                            aria-label={`Select ${sp.name} clade`}
                          >🌿</button>
                        )}
                        {sp.ott_id && (
                          <Link
                            to={`/explore/${sp.ott_id}`}
                            className="explore-btn"
                            onClick={(e) => e.stopPropagation()}
                            title={`Explore ${sp.name}`}
                            aria-label={`Explore ${sp.name}`}
                          >🔍</Link>
                        )}
                      </li>
                    );
                  })}
                </ul>
                {outsideLimit < outsideSpecies.length && (
                  <div className="show-more-container">
                    <button
                      className="show-more-btn"
                      onClick={() => setOutsideLimit((l) => l + OUTSIDE_PAGE_SIZE)}
                    >
                      Show more ({Math.min(OUTSIDE_PAGE_SIZE, outsideSpecies.length - outsideLimit)} more)
                    </button>
                  </div>
                )}
              </>
            )}
          </div>
        </div>
      )}


      <ErrorConsole />
    </div>
  );
}

export default App;
