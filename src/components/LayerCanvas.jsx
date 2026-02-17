import { useRef, useEffect, useCallback } from 'react';
import { getCanvasSize, renderLayer, hitTestNode, hitTestEdge } from '../lib/renderer.js';

export default function LayerCanvas({
  layer,
  maze,
  mode,
  highlightData,
  selectedNode,
  selectedStart,
  onNodeClick,
  onEdgeClick,
}) {
  const canvasRef = useRef(null);
  const hoveredRef = useRef(null);

  const size = getCanvasSize(maze.gridSize);

  const render = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    renderLayer(canvas, layer, maze, highlightData, selectedNode, hoveredRef.current, mode, selectedStart);
  }, [layer, maze, highlightData, selectedNode, mode, selectedStart]);

  useEffect(() => {
    render();
  }, [render]);

  const handleClick = useCallback((e) => {
    const rect = canvasRef.current.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;

    const node = hitTestNode(x, y, layer, maze.gridSize);
    if (node) {
      onNodeClick(node);
      return;
    }
    if (mode === 'edge') {
      const edge = hitTestEdge(x, y, layer, maze);
      if (edge) {
        onEdgeClick(edge);
      }
    }
  }, [layer, maze, mode, onNodeClick, onEdgeClick]);

  const handleMouseMove = useCallback((e) => {
    const rect = canvasRef.current.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    const node = hitTestNode(x, y, layer, maze.gridSize);
    const prev = hoveredRef.current;
    const changed = (!prev && node) || (prev && !node) ||
      (prev && node && maze.nodeKey(prev) !== maze.nodeKey(node));
    hoveredRef.current = node;
    if (changed) render();

    const edge = mode === 'edge' ? hitTestEdge(x, y, layer, maze) : null;
    canvasRef.current.style.cursor = node || edge ? 'pointer' : 'crosshair';
  }, [layer, maze, mode, render]);

  const handleMouseLeave = useCallback(() => {
    if (hoveredRef.current) {
      hoveredRef.current = null;
      render();
    }
  }, [render]);

  return (
    <div className="layer-wrapper">
      <div className="layer-label">Layer {layer}</div>
      <canvas
        ref={canvasRef}
        width={size}
        height={size}
        onClick={handleClick}
        onMouseMove={handleMouseMove}
        onMouseLeave={handleMouseLeave}
      />
    </div>
  );
}
