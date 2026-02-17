export default function Sidebar({
  gridSize,
  layers,
  mode,
  startKeys,
  selectedStartKey,
  onGridSizeChange,
  onLayersChange,
  onModeChange,
  onStartSelect,
  onClear,
  onExport,
  onImport,
  children,
}) {
  const modes = [
    { value: 'edge', icon: '↗', label: 'Edges' },
    { value: 'start', icon: '⭐', label: 'Starts' },
    { value: 'instructions', icon: '📋', label: 'Instructions' },
    { value: 'visualize', icon: '👁', label: 'Visualize' },
  ];

  const showStartSelect = mode === 'instructions' || mode === 'visualize';

  const handleFileChange = (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      onImport(ev.target.result);
    };
    reader.readAsText(file);
    e.target.value = '';
  };

  return (
    <aside className="sidebar">
      <div className="sidebar-header">
        <h1>🚂 Maze Editor</h1>
        <span className="subtitle">Railroad Layered Maze</span>
      </div>

      <div className="sidebar-section">
        <h3>Grid Settings</h3>
        <div className="form-row">
          <label htmlFor="grid-size">Grid Size</label>
          <input
            type="number"
            id="grid-size"
            value={gridSize}
            min={1}
            max={10}
            onChange={(e) => onGridSizeChange(Math.max(1, Math.min(10, parseInt(e.target.value) || 3)))}
          />
        </div>
        <div className="form-row">
          <label htmlFor="layers">Layers</label>
          <input
            type="number"
            id="layers"
            value={layers}
            min={1}
            max={5}
            onChange={(e) => onLayersChange(Math.max(1, Math.min(5, parseInt(e.target.value) || 1)))}
          />
        </div>
      </div>

      <div className="sidebar-section">
        <h3>Edit Mode</h3>
        <div className="mode-selector">
          {modes.map(m => (
            <button
              key={m.value}
              className={`mode-btn${mode === m.value ? ' active' : ''}`}
              onClick={() => onModeChange(m.value)}
            >
              <span className="mode-icon">{m.icon}</span>{m.label}
            </button>
          ))}
        </div>
        {showStartSelect && (
          <div style={{ marginTop: '10px' }}>
            <select value={selectedStartKey || ''} onChange={(e) => onStartSelect(e.target.value || null)}>
              <option value="">-- Select Starting Point --</option>
              {startKeys.map(k => (
                <option key={k} value={k}>Start ({k})</option>
              ))}
            </select>
          </div>
        )}
      </div>

      {children}

      <div className="sidebar-section">
        <h3>Actions</h3>
        <div className="btn-group">
          <button className="btn" onClick={onExport}>Export JSON</button>
          <label className="btn" style={{ cursor: 'pointer' }}>
            Import JSON
            <input type="file" accept=".json" style={{ display: 'none' }} onChange={handleFileChange} />
          </label>
          <button className="btn btn-danger" onClick={onClear}>Clear All</button>
        </div>
      </div>
    </aside>
  );
}
