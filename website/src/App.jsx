import species from "./data/species.json";
import "./App.css";

function App() {
  return (
    <div className="app">
      <h1>🐱🐰🚂 Cat Bunny Railroad</h1>
      <p className="subtitle">A catalog of living things</p>
      <ul className="species-list">
        {species.map((sp) => (
          <li key={sp.ott_id} className="species-card">
            {sp.image ? (
              <img
                className="species-img"
                src={sp.image.src}
                alt={sp.name}
                loading="lazy"
              />
            ) : (
              <div className="species-img placeholder">?</div>
            )}
            <span className="species-name">{sp.name}</span>
            {sp.image && (
              <span className="species-credit">
                {sp.image.credit} · {sp.image.licence}
              </span>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}

export default App;
