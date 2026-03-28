import { useState } from "react";
import { Link } from "react-router-dom";
import taxa from "./data/taxa.json";
import Navbar from "./Navbar.jsx";
import "./ListPage.css";

const taxaByOttId = Object.fromEntries(taxa.map((t) => [t.ott_id, t]));

const LISTS = [
  {
    label: "Herbs & Spices",
    description:
      "50 culinary herbs and spices — each a species-level monophyletic taxon.",
    ottIds: [
      305911, // basil
      305918, // oregano
      61897, // sweet marjoram
      907458, // thyme
      778824, // rosemary
      820645, // sage
      382249, // summer savory
      382237, // winter savory
      378039, // dill
      498475, // fennel
      2476, // coriander
      2485, // parsley
      105027, // chervil
      1070795, // tarragon
      571537, // bay laurel
      27827, // mint (spearmint)
      355945, // lemon balm
      880695, // hyssop
      830200, // catnip
      130944, // lovage
      321836, // curry leaf
      501622, // pandan
      626975, // chives
      748370, // garlic
      781600, // onion
      1063866, // ginger
      168258, // turmeric
      1063872, // greater galangal
      792711, // green cardamom
      472526, // black pepper
      97780, // long pepper
      311088, // cubeb
      473836, // chili pepper (bell pepper)
      473831, // bird's-eye chili
      216347, // habanero pepper
      833635, // black mustard
      309279, // brown mustard
      359058, // white mustard
      961856, // cumin
      498463, // caraway
      671429, // ajwain
      2472, // celery
      1007994, // fenugreek
      142360, // nigella
      542824, // saffron crocus
      713007, // vanilla
      481247, // cinnamon (true cinnamon)
      130603, // Indonesian cassia
      200286, // clove
      1011084, // allspice
    ],
  },
];

function getSelectedIndex() {
  const params = new URLSearchParams(window.location.search);
  const v = params.get("list");
  if (v !== null) {
    const idx = Number(v);
    if (idx >= 0 && idx < LISTS.length) return idx;
  }
  return 0;
}

export default function ListPage() {
  const [selectedIdx, setSelectedIdx] = useState(getSelectedIndex);

  const handleChange = (e) => {
    const idx = Number(e.target.value);
    setSelectedIdx(idx);
    const url = new URL(window.location);
    if (idx === 0) {
      url.searchParams.delete("list");
    } else {
      url.searchParams.set("list", idx);
    }
    window.history.replaceState({}, "", url);
  };

  const list = LISTS[selectedIdx];
  const items = list.ottIds.map((id) => taxaByOttId[id]).filter(Boolean);

  const cladesLink = (() => {
    const hlIds = list.ottIds.join(",");
    return `/clades?h=${hlIds}`;
  })();

  return (
    <>
      <Navbar />
      <div className="list-page">
        <h2>Preset Lists</h2>

        <div className="list-controls">
          <select
            className="list-select"
            value={selectedIdx}
            onChange={handleChange}
          >
            {LISTS.map((l, i) => (
              <option key={i} value={i}>
                {l.label}
              </option>
            ))}
          </select>
          <Link className="list-clades-link" to={cladesLink}>
            🌿 View in Clades
          </Link>
        </div>

        <p className="list-description">{list.description}</p>

        <div className="list-grid">
          {items.map((t) => (
            <Link
              key={t.ott_id}
              to={`/explore/${t.ott_id}`}
              className="list-item"
            >
              <img
                src={t.image_url}
                alt={t.name}
                className="list-item-img"
                loading="lazy"
              />
              <div className="list-item-name">{t.name}</div>
              <div className="list-item-sci">{t.uniqname}</div>
            </Link>
          ))}
        </div>
      </div>
    </>
  );
}
