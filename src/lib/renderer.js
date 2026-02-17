/**
 * Canvas rendering for a single maze layer.
 */

const CELL_SIZE = 80;
const NODE_RADIUS = 16;
const PADDING = 50;

export function getCanvasSize(gridSize) {
  const size = PADDING * 2 + (gridSize - 1) * CELL_SIZE;
  return Math.max(size, 120);
}

function nodePos(node) {
  return {
    x: PADDING + node.c * CELL_SIZE,
    y: PADDING + node.r * CELL_SIZE,
  };
}

export function hitTestNode(x, y, layer, gridSize) {
  for (let r = 0; r < gridSize; r++) {
    for (let c = 0; c < gridSize; c++) {
      const pos = nodePos({ r, c, l: layer });
      const dx = x - pos.x;
      const dy = y - pos.y;
      if (dx * dx + dy * dy <= (NODE_RADIUS + 4) * (NODE_RADIUS + 4)) {
        return { r, c, l: layer };
      }
    }
  }
  return null;
}

export function hitTestEdge(x, y, layer, maze) {
  const threshold = 8;
  for (const edge of maze.edges) {
    if (edge.from.l !== layer && edge.to.l !== layer) continue;
    if (edge.from.l === layer && edge.to.l === layer) {
      const p1 = nodePos(edge.from);
      const p2 = nodePos(edge.to);
      const dist = distToSegment(x, y, p1.x, p1.y, p2.x, p2.y);
      if (dist < threshold) return edge;
    }
  }
  return null;
}

function distToSegment(px, py, x1, y1, x2, y2) {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const lenSq = dx * dx + dy * dy;
  if (lenSq === 0) return Math.hypot(px - x1, py - y1);
  let t = ((px - x1) * dx + (py - y1) * dy) / lenSq;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(px - (x1 + t * dx), py - (y1 + t * dy));
}

function drawArrowhead(ctx, fromX, fromY, toX, toY) {
  const headLen = 10;
  const angle = Math.atan2(toY - fromY, toX - fromX);
  ctx.beginPath();
  ctx.moveTo(toX, toY);
  ctx.lineTo(toX - headLen * Math.cos(angle - Math.PI / 6), toY - headLen * Math.sin(angle - Math.PI / 6));
  ctx.lineTo(toX - headLen * Math.cos(angle + Math.PI / 6), toY - headLen * Math.sin(angle + Math.PI / 6));
  ctx.closePath();
  ctx.fillStyle = ctx.strokeStyle;
  ctx.fill();
}

function drawEdge(ctx, edge, layer, maze, highlightData, mode, selectedStart) {
  const crossLayer = edge.from.l !== edge.to.l;
  const fromOnLayer = edge.from.l === layer;
  const toOnLayer = edge.to.l === layer;
  if (!fromOnLayer && !toOnLayer) return;

  const fromPos = nodePos(edge.from);
  const toPos = nodePos(edge.to);
  const edgeKey = maze.nodeKey(edge.from) + '->' + maze.nodeKey(edge.to);

  let alpha = 1;
  let color = '#555';
  let lineWidth = 2;
  let dashed = crossLayer;

  if (highlightData) {
    if (highlightData.reachableEdges.has(edgeKey)) {
      color = '#00b4d8';
      lineWidth = 3;
      alpha = 1;
    } else {
      alpha = 0.15;
      color = '#999';
    }
  }

  if (mode === 'instructions' && selectedStart) {
    const fromKey = maze.nodeKey(edge.from);
    const startKey = maze.nodeKey(selectedStart);
    const inner = maze.instructions.get(fromKey);
    const children = maze.getChildren(edge.from);
    const needsInstruction = children.length >= 2;
    if (needsInstruction && inner && inner.has(startKey)) {
      const allowed = inner.get(startKey);
      const toKey = maze.nodeKey(edge.to);
      if (!allowed.has(toKey)) {
        alpha = 0.25;
        dashed = true;
        color = '#999';
      } else {
        color = '#2ecc71';
        lineWidth = 3;
      }
    }
  }

  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.strokeStyle = color;
  ctx.lineWidth = lineWidth;
  ctx.setLineDash(dashed ? [6, 4] : []);

  if (crossLayer) {
    ctx.strokeStyle = alpha < 0.5 ? color : '#e67e22';
    if (fromOnLayer && !toOnLayer) {
      const midX = fromPos.x + 20;
      const midY = fromPos.y - 20;
      ctx.beginPath();
      ctx.moveTo(fromPos.x, fromPos.y);
      ctx.lineTo(midX, midY);
      ctx.stroke();
      ctx.fillStyle = ctx.strokeStyle;
      ctx.font = '10px sans-serif';
      ctx.fillText(`→L${edge.to.l}`, midX + 2, midY - 2);
    } else if (toOnLayer && !fromOnLayer) {
      const midX = toPos.x - 20;
      const midY = toPos.y - 20;
      ctx.beginPath();
      ctx.moveTo(midX, midY);
      ctx.lineTo(toPos.x, toPos.y);
      ctx.stroke();
      drawArrowhead(ctx, midX, midY, toPos.x, toPos.y);
      ctx.fillStyle = ctx.strokeStyle;
      ctx.font = '10px sans-serif';
      ctx.fillText(`L${edge.from.l}→`, midX - 20, midY - 2);
    }
  } else {
    const dx = toPos.x - fromPos.x;
    const dy = toPos.y - fromPos.y;
    const len = Math.hypot(dx, dy);
    if (len === 0) { ctx.restore(); return; }
    const ux = dx / len;
    const uy = dy / len;
    const startX = fromPos.x + ux * NODE_RADIUS;
    const startY = fromPos.y + uy * NODE_RADIUS;
    const endX = toPos.x - ux * NODE_RADIUS;
    const endY = toPos.y - uy * NODE_RADIUS;

    const reverseExists = maze.edges.some(
      e => maze.nodeKey(e.from) === maze.nodeKey(edge.to) &&
           maze.nodeKey(e.to) === maze.nodeKey(edge.from)
    );
    let offsetX = 0, offsetY = 0;
    if (reverseExists) {
      offsetX = -uy * 5;
      offsetY = ux * 5;
    }

    ctx.beginPath();
    ctx.moveTo(startX + offsetX, startY + offsetY);
    ctx.lineTo(endX + offsetX, endY + offsetY);
    ctx.stroke();
    drawArrowhead(ctx, startX + offsetX, startY + offsetY, endX + offsetX, endY + offsetY);
  }

  ctx.restore();
}

