export default function InfoPanel({ maze, mode, selectedStartKey, leaves, paths }) {
  if (mode === 'visualize' && selectedStartKey && leaves) {
    const leafList = leaves.map(l => `(${l.r},${l.c},${l.l})`).join(', ');
    return (
      <div className="info-bar">
        <h4>Visualization Results</h4>
        <div className="info-section">
          <strong>Final Leaves:</strong> {leafList || 'None'}
        </div>
        <div className="info-section">
          <strong>Paths ({paths.length}):</strong>
          <div className="paths-list">
            {paths.length === 0 ? 'None' : paths.map((p, i) => (
              <div key={i}>{p.map(n => `(${n.r},${n.c},${n.l})`).join(' → ')}</div>
            ))}
          </div>
        </div>
      </div>
    );
  }

  const nodes = maze.getAllNodes().length;
  const edges = maze.edges.length;
  const starts = maze.startingPoints.size;
  const leafCount = maze.getLeaves().length;

  return (
    <div className="info-bar">
      <h4>Graph Info</h4>
      <div className="info-section">
        <span className="info-label">Nodes:</span> {nodes}{' '}
        <span className="info-label">Edges:</span> {edges}{' '}
        <span className="info-label">Starts:</span> {starts}{' '}
        <span className="info-label">Leaves:</span> {leafCount}
      </div>
    </div>
  );
}
