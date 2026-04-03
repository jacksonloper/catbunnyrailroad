import { useRef, useEffect, useMemo, useState, useCallback } from "react";
import * as THREE from "three";
import { capitalize } from "./treeUtils.js";
import fullLayout from "./data/walkabout-layout.json";
import "./WalkaboutView.css";

/* ───── layout constants (must match build-data.js) ───── */
const CARD_W = 160;
const CARD_H = 200;
const PAD = 20;
const GAP = 12;
const LABEL_H = 26;

const MIN_ZOOM = 0.05;
const MAX_ZOOM = 4;
const ZOOM_STEP = 1.12;

/* ───── layout algorithm (for subtree views) ───── */

function computeLayout(node) {
  const isLeaf = !node.children || node.children.length === 0;
  if (isLeaf) return { node, w: CARD_W, h: CARD_H, children: [], labelH: 0 };

  const childLayouts = node.children.map(computeLayout);
  const hasLabel = node.name && !node.name.startsWith("mrca");
  const labelH = hasLabel ? LABEL_H : 0;

  if (childLayouts.length === 1) {
    const cl = childLayouts[0];
    return { node, w: cl.w + 2 * PAD, h: cl.h + 2 * PAD + labelH, horizontal: true, children: childLayouts, labelH };
  }

  const hW = childLayouts.reduce((s, c) => s + c.w, 0) + GAP * (childLayouts.length - 1) + 2 * PAD;
  const hH = Math.max(...childLayouts.map((c) => c.h)) + 2 * PAD + labelH;
  const vW = Math.max(...childLayouts.map((c) => c.w)) + 2 * PAD;
  const vH = childLayouts.reduce((s, c) => s + c.h, 0) + GAP * (childLayouts.length - 1) + 2 * PAD + labelH;

  const target = 1.6;
  const horizontal = Math.abs(hW / hH - target) <= Math.abs(vW / vH - target);
  return {
    node, w: horizontal ? hW : vW, h: horizontal ? hH : vH,
    horizontal, children: childLayouts, labelH,
  };
}

function assignPositions(layout, x, y) {
  layout.x = x;
  layout.y = y;
  if (layout.children.length === 0) return;
  const startX = x + PAD;
  const startY = y + PAD + layout.labelH;
  if (layout.horizontal) {
    let cx = startX;
    for (const child of layout.children) {
      const availH = layout.h - 2 * PAD - layout.labelH;
      assignPositions(child, cx, startY + (availH - child.h) / 2);
      cx += child.w + GAP;
    }
  } else {
    let cy = startY;
    for (const child of layout.children) {
      const availW = layout.w - 2 * PAD;
      assignPositions(child, startX + (availW - child.w) / 2, cy);
      cy += child.h + GAP;
    }
  }
}

function flattenLayout(layout, result = []) {
  const nd = layout.node;
  result.push({
    x: layout.x, y: layout.y, w: layout.w, h: layout.h,
    ott_id: nd.ott_id || null, name: nd.name || "",
    color: nd.color || null, isLeaf: layout.children.length === 0,
  });
  for (const child of layout.children) flattenLayout(child, result);
  return result;
}

/* ───── color helpers ───── */

function hexToRgb(hex) {
  const r = parseInt(hex.slice(1, 3), 16) / 255;
  const g = parseInt(hex.slice(3, 5), 16) / 255;
  const b = parseInt(hex.slice(5, 7), 16) / 255;
  return [r, g, b];
}

/* ───── Canvas text rendering for labels ───── */

function createTextCanvas(text, fontSize, color, maxWidth) {
  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d");
  ctx.font = `600 ${fontSize}px sans-serif`;
  const metrics = ctx.measureText(text);
  const w = Math.min(Math.ceil(metrics.width) + 4, maxWidth || 512);
  const h = Math.ceil(fontSize * 1.4);
  canvas.width = w;
  canvas.height = h;
  ctx.font = `600 ${fontSize}px sans-serif`;
  ctx.fillStyle = color;
  ctx.textBaseline = "top";
  ctx.fillText(text, 2, 2);
  return canvas;
}