function drawNode(ctx, node, maze, highlightData, selectedNode, hoveredNode) {
  const pos = nodePos(node);
  const key = maze.nodeKey(node);
  const isStart = maze.startingPoints.has(key);
  const isLeaf = maze.isLeaf(node);
  const isSelected = selectedNode && maze.nodeKey(selectedNode) === key;
  const isHovered = hoveredNode && maze.nodeKey(hoveredNode) === key;
  const inGraph = maze.getAllNodes().some(n => maze.nodeKey(n) === key);

  let fillColor = '#fff';
  let strokeColor = '#555';
  let strokeWidth = 2;
  let glowColor = null;

  if (isStart) {
    strokeColor = '#2ecc71';
    strokeWidth = 3;
  }
  if (isLeaf && inGraph) {
    fillColor = '#ffe0e0';
  }

  if (highlightData) {
    if (highlightData.reachableNodes.has(key)) {
      fillColor = isLeaf ? '#ff6b6b' : '#e0f7fa';
      strokeColor = '#00b4d8';
      strokeWidth = 3;
      if (isLeaf) {
        glowColor = 'rgba(255, 107, 107, 0.5)';
      }
      if (isStart) {
        strokeColor = '#2ecc71';
      }
    } else {
      fillColor = '#f5f5f5';
      strokeColor = '#ccc';
      strokeWidth = 1;
    }
  }

  if (isSelected) {
    strokeColor = '#3498db';
    strokeWidth = 4;
  }
  if (isHovered) {
    strokeWidth += 1;
  }

  if (glowColor) {
    ctx.save();
    ctx.shadowColor = glowColor;
    ctx.shadowBlur = 15;
    ctx.beginPath();
    ctx.arc(pos.x, pos.y, NODE_RADIUS + 3, 0, Math.PI * 2);
    ctx.fillStyle = glowColor;
    ctx.fill();
    ctx.restore();
  }

  ctx.beginPath();
  ctx.arc(pos.x, pos.y, NODE_RADIUS, 0, Math.PI * 2);
  ctx.fillStyle = fillColor;
  ctx.fill();
  ctx.strokeStyle = strokeColor;
  ctx.lineWidth = strokeWidth;
  ctx.stroke();

  ctx.fillStyle = '#333';
  ctx.font = '11px monospace';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(`${node.r},${node.c}`, pos.x, pos.y);
}

export function renderLayer(canvas, layer, maze, highlightData, selectedNode, hoveredNode, mode, selectedStart) {
  const ctx = canvas.getContext('2d');
  const w = canvas.width;
  const h = canvas.height;
  ctx.clearRect(0, 0, w, h);

  const n = maze.gridSize;

  // Grid lines
  ctx.strokeStyle = '#ddd';
  ctx.lineWidth = 1;
  for (let r = 0; r < n; r++) {
    for (let c = 0; c < n; c++) {
      const pos = nodePos({ r, c, l: layer });
      if (c < n - 1) {
        const next = nodePos({ r, c: c + 1, l: layer });
        ctx.beginPath();
        ctx.moveTo(pos.x, pos.y);
        ctx.lineTo(next.x, next.y);
        ctx.stroke();
      }
      if (r < n - 1) {
        const next = nodePos({ r: r + 1, c, l: layer });
        ctx.beginPath();
        ctx.moveTo(pos.x, pos.y);
        ctx.lineTo(next.x, next.y);
        ctx.stroke();
      }
    }
  }

  // Edges
  for (const edge of maze.edges) {
    drawEdge(ctx, edge, layer, maze, highlightData, mode, selectedStart);
  }

  // Nodes
  for (let r = 0; r < n; r++) {
    for (let c = 0; c < n; c++) {
      drawNode(ctx, { r, c, l: layer }, maze, highlightData, selectedNode, hoveredNode);
    }
  }
}
