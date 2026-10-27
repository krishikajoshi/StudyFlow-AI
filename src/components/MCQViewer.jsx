import { useState, useMemo } from "react";
import MarkdownRenderer from "./MarkdownRenderer";
import { parseMCQs } from "../utils/aiFormatters";
import { saveQuizAttempt } from "../utils/storage";

export default function MCQViewer({
  content,
  requestedCount,
  quizTitle = "Practice Quiz",
  courseId = null,
  noteId = null,
  onAttemptSaved,
  onRegenerate,
  onGenerateMore,
}) {
  const [userAnswers, setUserAnswers] = useState({});
  const [revealedAnswers, setRevealedAnswers] = useState({});
  const [savedAttempt, setSavedAttempt] = useState(false);

  const questions = useMemo(() => parseMCQs(content), [content]);

  // If questions could not be parsed into cards, fallback cleanly to MarkdownRenderer
  if (!questions || questions.length === 0) {
    return <MarkdownRenderer content={content} />;
  }

  function handleSelectOption(qId, label) {
    setUserAnswers((prev) => ({
      ...prev,
      [qId]: label,
    }));
    // Automatically reveal explanation upon selecting
    setRevealedAnswers((prev) => ({
      ...prev,
      [qId]: true,
    }));
  }

  function toggleReveal(qId) {
    setRevealedAnswers((prev) => ({
      ...prev,
      [qId]: !prev[qId],
    }));
  }

  function resetQuiz() {
    setUserAnswers({});
    setRevealedAnswers({});
    setSavedAttempt(false);
  }

  function revealAll() {
    const all = {};
    questions.forEach((q) => {
      all[q.id] = true;
    });
    setRevealedAnswers(all);
  }

  // Calculate score
  const totalQuestions = questions.length;
  const answeredCount = Object.keys(userAnswers).length;
  let correctCount = 0;
  const incorrectQuestions = [];

  questions.forEach((q) => {
    const selected = userAnswers[q.id];
    if (selected && q.correctLetter && selected === q.correctLetter) {
      correctCount++;
    } else if (selected && q.correctLetter && selected !== q.correctLetter) {
      incorrectQuestions.push({
        question: q.question,
        selectedOption: selected,
        correctOption: q.correctLetter,
        correctAnswerText: q.correctAnswerText,
        explanation: q.explanation,
      });
    }
  });

  function handleSaveAttempt() {
    if (answeredCount === 0 || savedAttempt) return;

    const attempt = saveQuizAttempt({
      title: quizTitle,
      courseId,
      noteId,
      totalQuestions: totalQuestions,
      correctCount: correctCount,
      incorrectQuestions,
    });

    setSavedAttempt(true);
    if (onAttemptSaved) onAttemptSaved(attempt);
    setTimeout(() => setSavedAttempt(false), 3000);
  }

  const isCountFewer = requestedCount && questions.length < requestedCount;

  return (
    <div className="mcq-quiz-container">
      <div className="mcq-quiz-header">
        <div className="mcq-quiz-title-wrap">
          <span className="mcq-quiz-badge">✦ Interactive Practice Quiz</span>
          <p className="mcq-quiz-subtitle">
            {isCountFewer
              ? `Generated ${questions.length} of ${requestedCount} requested questions from this material.`
              : `Total questions: ${questions.length} practice questions ready to test your knowledge.`}
          </p>
        </div>

        <div className="mcq-quiz-stats">
          <div className="mcq-stat-item">
            <span className="mcq-stat-number">
              {answeredCount}/{totalQuestions}
            </span>
            <span className="mcq-stat-label">Answered</span>
          </div>

          {answeredCount > 0 && (
            <div className="mcq-stat-item">
              <span className="mcq-stat-number mcq-stat-score">
                {correctCount}/{answeredCount}
              </span>
              <span className="mcq-stat-label">
                {Math.round((correctCount / answeredCount) * 100)}% Correct
              </span>
            </div>
          )}

          <div className="mcq-quiz-actions">
            {answeredCount > 0 && (
              <button
                type="button"
                className={`mcq-action-btn ${savedAttempt ? "is-saved" : ""}`}
                onClick={handleSaveAttempt}
                title="Save attempt to Analytics"
              >
                {savedAttempt ? "Saved ✓" : "Save Score"}
              </button>
            )}
            <button
              type="button"
              className="mcq-action-btn"
              onClick={revealAll}
              title="Reveal all answers"
            >
              Reveal All
            </button>
            <button
              type="button"
              className="mcq-action-btn"
              onClick={resetQuiz}
              title="Reset all questions to try again"
            >
              Reset
            </button>
            {onRegenerate && (
              <button
                type="button"
                className="mcq-action-btn"
                onClick={onRegenerate}
                title="Generate a fresh quiz"
              >
                ↺ New Questions
              </button>
            )}
          </div>
        </div>
      </div>

      {isCountFewer && (
        <div className="mcq-count-warning-banner">
          <div>
            <strong>Generated {questions.length} of {requestedCount} requested questions</strong>
            <p>
              The AI synthesized {questions.length} distinct questions for this section of notes.
              You can generate additional questions to reach your target or practice these now.
            </p>
          </div>
          <div className="mcq-warning-actions">
            {onGenerateMore && (
              <button
                type="button"
                className="mcq-warning-btn primary"
                onClick={() => onGenerateMore(requestedCount - questions.length)}
              >
                ＋ Generate Remaining ({requestedCount - questions.length})
              </button>
            )}
            {onRegenerate && (
              <button
                type="button"
                className="mcq-warning-btn"
                onClick={onRegenerate}
              >
                ↺ Retry All {requestedCount}
              </button>
            )}
          </div>
        </div>
      )}


      <div className="mcq-cards-list">
        {questions.map((q, idx) => {
          const selected = userAnswers[q.id];
          const isRevealed = Boolean(revealedAnswers[q.id]);
          const isCorrect = selected && q.correctLetter && selected === q.correctLetter;
          const isAnswered = Boolean(selected);

          return (
            <div
              key={q.id}
              className={`mcq-card ${
                isAnswered
                  ? isCorrect
                    ? "is-correct-card"
                    : "is-incorrect-card"
                  : ""
              }`}
            >
              <div className="mcq-card-header">
                <div className="mcq-question-number">
                  Question {idx + 1} of {totalQuestions}
                </div>
                {isAnswered && (
                  <span
                    className={`mcq-status-pill ${
                      isCorrect ? "pill-correct" : "pill-incorrect"
                    }`}
                  >
                    {isCorrect ? "✓ Correct" : "✕ Incorrect"}
                  </span>
                )}
              </div>

              <div className="mcq-question-text">{q.question}</div>

              <div className="mcq-options-grid">
                {q.options.map((opt) => {
                  const isSelected = selected === opt.label;
                  const isThisCorrect =
                    isRevealed && q.correctLetter && opt.label === q.correctLetter;
                  const isThisWrong = isSelected && !isCorrect;

                  let optionClass = "mcq-option-btn";
                  if (isThisCorrect) {
                    optionClass += " option-correct";
                  } else if (isThisWrong) {
                    optionClass += " option-wrong";
                  } else if (isSelected) {
                    optionClass += " option-selected";
                  }

                  return (
                    <button
                      key={opt.label}
                      type="button"
                      className={optionClass}
                      onClick={() => handleSelectOption(q.id, opt.label)}
                    >
                      <span className="mcq-option-letter">{opt.label}</span>
                      <span className="mcq-option-text">{opt.text}</span>
                      {isThisCorrect && (
                        <span className="mcq-option-check">✓</span>
                      )}
                      {isThisWrong && (
                        <span className="mcq-option-cross">✕</span>
                      )}
                    </button>
                  );
                })}
              </div>

              <div className="mcq-card-footer">
                {!isRevealed ? (
                  <button
                    type="button"
                    className="mcq-show-answer-btn"
                    onClick={() => toggleReveal(q.id)}
                  >
                    Show Answer & Explanation →
                  </button>
                ) : (
                  <div className="mcq-explanation-box">
                    <div className="mcq-answer-row">
                      <span className="mcq-answer-tag">✓ Correct Answer</span>
                      <strong>
                        {q.correctAnswerText ||
                          `${q.correctLetter}. ${
                            q.options.find((o) => o.label === q.correctLetter)?.text || ""
                          }`}
                      </strong>
                    </div>

                    {q.explanation && (
                      <div className="mcq-explanation-text">
                        <span className="mcq-exp-label">💡 Explanation:</span>
                        <p>{q.explanation}</p>
                      </div>
                    )}

                    <button
                      type="button"
                      className="mcq-hide-answer-btn"
                      onClick={() => toggleReveal(q.id)}
                    >
                      Hide Explanation ∧
                    </button>
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