/* ───── Three.js scene builder ───── */

function buildScene(scene, nodes, taxaByOttId) {
  const disposables = [];

  const internalNodes = nodes.filter((n) => !n.isLeaf);
  const leafNodes = nodes.filter((n) => n.isLeaf);

  for (const nd of internalNodes) {
    const hasColor = !!nd.color;
    const [r, g, b] = hasColor ? hexToRgb(nd.color) : [1, 1, 1];
    const alpha = hasColor ? 0.22 : 0.03;
    const borderAlpha = hasColor ? 0.6 : 0.06;

    const geo = new THREE.PlaneGeometry(nd.w, nd.h);
    const mat = new THREE.MeshBasicMaterial({
      color: new THREE.Color(r, g, b),
      transparent: true, opacity: alpha, depthTest: false,
    });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.set(nd.x + nd.w / 2, -(nd.y + nd.h / 2), 0);
    scene.add(mesh);
    disposables.push(geo, mat);

    const borderGeo = new THREE.EdgesGeometry(geo);
    const borderMat = new THREE.LineBasicMaterial({
      color: new THREE.Color(r, g, b),
      transparent: true, opacity: borderAlpha, depthTest: false,
    });
    const border = new THREE.LineSegments(borderGeo, borderMat);
    border.position.copy(mesh.position);
    border.position.z = 0.1;
    scene.add(border);
    disposables.push(borderGeo, borderMat);

    const hasLabel = nd.name && !nd.name.startsWith("mrca");
    if (hasLabel) {
      const labelCanvas = createTextCanvas(capitalize(nd.name), 14, "rgba(255,255,255,0.85)", nd.w - 20);
      const labelTex = new THREE.CanvasTexture(labelCanvas);
      labelTex.minFilter = THREE.LinearFilter;
      const labelGeo = new THREE.PlaneGeometry(labelCanvas.width, labelCanvas.height);
      const labelMat = new THREE.MeshBasicMaterial({
        map: labelTex, transparent: true, depthTest: false,
      });
      const labelMesh = new THREE.Mesh(labelGeo, labelMat);
      labelMesh.position.set(
        nd.x + 10 + labelCanvas.width / 2,
        -(nd.y + 4 + labelCanvas.height / 2),
        0.2,
      );
      scene.add(labelMesh);
      disposables.push(labelGeo, labelMat, labelTex);
    }
  }

  const textureLoader = new THREE.TextureLoader();
  textureLoader.crossOrigin = "anonymous";

  for (const nd of leafNodes) {
    const t = taxaByOttId.get(nd.ott_id);
    const name = t ? t.name : nd.name;
    const imgUrl = t?.image_url || null;

    const imgW = 140;
    const imgH = 140;
    const imgX = nd.x + (nd.w - imgW) / 2 + imgW / 2;
    const imgY = -(nd.y + 6 + imgH / 2);

    const imgGeo = new THREE.PlaneGeometry(imgW, imgH);
    disposables.push(imgGeo);

    if (imgUrl) {
      const imgMat = new THREE.MeshBasicMaterial({
        color: 0x222222, depthTest: false,
      });
      disposables.push(imgMat);
      const imgMesh = new THREE.Mesh(imgGeo, imgMat);
      imgMesh.position.set(imgX, imgY, 0.3);
      scene.add(imgMesh);

      textureLoader.load(
        imgUrl,
        (texture) => {
          texture.minFilter = THREE.LinearFilter;
          imgMat.map = texture;
          imgMat.color.set(0xffffff);
          imgMat.needsUpdate = true;
          disposables.push(texture);
        },
        undefined,
        () => { /* load failed — keep placeholder color */ },
      );
    } else {
      const phMat = new THREE.MeshBasicMaterial({
        color: 0x2a2a2a, depthTest: false,
      });
      const phMesh = new THREE.Mesh(imgGeo, phMat);
      phMesh.position.set(imgX, imgY, 0.3);
      scene.add(phMesh);
      disposables.push(phMat);
    }

    const labelCanvas = createTextCanvas(capitalize(name), 13, "#dddddd", 148);
    const labelTex = new THREE.CanvasTexture(labelCanvas);
    labelTex.minFilter = THREE.LinearFilter;
    const labelGeo = new THREE.PlaneGeometry(labelCanvas.width, labelCanvas.height);
    const labelMat = new THREE.MeshBasicMaterial({
      map: labelTex, transparent: true, depthTest: false,
    });
    const labelMesh = new THREE.Mesh(labelGeo, labelMat);
    labelMesh.position.set(
      nd.x + nd.w / 2,
      -(nd.y + 6 + imgH + 6 + labelCanvas.height / 2),
      0.4,
    );
    scene.add(labelMesh);
    disposables.push(labelGeo, labelMat, labelTex);
  }

  return disposables;
}

