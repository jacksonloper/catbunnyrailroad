import { describe, it, expect } from 'vitest';
import { RailroadMaze } from './lib/model.js';
import { MazeSolver } from './lib/solver.js';

describe('RailroadMaze', () => {
  it('creates a maze with correct dimensions', () => {
    const maze = new RailroadMaze(3, 2);
    expect(maze.gridSize).toBe(3);
    expect(maze.layers).toBe(2);
  });

  it('adds and prevents duplicate edges', () => {
    const maze = new RailroadMaze(3, 1);
    expect(maze.addEdge({ r: 0, c: 0, l: 0 }, { r: 0, c: 1, l: 0 })).toBe(true);
    expect(maze.addEdge({ r: 0, c: 0, l: 0 }, { r: 0, c: 1, l: 0 })).toBe(false);
  });

  it('gets children correctly', () => {
    const maze = new RailroadMaze(3, 1);
    maze.addEdge({ r: 0, c: 0, l: 0 }, { r: 0, c: 1, l: 0 });
    maze.addEdge({ r: 0, c: 0, l: 0 }, { r: 1, c: 0, l: 0 });
    expect(maze.getChildren({ r: 0, c: 0, l: 0 })).toHaveLength(2);
    expect(maze.getChildren({ r: 0, c: 1, l: 0 })).toHaveLength(0);
  });

  it('removes edges', () => {
    const maze = new RailroadMaze(3, 1);
    maze.addEdge({ r: 0, c: 0, l: 0 }, { r: 0, c: 1, l: 0 });
    expect(maze.removeEdge({ r: 0, c: 0, l: 0 }, { r: 0, c: 1, l: 0 })).toBe(true);
    expect(maze.edges).toHaveLength(0);
    expect(maze.removeEdge({ r: 0, c: 0, l: 0 }, { r: 0, c: 1, l: 0 })).toBe(false);
  });

  it('toggles starting points', () => {
    const maze = new RailroadMaze(3, 1);
    expect(maze.toggleStartingPoint({ r: 0, c: 0, l: 0 })).toBe(true);
    expect(maze.startingPoints.has('0,0,0')).toBe(true);
    expect(maze.toggleStartingPoint({ r: 0, c: 0, l: 0 })).toBe(false);
    expect(maze.startingPoints.has('0,0,0')).toBe(false);
  });

  it('serializes nodeKey and parseKey correctly', () => {
    const maze = new RailroadMaze(3, 2);
    expect(maze.nodeKey({ r: 1, c: 2, l: 0 })).toBe('1,2,0');
    expect(maze.parseKey('2,1,1')).toEqual({ r: 2, c: 1, l: 1 });
  });

  it('sets and applies instructions', () => {
    const maze = new RailroadMaze(3, 1);
    maze.addEdge({ r: 0, c: 0, l: 0 }, { r: 0, c: 1, l: 0 });
    maze.addEdge({ r: 0, c: 0, l: 0 }, { r: 1, c: 0, l: 0 });
    maze.toggleStartingPoint({ r: 0, c: 0, l: 0 });

    expect(maze.getAvailableChildren({ r: 0, c: 0, l: 0 }, { r: 0, c: 0, l: 0 })).toHaveLength(2);

    maze.setInstruction({ r: 0, c: 0, l: 0 }, { r: 0, c: 0, l: 0 }, ['0,1,0']);
    const filtered = maze.getAvailableChildren({ r: 0, c: 0, l: 0 }, { r: 0, c: 0, l: 0 });
    expect(filtered).toHaveLength(1);
    expect(maze.nodeKey(filtered[0])).toBe('0,1,0');
  });

  it('identifies leaves', () => {
    const maze = new RailroadMaze(3, 1);
    maze.addEdge({ r: 0, c: 0, l: 0 }, { r: 0, c: 1, l: 0 });
    maze.addEdge({ r: 0, c: 0, l: 0 }, { r: 1, c: 0, l: 0 });
    maze.addEdge({ r: 0, c: 1, l: 0 }, { r: 1, c: 1, l: 0 });

    const leafKeys = maze.getLeaves().map(l => maze.nodeKey(l)).sort();
    expect(leafKeys).toEqual(['1,0,0', '1,1,0']);
  });

  it('prunes nodes on grid resize', () => {
    const maze = new RailroadMaze(4, 2);
    maze.addEdge({ r: 3, c: 3, l: 1 }, { r: 0, c: 0, l: 0 });
    maze.toggleStartingPoint({ r: 3, c: 3, l: 1 });
    expect(maze.edges).toHaveLength(1);

    maze.setGridSize(3);
    expect(maze.edges).toHaveLength(0);
    expect(maze.startingPoints.has('3,3,1')).toBe(false);
  });

  it('exports and imports JSON roundtrip', () => {
    const maze = new RailroadMaze(4, 2);
    maze.addEdge({ r: 0, c: 0, l: 0 }, { r: 0, c: 1, l: 0 });
    maze.addEdge({ r: 0, c: 0, l: 0 }, { r: 1, c: 0, l: 0 });
    maze.addEdge({ r: 0, c: 1, l: 0 }, { r: 0, c: 1, l: 1 });
    maze.toggleStartingPoint({ r: 0, c: 0, l: 0 });
    maze.setInstruction({ r: 0, c: 0, l: 0 }, { r: 0, c: 0, l: 0 }, ['0,1,0']);

    const json = maze.exportJSON();
    const maze2 = new RailroadMaze();
    maze2.importJSON(json);

    expect(maze2.gridSize).toBe(4);
    expect(maze2.layers).toBe(2);
    expect(maze2.edges).toHaveLength(3);
    expect(maze2.startingPoints.has('0,0,0')).toBe(true);

    const children = maze2.getAvailableChildren({ r: 0, c: 0, l: 0 }, { r: 0, c: 0, l: 0 });
    expect(children).toHaveLength(1);
    expect(maze2.nodeKey(children[0])).toBe('0,1,0');
  });

  it('clones correctly', () => {
    const maze = new RailroadMaze(3, 2);
    maze.addEdge({ r: 0, c: 0, l: 0 }, { r: 1, c: 1, l: 1 });
    maze.toggleStartingPoint({ r: 0, c: 0, l: 0 });
    const clone = maze.clone();
    expect(clone.edges).toHaveLength(1);
    expect(clone.startingPoints.has('0,0,0')).toBe(true);
    clone.clearAll();
    expect(maze.edges).toHaveLength(1);
  });
});

