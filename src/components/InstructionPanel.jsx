export default function InstructionPanel({ maze, nodeKey, startKey, onUpdate }) {
  const node = maze.parseKey(nodeKey);
  const children = maze.getChildren(node);

  const inner = maze.instructions.get(nodeKey);
  const currentAllowed = inner && inner.has(startKey) ? inner.get(startKey) : null;

  const childStates = children.map(child => ({
    key: maze.nodeKey(child),
    child,
    allowed: currentAllowed ? currentAllowed.has(maze.nodeKey(child)) : true,
  }));

  const applyUpdate = (allowedKeys) => {
    const startNode = maze.parseKey(startKey);
    maze.setInstruction(node, startNode, allowedKeys);
    onUpdate();
  };

  const toggleChild = (childKey) => {
    const newAllowed = childStates.map(cs => {
      if (cs.key === childKey) return { ...cs, allowed: !cs.allowed };
      return cs;
    }).filter(cs => cs.allowed).map(cs => cs.key);
    applyUpdate(newAllowed);
  };

  const selectAll = () => {
    applyUpdate(childStates.map(cs => cs.key));
  };

  const selectNone = () => {
    applyUpdate([]);
  };

  const reset = () => {
    maze.removeInstruction(node, maze.parseKey(startKey));
    onUpdate();
  };

  return (
    <div className="sidebar-section">
      <h4>Instructions for ({node.r},{node.c},{node.l})</h4>
      <p className="panel-subtitle">Starting point: {startKey}</p>
      <div className="instruction-children">
        {childStates.map(cs => (
          <label key={cs.key} className="instruction-item">
            <input
              type="checkbox"
              checked={cs.allowed}
              onChange={() => toggleChild(cs.key)}
            />
            → ({cs.child.r},{cs.child.c},{cs.child.l})
          </label>
        ))}
      </div>
      <div className="instruction-actions">
        <button className="btn btn-sm" onClick={selectAll}>Select All</button>
        <button className="btn btn-sm" onClick={selectNone}>Select None</button>
        <button className="btn btn-sm" onClick={reset}>Reset</button>
      </div>
    </div>
  );
}
