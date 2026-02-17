import { useState, useCallback, useMemo } from 'react';
import { RailroadMaze } from './lib/model.js';
import { MazeSolver } from './lib/solver.js';
import Sidebar from './components/Sidebar.jsx';
import LayerCanvas from './components/LayerCanvas.jsx';
import InstructionPanel from './components/InstructionPanel.jsx';
import InfoPanel from './components/InfoPanel.jsx';

const MODE_HINTS = {
  edge: 'Click a node to start an edge, then click another node to complete it. Click an edge to remove it.',
  start: 'Click a node to toggle it as a starting point.',
  instructions: 'Select a starting point, then click a node with ≥2 children to edit its instructions.',
  visualize: 'Select a starting point to see reachable subgraph, leaves, and paths.',
};

// Mutable maze singleton; version counter triggers re-renders.
const maze = new RailroadMaze(3, 1);

export default function App() {
  const [version, setVersion] = useState(0);
  const rerender = useCallback(() => setVersion(v => v + 1), []);

  const [mode, setMode] = useState('edge');
  const [edgeSource, setEdgeSource] = useState(null);
  const [selectedStartKey, setSelectedStartKey] = useState(null);
  const [instructionNodeKey, setInstructionNodeKey] = useState(null);

  // Derived values keyed on version
  const gridSize = useMemo(() => maze.gridSize, [version]); // eslint-disable-line react-hooks/exhaustive-deps
  const layers = useMemo(() => maze.layers, [version]); // eslint-disable-line react-hooks/exhaustive-deps
  const startKeys = useMemo(() => [...maze.startingPoints], [version]); // eslint-disable-line react-hooks/exhaustive-deps

  const highlightData = useMemo(() => {
    if (mode === 'visualize' && selectedStartKey && maze.startingPoints.has(selectedStartKey)) {
      const startNode = maze.parseKey(selectedStartKey);
      return MazeSolver.getReachableGraph(maze, startNode);
    }
    return null;
  }, [mode, selectedStartKey, version]); // eslint-disable-line react-hooks/exhaustive-deps

  const { leaves, paths } = useMemo(() => {
    if (mode === 'visualize' && selectedStartKey && maze.startingPoints.has(selectedStartKey)) {
      const startNode = maze.parseKey(selectedStartKey);
      return {
        leaves: MazeSolver.findReachableLeaves(maze, startNode),
        paths: MazeSolver.findAllPaths(maze, startNode),
      };
    }
    return { leaves: null, paths: null };
  }, [mode, selectedStartKey, version]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleNodeClick = useCallback((node) => {
    if (mode === 'edge') {
      if (!edgeSource) {
        setEdgeSource(node);
      } else {
        if (maze.nodeKey(edgeSource) !== maze.nodeKey(node)) {
          maze.addEdge(edgeSource, node);
        }
        setEdgeSource(null);
        rerender();
      }
    } else if (mode === 'start') {
      maze.toggleStartingPoint(node);
      rerender();
    } else if (mode === 'instructions') {
      const children = maze.getChildren(node);
      if (children.length >= 2 && selectedStartKey) {
        setInstructionNodeKey(maze.nodeKey(node));
      }
    }
  }, [mode, edgeSource, selectedStartKey, rerender]);

  const handleEdgeClick = useCallback((edge) => {
    if (mode === 'edge') {
      maze.removeEdge(edge.from, edge.to);
      rerender();
    }
  }, [mode, rerender]);

  const handleModeChange = useCallback((newMode) => {
    setMode(newMode);
    setEdgeSource(null);
    setInstructionNodeKey(null);
  }, []);

  const handleGridSizeChange = useCallback((val) => {
    maze.setGridSize(val);
    rerender();
  }, [rerender]);

  const handleLayersChange = useCallback((val) => {
    maze.setLayers(val);
    rerender();
  }, [rerender]);

  const handleStartSelect = useCallback((key) => {
    setSelectedStartKey(key);
    setInstructionNodeKey(null);
  }, []);

  const handleClear = useCallback(() => {
    maze.clearAll();
    setEdgeSource(null);
    setSelectedStartKey(null);
    setInstructionNodeKey(null);
    rerender();
  }, [rerender]);

  const handleExport = useCallback(() => {
    const json = maze.exportJSON();
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'maze.json';
    a.click();
    URL.revokeObjectURL(url);
  }, []);

  const handleImport = useCallback((text) => {
    try {
      maze.importJSON(text);
      setEdgeSource(null);
      setSelectedStartKey(null);
      setInstructionNodeKey(null);
      rerender();
    } catch {
      // Silently ignore bad JSON
    }
  }, [rerender]);

  const selectedStart = selectedStartKey ? maze.parseKey(selectedStartKey) : null;

  return (
    <div className="app-layout">
      <Sidebar
        gridSize={gridSize}
        layers={layers}
        mode={mode}
        startKeys={startKeys}
        selectedStartKey={selectedStartKey}
        onGridSizeChange={handleGridSizeChange}
        onLayersChange={handleLayersChange}
        onModeChange={handleModeChange}
        onStartSelect={handleStartSelect}
        onClear={handleClear}
        onExport={handleExport}
        onImport={handleImport}
      >
        {mode === 'instructions' && instructionNodeKey && selectedStartKey && (
          <InstructionPanel
            maze={maze}
            nodeKey={instructionNodeKey}
            startKey={selectedStartKey}
            onUpdate={rerender}
          />
        )}
      </Sidebar>

      <div className="main-area">
        <div className="canvas-area">
          <div className="canvas-container">
            {Array.from({ length: layers }, (_, l) => (
              <LayerCanvas
                key={l}
                layer={l}
                maze={maze}
                mode={mode}
                highlightData={highlightData}
                selectedNode={edgeSource}
                selectedStart={selectedStart}
                onNodeClick={handleNodeClick}
                onEdgeClick={handleEdgeClick}
              />
            ))}
          </div>
        </div>

        <InfoPanel
          maze={maze}
          mode={mode}
          selectedStartKey={selectedStartKey}
          leaves={leaves}
          paths={paths}
        />

        <div className="status-bar">
          {MODE_HINTS[mode]}
        </div>
      </div>
    </div>
  );
}
