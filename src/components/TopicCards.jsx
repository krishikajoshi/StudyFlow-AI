import { useMemo } from "react";
import MarkdownRenderer from "./MarkdownRenderer";
import { parseTopics } from "../utils/aiFormatters";

export default function TopicCards({ content }) {
  const topics = useMemo(() => parseTopics(content), [content]);

  // If topics could not be parsed into structured cards, fallback to MarkdownRenderer
  if (!topics || topics.length === 0) {
    return <MarkdownRenderer content={content} />;
  }

  return (
    <div className="topic-cards-container">
      <div className="topic-cards-header">
        <span className="topic-badge">🧠 Curriculum & Difficulty Analysis</span>
        <p className="topic-subtitle">
          Key topics identified from your study material, organized by conceptual difficulty.
        </p>
      </div>

      <div className="topic-cards-grid">
        {topics.map((topic, index) => {
          const diffLower = topic.difficulty.toLowerCase();
          const diffClass =
            diffLower.includes("easy")
              ? "diff-easy"
              : diffLower.includes("hard")
              ? "diff-hard"
              : "diff-medium";

          return (
            <div key={topic.id} className="topic-card">
              <div className="topic-card-top">
                <div className="topic-index-badge">Topic {index + 1}</div>
                <span className={`topic-diff-pill ${diffClass}`}>
                  {diffLower.includes("easy") && "🟢 "}
                  {diffLower.includes("medium") && "🟡 "}
                  {diffLower.includes("hard") && "🟣 "}
                  {topic.difficulty}
                </span>
              </div>

              <h3 className="topic-title">{topic.title}</h3>

              {topic.covers && (
                <div className="topic-section">
                  <span className="topic-section-label">What it covers:</span>
                  <p className="topic-text">{topic.covers}</p>
                </div>
              )}

              {topic.why && (
                <div className="topic-section topic-why-box">
                  <span className="topic-section-label">Difficulty rationale:</span>
                  <p className="topic-text">{topic.why}</p>
                </div>
              )}

              {topic.subtopics && topic.subtopics.length > 0 && (
                <div className="topic-section">
                  <span className="topic-section-label">Key subtopics & concepts:</span>
                  <ul className="topic-subtopics-list">
                    {topic.subtopics.map((sub, sIdx) => (
                      <li key={sIdx} className="topic-subtopic-item">
                        {sub}
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {topic.tip && (
                <div className="topic-tip-card">
                  <span className="topic-tip-icon">💡</span>
                  <div>
                    <strong>Study Tip</strong>
                    <p>{topic.tip}</p>
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
