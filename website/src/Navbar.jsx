import { NavLink } from "react-router-dom";
import "./Navbar.css";

export default function Navbar() {
  return (
    <nav className="site-nav">
      <NavLink to="/" end className="site-nav-link">
        🐱🐰🚂 Home
      </NavLink>
      <NavLink to="/clades" className="site-nav-link">
        🌿 Clades
      </NavLink>
      <NavLink to={"/explore/304358"} className="site-nav-link">
        🔍 Explore
      </NavLink>
      <NavLink to="/quiz" className="site-nav-link">
        🧬 Quiz
      </NavLink>
    </nav>
  );
}