describe('MazeSolver', () => {
  it('finds reachable leaves (simple graph)', () => {
    const maze = new RailroadMaze(3, 1);
    maze.addEdge({ r: 0, c: 0, l: 0 }, { r: 0, c: 1, l: 0 });
    maze.addEdge({ r: 0, c: 0, l: 0 }, { r: 1, c: 0, l: 0 });
    maze.addEdge({ r: 0, c: 1, l: 0 }, { r: 0, c: 2, l: 0 });
    maze.toggleStartingPoint({ r: 0, c: 0, l: 0 });

    const leaves = MazeSolver.findReachableLeaves(maze, { r: 0, c: 0, l: 0 });
    const leafKeys = leaves.map(l => maze.nodeKey(l)).sort();
    expect(leafKeys).toEqual(['0,2,0', '1,0,0']);
  });

  it('finds reachable leaves respecting instructions', () => {
    const maze = new RailroadMaze(3, 1);
    maze.addEdge({ r: 0, c: 0, l: 0 }, { r: 0, c: 1, l: 0 });
    maze.addEdge({ r: 0, c: 0, l: 0 }, { r: 1, c: 0, l: 0 });
    maze.addEdge({ r: 0, c: 1, l: 0 }, { r: 0, c: 2, l: 0 });
    maze.toggleStartingPoint({ r: 0, c: 0, l: 0 });
    maze.setInstruction({ r: 0, c: 0, l: 0 }, { r: 0, c: 0, l: 0 }, ['0,1,0']);

    const leaves = MazeSolver.findReachableLeaves(maze, { r: 0, c: 0, l: 0 });
    const leafKeys = leaves.map(l => maze.nodeKey(l)).sort();
    expect(leafKeys).toEqual(['0,2,0']);
  });

  it('handles cycles without infinite loop', () => {
    const maze = new RailroadMaze(3, 1);
    maze.addEdge({ r: 0, c: 0, l: 0 }, { r: 0, c: 1, l: 0 });
    maze.addEdge({ r: 0, c: 1, l: 0 }, { r: 0, c: 2, l: 0 });
    maze.addEdge({ r: 0, c: 2, l: 0 }, { r: 0, c: 0, l: 0 }); // cycle
    maze.addEdge({ r: 0, c: 1, l: 0 }, { r: 1, c: 1, l: 0 });
    maze.toggleStartingPoint({ r: 0, c: 0, l: 0 });

    const start = performance.now();
    const leaves = MazeSolver.findReachableLeaves(maze, { r: 0, c: 0, l: 0 });
    const elapsed = performance.now() - start;

    expect(elapsed).toBeLessThan(1000);
    const leafKeys = leaves.map(l => maze.nodeKey(l)).sort();
    expect(leafKeys).toEqual(['1,1,0']);
  });

  it('finds all paths', () => {
    const maze = new RailroadMaze(3, 1);
    maze.addEdge({ r: 0, c: 0, l: 0 }, { r: 0, c: 1, l: 0 });
    maze.addEdge({ r: 0, c: 0, l: 0 }, { r: 1, c: 0, l: 0 });
    maze.toggleStartingPoint({ r: 0, c: 0, l: 0 });

    const paths = MazeSolver.findAllPaths(maze, { r: 0, c: 0, l: 0 });
    expect(paths).toHaveLength(2);
  });

  it('gets reachable graph correctly', () => {
    const maze = new RailroadMaze(3, 1);
    maze.addEdge({ r: 0, c: 0, l: 0 }, { r: 0, c: 1, l: 0 });
    maze.addEdge({ r: 0, c: 0, l: 0 }, { r: 1, c: 0, l: 0 });
    maze.addEdge({ r: 1, c: 1, l: 0 }, { r: 2, c: 2, l: 0 }); // disconnected
    maze.toggleStartingPoint({ r: 0, c: 0, l: 0 });

    const { reachableNodes, reachableEdges } = MazeSolver.getReachableGraph(maze, { r: 0, c: 0, l: 0 });
    expect(reachableNodes.size).toBe(3);
    expect(reachableEdges.size).toBe(2);
    expect(reachableNodes.has('1,1,0')).toBe(false);
  });

  it('traverses cross-layer edges', () => {
    const maze = new RailroadMaze(3, 3);
    maze.addEdge({ r: 0, c: 0, l: 0 }, { r: 0, c: 0, l: 1 });
    maze.addEdge({ r: 0, c: 0, l: 1 }, { r: 0, c: 0, l: 2 });
    maze.toggleStartingPoint({ r: 0, c: 0, l: 0 });

    const leaves = MazeSolver.findReachableLeaves(maze, { r: 0, c: 0, l: 0 });
    expect(leaves).toHaveLength(1);
    expect(maze.nodeKey(leaves[0])).toBe('0,0,2');
  });
});
