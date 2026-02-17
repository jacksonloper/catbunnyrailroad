/**
 * Solver for Railroad Layered Maze.
 * Handles graph traversal, path finding, and leaf finding with cycle detection.
 */
export class MazeSolver {
  static findReachableLeaves(maze, startNode) {
    const leaves = [];
    const visited = new Set();

    function dfs(node) {
      const key = maze.nodeKey(node);
      if (visited.has(key)) return;
      visited.add(key);

      const children = maze.getAvailableChildren(node, startNode);
      if (children.length === 0) {
        leaves.push({ ...node });
      } else {
        for (const child of children) {
          dfs(child);
        }
      }
    }

    dfs(startNode);
    return leaves;
  }

  static findAllPaths(maze, startNode) {
    const paths = [];
    const pathStack = [];
    const onStack = new Set();

    function dfs(node) {
      const key = maze.nodeKey(node);
      if (onStack.has(key)) return;

      pathStack.push({ ...node });
      onStack.add(key);

      const children = maze.getAvailableChildren(node, startNode);
      if (children.length === 0) {
        paths.push([...pathStack]);
      } else {
        for (const child of children) {
          dfs(child);
        }
      }

      pathStack.pop();
      onStack.delete(key);
    }

    dfs(startNode);
    return paths;
  }

  static getReachableGraph(maze, startNode) {
    const reachableNodes = new Set();
    const reachableEdges = new Set();
    const visited = new Set();

    function dfs(node) {
      const key = maze.nodeKey(node);
      if (visited.has(key)) return;
      visited.add(key);
      reachableNodes.add(key);

      const children = maze.getAvailableChildren(node, startNode);
      for (const child of children) {
        const edgeKey = key + '->' + maze.nodeKey(child);
        reachableEdges.add(edgeKey);
        dfs(child);
      }
    }

    dfs(startNode);
    return { reachableNodes, reachableEdges };
  }
}