/* ───── Component ───── */

export default function WalkaboutView({ condensed, taxaByOttId, viewRoot, parentOf }) {
  const containerRef = useRef(null);
  const rendererRef = useRef(null);
  const cameraRef = useRef(null);
  const sceneRef = useRef(null);
  const frameRef = useRef(null);
  const disposablesRef = useRef([]);
  const [zoom, setZoom] = useState(1);

  // Compute the layout for the current viewRoot subtree.
  // If viewRoot is the full condensed tree root, use the pre-computed layout.
  // Otherwise compute it at runtime (fast for <1000 nodes).
  // For subtree views, propagate ancestor color to root if it has none.
  const { layoutNodes, totalW, totalH } = useMemo(() => {
    const isFullTree = !viewRoot || viewRoot === condensed;
    if (isFullTree && fullLayout) {
      return {
        layoutNodes: fullLayout.nodes,
        totalW: fullLayout.totalW,
        totalH: fullLayout.totalH,
      };
    }
    // For subtree view, find ancestor color if the viewRoot has none
    const subtree = viewRoot || condensed;
    let ancestorColor = null;
    if (!subtree.color && parentOf) {
      let cur = parentOf.get(subtree._id);
      while (cur && !cur.color) {
        cur = parentOf.get(cur._id);
      }
      if (cur?.color) ancestorColor = cur.color;
    }
    const root = computeLayout(subtree);
    assignPositions(root, 0, 0);
    const nodes = flattenLayout(root);
    // If root inherited color from ancestor, apply it to the first node (root)
    if (ancestorColor && nodes.length > 0 && !nodes[0].color) {
      nodes[0] = { ...nodes[0], color: ancestorColor };
    }
    return { layoutNodes: nodes, totalW: root.w, totalH: root.h };
  }, [condensed, viewRoot, parentOf]);

  // Build and maintain the Three.js scene
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setClearColor(0x111111);
    renderer.setSize(container.clientWidth, container.clientHeight);
    container.appendChild(renderer.domElement);
    rendererRef.current = renderer;

    const fitZoom = Math.min(
      container.clientWidth / totalW,
      container.clientHeight / totalH,
    );
    const initialZoom = Math.max(MIN_ZOOM, Math.min(fitZoom, 1));

    const halfW = container.clientWidth / (2 * initialZoom);
    const halfH = container.clientHeight / (2 * initialZoom);
    const camera = new THREE.OrthographicCamera(-halfW, halfW, halfH, -halfH, -10, 10);
    camera.position.set(totalW / 2, -totalH / 2, 5);
    camera.zoom = initialZoom;
    camera.updateProjectionMatrix();
    cameraRef.current = camera;
    setZoom(initialZoom);

    const scene = new THREE.Scene();
    sceneRef.current = scene;

    const disposables = buildScene(scene, layoutNodes, taxaByOttId);
    disposablesRef.current = disposables;

    let needsRender = true;
    function render() {
      frameRef.current = requestAnimationFrame(render);
      if (needsRender) {
        renderer.render(scene, camera);
        needsRender = false;
      }
    }
    render();

    function markDirty() { needsRender = true; }

    /* ── Pan & zoom interaction ── */
    let isPanning = false;
    let panStart = { x: 0, y: 0 };

    function screenToWorld(sx, sy) {
      const rect = container.getBoundingClientRect();
      const ndcX = ((sx - rect.left) / rect.width) * 2 - 1;
      const ndcY = -((sy - rect.top) / rect.height) * 2 + 1;
      const vec = new THREE.Vector3(ndcX, ndcY, 0).unproject(camera);
      return { x: vec.x, y: vec.y };
    }

    function onMouseDown(e) {
      if (e.button !== 0) return;
      isPanning = true;
      panStart = { x: e.clientX, y: e.clientY };
      container.style.cursor = "grabbing";
    }

    function onMouseMove(e) {
      if (!isPanning) return;
      const dx = e.clientX - panStart.x;
      const dy = e.clientY - panStart.y;
      panStart = { x: e.clientX, y: e.clientY };
      const scale = 1 / camera.zoom;
      camera.position.x -= dx * scale;
      camera.position.y += dy * scale;
      camera.updateProjectionMatrix();
      markDirty();
    }

    function onMouseUp() {
      isPanning = false;
      container.style.cursor = "grab";
    }

    function applyZoomLevel(newZoom) {
      camera.zoom = newZoom;
      const hw = container.clientWidth / (2 * newZoom);
      const hh = container.clientHeight / (2 * newZoom);
      camera.left = -hw;
      camera.right = hw;
      camera.top = hh;
      camera.bottom = -hh;
      camera.updateProjectionMatrix();
      setZoom(newZoom);
      markDirty();
    }

    function onWheel(e) {
      e.preventDefault();
      const factor = e.deltaY < 0 ? ZOOM_STEP : 1 / ZOOM_STEP;
      const newZoom = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, camera.zoom * factor));
      const worldBefore = screenToWorld(e.clientX, e.clientY);
      applyZoomLevel(newZoom);
      const worldAfter = screenToWorld(e.clientX, e.clientY);
      camera.position.x += worldBefore.x - worldAfter.x;
      camera.position.y += worldBefore.y - worldAfter.y;
      camera.updateProjectionMatrix();
      markDirty();
    }

    let lastTouchDist = 0;
    let lastTouchCenter = { x: 0, y: 0 };

    function onTouchStart(e) {
      const ts = Array.from(e.touches);
      if (ts.length === 2) {
        lastTouchDist = Math.hypot(ts[0].clientX - ts[1].clientX, ts[0].clientY - ts[1].clientY);
        lastTouchCenter = { x: (ts[0].clientX + ts[1].clientX) / 2, y: (ts[0].clientY + ts[1].clientY) / 2 };
      } else if (ts.length === 1) {
        isPanning = true;
        panStart = { x: ts[0].clientX, y: ts[0].clientY };
      }
    }

    function onTouchMove(e) {
      e.preventDefault();
      const ts = Array.from(e.touches);
      if (ts.length === 2) {
        const dist = Math.hypot(ts[0].clientX - ts[1].clientX, ts[0].clientY - ts[1].clientY);
        const center = { x: (ts[0].clientX + ts[1].clientX) / 2, y: (ts[0].clientY + ts[1].clientY) / 2 };
        const scale = dist / lastTouchDist;
        const newZoom = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, camera.zoom * scale));
        const worldBefore = screenToWorld(center.x, center.y);
        applyZoomLevel(newZoom);
        const worldAfter = screenToWorld(center.x, center.y);
        camera.position.x += worldBefore.x - worldAfter.x;
        camera.position.y += worldBefore.y - worldAfter.y;
        // pan with center movement
        const panScale = 1 / camera.zoom;
        camera.position.x -= (center.x - lastTouchCenter.x) * panScale;
        camera.position.y += (center.y - lastTouchCenter.y) * panScale;
        camera.updateProjectionMatrix();
        lastTouchDist = dist;
        lastTouchCenter = center;
        markDirty();
      } else if (ts.length === 1 && isPanning) {
        const dx = ts[0].clientX - panStart.x;
        const dy = ts[0].clientY - panStart.y;
        panStart = { x: ts[0].clientX, y: ts[0].clientY };
        const scale = 1 / camera.zoom;
        camera.position.x -= dx * scale;
        camera.position.y += dy * scale;
        camera.updateProjectionMatrix();
        markDirty();
      }
    }

    function onTouchEnd() { isPanning = false; }

    function onResize() {
      const w = container.clientWidth;
      const h = container.clientHeight;
      renderer.setSize(w, h);
      const hw = w / (2 * camera.zoom);
      const hh = h / (2 * camera.zoom);
      camera.left = -hw;
      camera.right = hw;
      camera.top = hh;
      camera.bottom = -hh;
      camera.updateProjectionMatrix();
      markDirty();
    }

    // Store applyZoomLevel on the container so the button callbacks can use it
    container._wbApplyZoom = applyZoomLevel;
    container._wbFitToScreen = () => {
      const fitZ = Math.min(container.clientWidth / totalW, container.clientHeight / totalH);
      const clamped = Math.max(MIN_ZOOM, Math.min(fitZ, MAX_ZOOM));
      camera.position.set(totalW / 2, -totalH / 2, 5);
      applyZoomLevel(clamped);
    };

    const canvas = renderer.domElement;
    canvas.addEventListener("mousedown", onMouseDown);
    window.addEventListener("mousemove", onMouseMove);
    window.addEventListener("mouseup", onMouseUp);
    canvas.addEventListener("wheel", onWheel, { passive: false });
    canvas.addEventListener("touchstart", onTouchStart, { passive: true });
    canvas.addEventListener("touchmove", onTouchMove, { passive: false });
    canvas.addEventListener("touchend", onTouchEnd);
    window.addEventListener("resize", onResize);

    return () => {
      cancelAnimationFrame(frameRef.current);
      canvas.removeEventListener("mousedown", onMouseDown);
      window.removeEventListener("mousemove", onMouseMove);
      window.removeEventListener("mouseup", onMouseUp);
      canvas.removeEventListener("wheel", onWheel);
      canvas.removeEventListener("touchstart", onTouchStart);
      canvas.removeEventListener("touchmove", onTouchMove);
      canvas.removeEventListener("touchend", onTouchEnd);
      window.removeEventListener("resize", onResize);
      for (const d of disposablesRef.current) { if (d.dispose) d.dispose(); }
      scene.clear();
      renderer.dispose();
      if (container.contains(renderer.domElement)) {
        container.removeChild(renderer.domElement);
      }
    };
  }, [layoutNodes, totalW, totalH, taxaByOttId]);

  const handleZoomIn = useCallback(() => {
    const el = containerRef.current;
    if (el?._wbApplyZoom) el._wbApplyZoom(Math.min(MAX_ZOOM, zoom * ZOOM_STEP));
  }, [zoom]);

  const handleZoomOut = useCallback(() => {
    const el = containerRef.current;
    if (el?._wbApplyZoom) el._wbApplyZoom(Math.max(MIN_ZOOM, zoom / ZOOM_STEP));
  }, [zoom]);

  const handleFit = useCallback(() => {
    const el = containerRef.current;
    if (el?._wbFitToScreen) el._wbFitToScreen();
  }, []);

  const pct = Math.round(zoom * 100);

  return (
    <div className="walkabout-wrapper">
      <div className="walkabout-container" ref={containerRef} />
      <div className="wb-zoom-controls">
        <button className="wb-zoom-btn" onClick={handleZoomIn} aria-label="Zoom in" title="Zoom in">+</button>
        <span className="wb-zoom-level">{pct}%</span>
        <button className="wb-zoom-btn" onClick={handleZoomOut} aria-label="Zoom out" title="Zoom out">−</button>
        <button className="wb-zoom-btn wb-zoom-fit" onClick={handleFit} aria-label="Fit to screen" title="Fit to screen">⊞</button>
      </div>
    </div>
  );
}
