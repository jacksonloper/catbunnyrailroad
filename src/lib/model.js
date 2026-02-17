/**
 * Railroad Layered Maze data model.
 * Nodes are (row, col, layer) triples on a grid.
 */
export class RailroadMaze {
  constructor(gridSize = 3, layers = 1) {
    this.gridSize = gridSize;
    this.layers = layers;
    this.edges = [];
    this.startingPoints = new Set();
    this.instructions = new Map();
  }

  nodeKey(node) {
    return `${node.r},${node.c},${node.l}`;
  }

  parseKey(key) {
    const [r, c, l] = key.split(',').map(Number);
    return { r, c, l };
  }

  setGridSize(n) {
    this.gridSize = n;
    this._pruneInvalidNodes();
  }

  setLayers(m) {
    this.layers = m;
    this._pruneInvalidNodes();
  }

  _isValid(node) {
    return node.r >= 0 && node.r < this.gridSize &&
           node.c >= 0 && node.c < this.gridSize &&
           node.l >= 0 && node.l < this.layers;
  }

  _pruneInvalidNodes() {
    this.edges = this.edges.filter(e => this._isValid(e.from) && this._isValid(e.to));
    for (const key of [...this.startingPoints]) {
      if (!this._isValid(this.parseKey(key))) {
        this.startingPoints.delete(key);
      }
    }
    for (const [nodeKey] of [...this.instructions]) {
      if (!this._isValid(this.parseKey(nodeKey))) {
        this.instructions.delete(nodeKey);
      } else {
        const inner = this.instructions.get(nodeKey);
        for (const [startKey] of [...inner]) {
          if (!this._isValid(this.parseKey(startKey))) {
            inner.delete(startKey);
          }
        }
        if (inner.size === 0) this.instructions.delete(nodeKey);
      }
    }
  }

  addEdge(from, to) {
    const fromKey = this.nodeKey(from);
    const toKey = this.nodeKey(to);
    const exists = this.edges.some(
      e => this.nodeKey(e.from) === fromKey && this.nodeKey(e.to) === toKey
    );
    if (!exists && this._isValid(from) && this._isValid(to)) {
      this.edges.push({ from: { ...from }, to: { ...to } });
      return true;
    }
    return false;
  }

  removeEdge(from, to) {
    const fromKey = this.nodeKey(from);
    const toKey = this.nodeKey(to);
    const idx = this.edges.findIndex(
      e => this.nodeKey(e.from) === fromKey && this.nodeKey(e.to) === toKey
    );
    if (idx !== -1) {
      this.edges.splice(idx, 1);
      return true;
    }
    return false;
  }

  toggleStartingPoint(node) {
    const key = this.nodeKey(node);
    if (!this._isValid(node)) return false;
    if (this.startingPoints.has(key)) {
      this.startingPoints.delete(key);
      for (const [, inner] of this.instructions) {
        inner.delete(key);
      }
      return false;
    } else {
      this.startingPoints.add(key);
      return true;
    }
  }

  getChildren(node) {
    const key = this.nodeKey(node);
    return this.edges
      .filter(e => this.nodeKey(e.from) === key)
      .map(e => ({ ...e.to }));
  }

  getAvailableChildren(node, startNode) {
    const nodeK = this.nodeKey(node);
    const startK = this.nodeKey(startNode);
    const children = this.getChildren(node);
    if (children.length < 2) {
      return children;
    }
    const inner = this.instructions.get(nodeK);
    if (!inner || !inner.has(startK)) {
      return children;
    }
    const allowed = inner.get(startK);
    return children.filter(c => allowed.has(this.nodeKey(c)));
  }

  setInstruction(node, startNode, childKeys) {
    const nodeK = this.nodeKey(node);
    const startK = this.nodeKey(startNode);
    if (!this.instructions.has(nodeK)) {
      this.instructions.set(nodeK, new Map());
    }
    const inner = this.instructions.get(nodeK);
    inner.set(startK, new Set(childKeys));
  }

  removeInstruction(node, startNode) {
    const nodeK = this.nodeKey(node);
    const startK = this.nodeKey(startNode);
    const inner = this.instructions.get(nodeK);
    if (inner) {
      inner.delete(startK);
      if (inner.size === 0) this.instructions.delete(nodeK);
    }
  }

  getInstructionNodes() {
    const result = [];
    const seen = new Set();
    for (const edge of this.edges) {
      const key = this.nodeKey(edge.from);
      if (!seen.has(key)) {
        seen.add(key);
        const children = this.getChildren(edge.from);
        if (children.length >= 2) {
          result.push({ node: { ...edge.from }, children });
        }
      }
    }
    return result;
  }

  getAllNodes() {
    const keys = new Set();
    for (const edge of this.edges) {
      keys.add(this.nodeKey(edge.from));
      keys.add(this.nodeKey(edge.to));
    }
    return [...keys].map(k => this.parseKey(k));
  }

  isLeaf(node) {
    return this.getChildren(node).length === 0;
  }

  getLeaves() {
    const allNodes = this.getAllNodes();
    return allNodes.filter(n => this.isLeaf(n));
  }

  clearAll() {
    this.edges = [];
    this.startingPoints.clear();
    this.instructions.clear();
  }

  exportJSON() {
    const instrObj = {};
    for (const [nodeKey, inner] of this.instructions) {
      instrObj[nodeKey] = {};
      for (const [startKey, childSet] of inner) {
        instrObj[nodeKey][startKey] = [...childSet];
      }
    }
    return JSON.stringify({
      gridSize: this.gridSize,
      layers: this.layers,
      edges: this.edges,
      startingPoints: [...this.startingPoints],
      instructions: instrObj,
    }, null, 2);
  }

  importJSON(json) {
    const data = typeof json === 'string' ? JSON.parse(json) : json;
    this.gridSize = data.gridSize;
    this.layers = data.layers;
    this.edges = data.edges.map(e => ({
      from: { r: e.from.r, c: e.from.c, l: e.from.l },
      to: { r: e.to.r, c: e.to.c, l: e.to.l },
    }));
    this.startingPoints = new Set(data.startingPoints);
    this.instructions = new Map();
    if (data.instructions) {
      for (const [nodeKey, inner] of Object.entries(data.instructions)) {
        const innerMap = new Map();
        for (const [startKey, arr] of Object.entries(inner)) {
          innerMap.set(startKey, new Set(arr));
        }
        this.instructions.set(nodeKey, innerMap);
      }
    }
  }

  clone() {
    const copy = new RailroadMaze();
    copy.importJSON(this.exportJSON());
    return copy;
  }
}
