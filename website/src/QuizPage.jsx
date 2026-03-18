import { useState, useCallback } from "react";
import { Link } from "react-router-dom";
import { pickRandomTaxa, solveQuiz, QUIZ_TYPES } from "./quizUtils.js";
import { capitalize } from "./treeUtils.js";
import Navbar from "./Navbar.jsx";
import "./QuizPage.css";

/* ───── helpers ───── */

function newRound(rootOttId = null) {
  const three = pickRandomTaxa(3, rootOttId);
  return { taxa: three, chosen: null, solved: null };
}

/** Render a small relationship tree as nested HTML. */
function MiniTree({ node }) {
  if (!node) return null;
  const taxaNames = (node.taxa || [])
    .filter(Boolean)
    .map((t) => capitalize(t.name))
    .join(", ");

  if (!node.children || node.children.length === 0) {
    return (
      <div className="mini-tree-leaf">
        <span className="mini-tree-label">{taxaNames}</span>
      </div>
    );
  }

  return (
    <div className="mini-tree-node">
      <div className="mini-tree-branch-label">{node.name}</div>
      <div className="mini-tree-branches">
        {node.children.map((child, i) => (
          <MiniTree key={i} node={child} />
        ))}
      </div>
    </div>
  );
}

/* ───── main component ───── */

export default function QuizPage() {
  const [quizTypeIdx, setQuizTypeIdx] = useState(() => {
    const params = new URLSearchParams(window.location.search);
    const t = params.get("type");
    if (t !== null) {
      const ottId = t === "" ? null : Number(t);
      const idx = QUIZ_TYPES.findIndex((qt) => qt.rootOttId === ottId);
      if (idx >= 0) return idx;
    }
    return 0;
  });
  const rootOttId = QUIZ_TYPES[quizTypeIdx].rootOttId;
  const [round, setRound] = useState(() => newRound(rootOttId));

  const handlePick = useCallback(
    (index) => {
      if (round.solved) return; // already answered
      const ottIds = round.taxa.map((t) => t.ott_id);
      const result = solveQuiz(ottIds);
      setRound((r) => ({ ...r, chosen: index, solved: result }));
    },
    [round.taxa, round.solved],
  );

  const handleNext = useCallback(() => {
    setRound(newRound(rootOttId));
  }, [rootOttId]);

  const handleTypeChange = useCallback((e) => {
    const idx = Number(e.target.value);
    setQuizTypeIdx(idx);
    setRound(newRound(QUIZ_TYPES[idx].rootOttId));
    const ottId = QUIZ_TYPES[idx].rootOttId;
    const params = new URLSearchParams(window.location.search);
    if (ottId === null) {
      params.delete("type");
    } else {
      params.set("type", String(ottId));
    }
    const qs = params.toString();
    const url = `${window.location.pathname}${qs ? `?${qs}` : ""}`;
    window.history.replaceState(null, "", url);
  }, []);

  const { taxa, chosen, solved } = round;
  const isCorrect =
    solved && chosen !== null && chosen === solved.outgroupIndex;
  const isStar = solved && solved.outgroupIndex === null;

  return (
    <>
      <Navbar />
      <div className="quiz-page">
        <h2 className="quiz-title">🧬 Which is Most Distantly Related?</h2>
        <p className="quiz-subtitle">
          Pick the taxon that is the odd one out.
        </p>

        <div className="quiz-type-selector">
          <label htmlFor="quiz-type">Category: </label>
          <select
            id="quiz-type"
            value={quizTypeIdx}
            onChange={handleTypeChange}
          >
            {QUIZ_TYPES.map((qt, i) => (
              <option key={i} value={i}>
                {qt.label}
              </option>
            ))}
          </select>
        </div>

        <div className="quiz-choices">
          {taxa.map((t, i) => {
            let cls = "quiz-choice";
            if (solved) {
              if (isStar) {
                cls += " quiz-star";
              } else if (i === solved.outgroupIndex) {
                cls += " quiz-correct";
              }
              if (i === chosen && !isCorrect && !isStar) {
                cls += " quiz-wrong";
              }
            }
            return (
              <button
                key={t.ott_id}
                className={cls}
                onClick={() => handlePick(i)}
                disabled={!!solved}
              >
                {t.image_url && (
                  <img
                    className="quiz-choice-img"
                    src={t.image_url}
                    alt={t.name}
                  />
                )}
                <span className="quiz-choice-name">{capitalize(t.name)}</span>
                <span className="quiz-choice-sci">{t.uniqname}</span>
              </button>
            );
          })}
        </div>

        {solved && (
          <div className="quiz-result">
            {isStar ? (
              <p className="quiz-result-text quiz-star-text">
                ⭐ All three are equally related — it&apos;s a three-way tie!
              </p>
            ) : isCorrect ? (
              <p className="quiz-result-text quiz-correct-text">
                ✅ Correct!{" "}
                <strong>{capitalize(taxa[solved.outgroupIndex].name)}</strong> is
                the most distantly related.
              </p>
            ) : (
              <p className="quiz-result-text quiz-wrong-text">
                ❌ Not quite. The answer is{" "}
                <strong>{capitalize(taxa[solved.outgroupIndex].name)}</strong>.
              </p>
            )}

            <div className="quiz-tree-section">
              <h3>Relationship Tree</h3>
              <MiniTree node={solved.mrcaTree} />
            </div>

            {!isStar && (
              <Link
                className="quiz-clades-link"
                to={(() => {
                  const closer = solved.mrcaTree.children[0].taxa;
                  const outgroup = solved.mrcaTree.children[1].taxa[0];
                  const rootRef = `${closer[0].ott_id}_${outgroup.ott_id}`;
                  const pairRef = `${closer[0].ott_id}_${closer[1].ott_id}`;
                  const hlIds = taxa.map((t) => t.ott_id).join(",");
                  return `/clades?r=${rootRef}&e=${rootRef},${pairRef}&h=${hlIds}`;
                })()}
              >
                🌿 Explore in Clades
              </Link>
            )}

            <button className="quiz-next-btn" onClick={handleNext}>
              Next Question →
            </button>
          </div>
        )}
      </div>
    </>
  );
}
