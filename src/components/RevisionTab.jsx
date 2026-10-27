import { useState, useEffect } from "react";
import MarkdownRenderer from "./MarkdownRenderer";
import {
  getSavedNotes,
  getCourses,
  getQuizAttempts,
  getFlashcardDecks,
  getMockTests,
  updateFlashcardReview,
  logStudySession,
} from "../utils/storage";

export default function RevisionTab({
  setActivePage,
  onOpenNote,
  onOpenStudyPlanner = null,
}) {
  const [notes, setNotes] = useState(() => getSavedNotes());
  const [courses, setCourses] = useState(() => getCourses());
  const [quizzes, setQuizzes] = useState(() => getQuizAttempts());
  const [flashcardDecks, setFlashcardDecks] = useState(() => getFlashcardDecks());
  const [mockTests, setMockTests] = useState(() => getMockTests());
  const [mountTime] = useState(() => Date.now());

  // Active view: "flashcards" | "notes" | "mistakes" | "timer"
  const [activeSubTab, setActiveSubTab] = useState("flashcards");
  const [selectedCourseId, setSelectedCourseId] = useState("all");
  const [searchQuery, setSearchQuery] = useState("");

  // Flashcard practice session state
  const [activeDeck, setActiveDeck] = useState(null);
  const [currentCardIndex, setCurrentCardIndex] = useState(0);
  const [isAnswerRevealed, setIsAnswerRevealed] = useState(false);
  const [sessionCompleted, setSessionCompleted] = useState(false);

  // Timed revision sprint state
  const [timerMinutes, setTimerMinutes] = useState(15);
  const [secondsRemaining, setSecondsRemaining] = useState(15 * 60);
  const [isTimerRunning, setIsTimerRunning] = useState(false);
  const [timerLogged, setTimerLogged] = useState(false);

  // Viewing a saved revision document modal
  const [viewingItem, setViewingItem] = useState(null);

  function loadRevisionData() {
    setNotes(getSavedNotes());
    setCourses(getCourses());
    setQuizzes(getQuizAttempts());
    setFlashcardDecks(getFlashcardDecks());
    setMockTests(getMockTests());
  }

  useEffect(() => {
    const handleSync = () => loadRevisionData();
    window.addEventListener("studyflow_storage_sync", handleSync);
    return () => window.removeEventListener("studyflow_storage_sync", handleSync);
  }, []);

  // Timer countdown effect: updates cleanly inside the interval callback
  useEffect(() => {
    let interval = null;
    if (isTimerRunning && secondsRemaining > 0) {
      interval = setInterval(() => {
        setSecondsRemaining((prev) => {
          if (prev <= 1) {
            clearInterval(interval);
            setIsTimerRunning(false);
            setTimerLogged(true);
            logStudySession({
              type: "revision",
              durationMinutes: timerMinutes,
              title: `${timerMinutes}-Minute Revision Sprint`,
            });
            return 0;
          }
          return prev - 1;
        });
      }, 1000);
    }
    return () => clearInterval(interval);
  }, [isTimerRunning, secondsRemaining, timerMinutes]);

  function handleStartTimer(minutes) {
    setTimerMinutes(minutes);
    setSecondsRemaining(minutes * 60);
    setIsTimerRunning(true);
    setTimerLogged(false);
  }

  function handleResetTimer() {
    setIsTimerRunning(false);
    setSecondsRemaining(timerMinutes * 60);
    setTimerLogged(false);
  }

  // Flashcard review logic
  function startDeckPractice(deck) {
    setActiveDeck(deck);
    setCurrentCardIndex(0);
    setIsAnswerRevealed(false);
    setSessionCompleted(false);
  }

  function handleRateCard(rating) {
    if (!activeDeck || !activeDeck.cards) return;
    const card = activeDeck.cards[currentCardIndex];
    if (card) {
      updateFlashcardReview(activeDeck.id, card.id, rating);
    }

    if (currentCardIndex + 1 < activeDeck.cards.length) {
      setCurrentCardIndex((prev) => prev + 1);
      setIsAnswerRevealed(false);
    } else {
      setSessionCompleted(true);
      // Log 10 minutes study session for completing flashcard deck
      logStudySession({
        type: "flashcards",
        durationMinutes: 10,
        title: `Flashcards: ${activeDeck.title}`,
      });
      loadRevisionData();
    }
  }

  // Aggregate mistakes from practice quizzes and mock tests
  const allMistakes = [];
  quizzes.forEach((quiz) => {
    (quiz.incorrectQuestions || []).forEach((m) => {
      allMistakes.push({
        ...m,
        quizTitle: quiz.title,
        courseId: quiz.courseId,
        date: quiz.createdAt,
      });
    });
  });

  mockTests.forEach((test) => {
    (test.attempts || []).forEach((attempt) => {
      const evs = attempt.evaluations || {};
      (test.questions || []).forEach((q) => {
        const ev = evs[q.id];
        if (ev && (Number(ev.marksAwarded) || 0) < (q.marks || 1)) {
          allMistakes.push({
            question: q.question,
            quizTitle: `${test.title} (Mock Test)`,
            selectedOption: attempt.userAnswers?.[q.id] || "No answer",
            correctOption: q.correctOption,
            correctAnswerText: q.referenceAnswer || q.explanation,
            explanation: ev.feedback || q.explanation,
            courseId: test.courseId,
            date: attempt.createdAt || attempt.submittedAt,
            isMockTest: true,
            marksAwarded: ev.marksAwarded,
            maxMarks: q.marks,
          });
        }
      });
    });
  });

  // Filter saved revision notes by course and search query
  const revisionNotes = notes
    .filter((n) => n.revision || n.summary)
    .filter((n) => {
      const matchesCourse = selectedCourseId === "all" || n.courseId === selectedCourseId;
      const matchesSearch =
        !searchQuery.trim() ||
        (n.title || n.fileName || "").toLowerCase().includes(searchQuery.toLowerCase()) ||
        (n.revision || n.summary || "").toLowerCase().includes(searchQuery.toLowerCase());
      return matchesCourse && matchesSearch;
    });

  // Filter flashcard decks by course and search query
  const filteredFlashcardDecks = flashcardDecks.filter((d) => {
    const matchesCourse = selectedCourseId === "all" || d.courseId === selectedCourseId;
    const matchesSearch =
      !searchQuery.trim() ||
      (d.title || "").toLowerCase().includes(searchQuery.toLowerCase());
    return matchesCourse && matchesSearch;
  });

  // Filter mistakes by course and search query
  const filteredMistakes = allMistakes.filter((m) => {
    const matchesCourse = selectedCourseId === "all" || m.courseId === selectedCourseId;
    const matchesSearch =
      !searchQuery.trim() ||
      (m.question || "").toLowerCase().includes(searchQuery.toLowerCase()) ||
      (m.quizTitle || "").toLowerCase().includes(searchQuery.toLowerCase());
    return matchesCourse && matchesSearch;
  });

  // Cards due today
  const todayStr = new Date(mountTime).toISOString().split("T")[0];
  let totalCardsDue = 0;
  flashcardDecks.forEach((d) => {
    (d.cards || []).forEach((c) => {
      if (!c.nextReviewDate || c.nextReviewDate <= todayStr) {
        totalCardsDue++;
      }
    });
  });

  return (
    <div className="revision-tab-container">
      {/* HEADER SECTION */}
      <div className="revision-heading-row">
        <div>
          <div className="eyebrow">ACTIVE RECALL & SPACED REVIEW</div>
          <h1>
            Revision Hub<span>.</span>
          </h1>
          <p className="welcome-subtitle">
            Review saved flashcards, test your recall, study previous quiz mistakes, and run timed focus sprints.
          </p>
        </div>

        <div className="revision-due-pill">
          <span>⚡</span> {totalCardsDue} Flashcard{totalCardsDue === 1 ? "" : "s"} Due Today
        </div>
      </div>

      {/* REVISION SUB-NAV TABS */}
      <div className="revision-subnav">
        <button
          type="button"
          className={`revision-subnav-btn ${activeSubTab === "flashcards" ? "active" : ""}`}
          onClick={() => setActiveSubTab("flashcards")}
        >
          🗂 Flashcard Decks ({filteredFlashcardDecks.length})
        </button>
        <button
          type="button"
          className={`revision-subnav-btn ${activeSubTab === "notes" ? "active" : ""}`}
          onClick={() => setActiveSubTab("notes")}
        >
          ▤ Saved Summaries & Notes ({revisionNotes.length})
        </button>
        <button
          type="button"
          className={`revision-subnav-btn ${activeSubTab === "mistakes" ? "active" : ""}`}
          onClick={() => setActiveSubTab("mistakes")}
        >
          ⚠️ Quiz Mistakes Review ({allMistakes.length})
        </button>
        <button
          type="button"
          className={`revision-subnav-btn ${activeSubTab === "timer" ? "active" : ""}`}
          onClick={() => setActiveSubTab("timer")}
        >
          ⏱ Revision Sprint Timer
        </button>
      </div>

      {/* FILTER & SEARCH BAR FOR MATERIALS AND FLASHCARDS */}
      {(activeSubTab === "flashcards" || activeSubTab === "notes") && (
        <div className="courses-toolbar" style={{ margin: "16px 0 20px" }}>
          <div className="courses-search-wrap">
            <span className="search-icon">🔍</span>
            <input
              type="text"
              placeholder={
                activeSubTab === "flashcards"
                  ? "Search flashcard decks..."
                  : "Search saved summaries & notes..."
              }
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="courses-search-input"
            />
          </div>
          <div className="courses-filters">
            <select
              value={selectedCourseId}
              onChange={(e) => setSelectedCourseId(e.target.value)}
              className="courses-filter-select"
            >
              <option value="all">All Courses</option>
              {courses.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.icon} {c.name}
                </option>
              ))}
            </select>
          </div>
        </div>
      )}

      {/* ---------------------------------------------------- */}
      {/* SUBTAB 1: INTERACTIVE FLASHCARD DECKS                */}
      {/* ---------------------------------------------------- */}
      {activeSubTab === "flashcards" && (
        <div className="revision-section">
          {activeDeck ? (
            /* ACTIVE FLASHCARD SESSION */
            (() => {
              const totalCards = activeDeck.cards?.length || 0;
              const currentCard = activeDeck.cards?.[currentCardIndex] || null;
              const progressPercent = totalCards > 0 ? Math.round(((currentCardIndex + 1) / totalCards) * 100) : 0;

              return (
                <div className="flashcard-practice-box">
                  {/* SESSION HEADER */}
                  <div className="fc-session-header">
                    <div className="fc-header-left">
                      <button
                        type="button"
                        className="fc-back-btn"
                        onClick={() => setActiveDeck(null)}
                      >
                        ← Back to all decks
                      </button>
                      <h3 className="fc-deck-title">{activeDeck.title}</h3>
                    </div>
                    <div className="fc-header-right">
                      <div className="fc-progress-pill">
                        Card {currentCardIndex + 1} of {totalCards}
                      </div>
                    </div>
                  </div>

                  {/* PROGRESS BAR */}
                  <div className="fc-progress-track">
                    <div
                      className="fc-progress-fill"
                      style={{ width: `${progressPercent}%` }}
                    />
                  </div>

                  {!sessionCompleted && currentCard ? (
                    <div className="fc-study-card">
                      {/* QUESTION / FRONT SECTION */}
                      <div className="fc-card-face-block fc-question-block">
                        <div className="fc-side-header">
                          <span className="fc-side-badge fc-question-badge">
                            ✦ QUESTION {currentCardIndex + 1}
                          </span>
                          {currentCard.status && (
                            <span className={`fc-status-badge fc-status-${currentCard.status}`}>
                              {currentCard.status === "mastered"
                                ? "Mastered"
                                : currentCard.status === "learning"
                                ? "Learning"
                                : "Needs Practice"}
                            </span>
                          )}
                        </div>

                        <div className="fc-main-prompt">
                          {currentCard.front}
                        </div>

                        {!isAnswerRevealed && (
                          <div className="fc-reveal-action-wrap">
                            <button
                              type="button"
                              className="fc-reveal-btn"
                              onClick={() => setIsAnswerRevealed(true)}
                            >
                              Reveal Answer ▾
                            </button>
                          </div>
                        )}
                      </div>

                      {/* ANSWER / BACK SECTION (ONLY RENDERED AFTER REVEAL) */}
                      {isAnswerRevealed && (
                        <div className="fc-card-face-block fc-answer-block">
                          <div className="fc-side-header">
                            <span className="fc-side-badge fc-answer-badge">
                              ✓ ANSWER & EXPLANATION
                            </span>
                            <button
                              type="button"
                              className="fc-flip-back-btn"
                              onClick={() => setIsAnswerRevealed(false)}
                            >
                              Hide Answer ▴
                            </button>
                          </div>

                          <div className="fc-answer-text">
                            {currentCard.back}
                          </div>

                          {/* SPACED REPETITION RATING CONTROLS */}
                          <div className="fc-rating-panel">
                            <div className="fc-rating-label">
                              Rate your recall to schedule next spaced review:
                            </div>
                            <div className="fc-rating-buttons">
                              <button
                                type="button"
                                className="fc-rate-btn rate-hard"
                                onClick={() => handleRateCard("hard")}
                                title="Needs practice - Review in 1 day"
                              >
                                <span className="fc-rate-icon">🟣</span>
                                <span className="fc-rate-text">
                                  <strong>Hard</strong>
                                  <small>+1 day</small>
                                </span>
                              </button>
                              <button
                                type="button"
                                className="fc-rate-btn rate-medium"
                                onClick={() => handleRateCard("medium")}
                                title="Good recall - Review in 2-3 days"
                              >
                                <span className="fc-rate-icon">🟡</span>
                                <span className="fc-rate-text">
                                  <strong>Good</strong>
                                  <small>+2-3 days</small>
                                </span>
                              </button>
                              <button
                                type="button"
                                className="fc-rate-btn rate-easy"
                                onClick={() => handleRateCard("easy")}
                                title="Easy recall - Review in 5-7 days"
                              >
                                <span className="fc-rate-icon">🟢</span>
                                <span className="fc-rate-text">
                                  <strong>Easy</strong>
                                  <small>+5-7 days</small>
                                </span>
                              </button>
                            </div>
                          </div>
                        </div>
                      )}

                      {/* CARD NAVIGATION CONTROLS */}
                      <div className="fc-nav-row">
                        <button
                          type="button"
                          className="fc-nav-btn"
                          disabled={currentCardIndex === 0}
                          onClick={() => {
                            if (currentCardIndex > 0) {
                              setCurrentCardIndex((prev) => prev - 1);
                              setIsAnswerRevealed(false);
                            }
                          }}
                        >
                          ← Previous Card
                        </button>

                        <span className="fc-nav-indicator">
                          Card {currentCardIndex + 1} of {totalCards}
                        </span>

                        <button
                          type="button"
                          className="fc-nav-btn"
                          disabled={currentCardIndex >= totalCards - 1}
                          onClick={() => {
                            if (currentCardIndex < totalCards - 1) {
                              setCurrentCardIndex((prev) => prev + 1);
                              setIsAnswerRevealed(false);
                            }
                          }}
                        >
                          Next Card →
                        </button>
                      </div>
                    </div>
                  ) : sessionCompleted ? (
                    <div className="fc-completed-card">
                      <span className="fc-completed-icon">🎉</span>
                      <h3>Deck Completed!</h3>
                      <p>
                        Great job! You reviewed all {totalCards} cards in this deck.
                        Your spaced repetition ratings have been scheduled for smart review.
                      </p>
                      <div className="fc-completed-actions">
                        <button
                          type="button"
                          className="btn-secondary"
                          onClick={() => {
                            setCurrentCardIndex(0);
                            setIsAnswerRevealed(false);
                            setSessionCompleted(false);
                          }}
                        >
                          Review Again ↺
                        </button>
                        <button
                          type="button"
                          className="primary-button"
                          onClick={() => setActiveDeck(null)}
                        >
                          Done & Return to Decks ↗
                        </button>
                      </div>
                    </div>
                  ) : null}
                </div>
              );
            })()
          ) : (
            /* LIST OF DECKS */
            <>
              {filteredFlashcardDecks.length === 0 ? (
                <div className="revision-empty-state">
                  <span className="empty-icon">🗂</span>
                  <h3>{flashcardDecks.length === 0 ? "No Flashcard Decks Yet" : "No Decks Match Your Filter"}</h3>
                  <p>
                    {flashcardDecks.length === 0
                      ? "Generate AI flashcards directly from any uploaded PDF in My Notes, or create your first study deck."
                      : "Try adjusting your search query or choosing 'All Courses'."}
                  </p>
                  {flashcardDecks.length === 0 && (
                    <button
                      type="button"
                      className="primary-button"
                      onClick={() => setActivePage("My Notes")}
                    >
                      Go to My Notes to generate cards ↗
                    </button>
                  )}
                </div>
              ) : (
                <div className="flashcard-decks-grid">
                  {filteredFlashcardDecks.map((deck) => {
                    const dueCount = (deck.cards || []).filter(
                      (c) => !c.nextReviewDate || c.nextReviewDate <= todayStr
                    ).length;

                    return (
                      <div key={deck.id} className="deck-card">
                        <div className="deck-card-top">
                          <span className="deck-icon">🗂</span>
                          <span className={`deck-due-pill ${dueCount > 0 ? "has-due" : ""}`}>
                            {dueCount > 0 ? `${dueCount} due now` : "Up to date ✓"}
                          </span>
                        </div>

                        <h4>{deck.title}</h4>
                        <p>{deck.cards?.length || 0} flashcards in this deck</p>

                        <div className="deck-card-actions">
                          <button
                            type="button"
                            className="primary-button"
                            onClick={() => startDeckPractice(deck)}
                          >
                            Practice Deck ↗
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </>
          )}
        </div>
      )}

      {/* ---------------------------------------------------- */}
      {/* SUBTAB 2: SAVED SUMMARIES & REVISION NOTES           */}
      {/* ---------------------------------------------------- */}
      {activeSubTab === "notes" && (
        <div className="revision-section">
          {revisionNotes.length === 0 ? (
            <div className="revision-empty-state">
              <span className="empty-icon">▤</span>
              <h3>No Saved Revision Notes Yet</h3>
              <p>
                When you generate an AI Summary or Revision Notes in My Notes, click &quot;Save to Note&quot;
                to permanently store it here for instant review.
              </p>
              <button
                type="button"
                className="primary-button"
                onClick={() => setActivePage("My Notes")}
              >
                Go to My Notes ↗
              </button>
            </div>
          ) : (
            <div className="revision-materials-grid">
              {revisionNotes.map((note) => (
                <div key={note.id} className="revision-item-card">
                  <div className="rev-item-top">
                    <span className="rev-item-badge">
                      {note.revision ? "Revision Notes" : "AI Summary"}
                    </span>
                    <small>{new Date(note.updatedAt || note.createdAt).toLocaleDateString()}</small>
                  </div>

                  <h4>{note.title || note.fileName}</h4>
                  <p className="rev-item-snippet">
                    {note.revision
                      ? note.revision.slice(0, 140) + "..."
                      : note.summary?.slice(0, 140) + "..."}
                  </p>

                  <div className="rev-item-actions">
                    <button
                      type="button"
                      className="btn-outline-small"
                      onClick={() =>
                        setViewingItem({
                          title: note.title || note.fileName,
                          content: note.revision || note.summary,
                        })
                      }
                    >
                      Read Material ↗
                    </button>
                    <button
                      type="button"
                      className="text-button"
                      onClick={() => onOpenNote && onOpenNote(note)}
                    >
                      Open Document
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ---------------------------------------------------- */}
      {/* SUBTAB 3: QUIZ MISTAKES REVIEW                       */}
      {/* ---------------------------------------------------- */}
      {activeSubTab === "mistakes" && (
        <div className="revision-section">
          {filteredMistakes.length === 0 ? (
            <div className="revision-empty-state">
              <span className="empty-icon">✓</span>
              <h3>{allMistakes.length === 0 ? "No Recorded Mistakes" : "No Mistakes Match Your Filter"}</h3>
              <p>
                {allMistakes.length === 0
                  ? quizzes.length === 0
                    ? "Take practice quizzes in My Notes to review questions you answered incorrectly here."
                    : "Excellent job! You have answered all recorded quiz questions correctly."
                  : "Try clearing your search query or selecting 'All Courses'."}
              </p>
              {allMistakes.length === 0 && (
                <button
                  type="button"
                  className="primary-button"
                  onClick={() => setActivePage("My Notes")}
                >
                  Take a Practice Quiz ↗
                </button>
              )}
            </div>
          ) : (
            <div className="mistakes-list">
              <div className="mistakes-header-banner">
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: "12px" }}>
                  <div>
                    <strong>Targeted Review: {filteredMistakes.length} Question(s) to Strengthen</strong>
                    <p>Review the reasoning behind questions missed in practice quizzes and mock tests.</p>
                  </div>
                  {onOpenStudyPlanner && filteredMistakes.length > 0 && (
                    <button
                      type="button"
                      className="primary-btn small-btn"
                      onClick={() => {
                        const cleanTopics = Array.from(
                          new Set(
                            filteredMistakes
                              .map((m) => m.quizTitle.replace(/\s*\(Mock Test\)|\s*\(Quiz\)/g, "").trim())
                              .filter(Boolean)
                          )
                        );
                        onOpenStudyPlanner({
                          topics: cleanTopics.slice(0, 5),
                          durationDays: 7,
                          dailyMinutes: 45,
                        });
                      }}
                    >
                      ⚡ Create Study Plan for These Mistakes ↗
                    </button>
                  )}
                </div>
              </div>

              {filteredMistakes.map((m, idx) => (
                <div key={idx} className="mistake-card">
                  <div className="mistake-card-top">
                    <span className="mistake-quiz-label">From: {m.quizTitle}</span>
                    <span className="mistake-badge">✕ Missed</span>
                  </div>

                  <p className="mistake-question-text">{m.question}</p>

                  <div className="mistake-comparison">
                    <div className="choice-pill wrong-pill">
                      <span>Your answer:</span>
                      <strong>Option {m.selectedOption}</strong>
                    </div>
                    <div className="choice-pill correct-pill">
                      <span>Correct answer:</span>
                      <strong>{m.correctAnswerText || `Option ${m.correctOption}`}</strong>
                    </div>
                  </div>

                  {m.explanation && (
                    <div className="mistake-explanation">
                      <strong>💡 Explanation:</strong>
                      <p>{m.explanation}</p>
                    </div>
                  )}

                  {onOpenStudyPlanner && (
                    <div style={{ marginTop: "12px", display: "flex", justifyContent: "flex-end" }}>
                      <button
                        type="button"
                        className="text-action-link"
                        onClick={() => {
                          const topic = m.quizTitle.replace(/\s*\(Mock Test\)|\s*\(Quiz\)/g, "").trim();
                          onOpenStudyPlanner({
                            subject: topic,
                            topics: [topic],
                            durationDays: 7,
                            dailyMinutes: 30,
                          });
                        }}
                      >
                        ◫ Plan 7-day study for &quot;{m.quizTitle.replace(/\s*\(Mock Test\)|\s*\(Quiz\)/g, "").trim()}&quot; ↗
                      </button>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ---------------------------------------------------- */}
      {/* SUBTAB 4: REVISION SPRINT TIMER                      */}
      {/* ---------------------------------------------------- */}
      {activeSubTab === "timer" && (
        <div className="revision-section">
          <div className="timer-focus-box">
            <span className="timer-eyebrow">POMODORO FOCUS SPRINT</span>
            <h2>Revision Sprint Timer</h2>
            <p>
              Focused, distraction-free revision bursts help lock in information.
              Completed sprints automatically log to your Analytics.
            </p>

            <div className="timer-display">
              {String(Math.floor(secondsRemaining / 60)).padStart(2, "0")}:
              {String(secondsRemaining % 60).padStart(2, "0")}
            </div>

            <div className="timer-presets">
              <button
                type="button"
                className={`timer-preset-btn ${timerMinutes === 5 ? "active" : ""}`}
                onClick={() => handleStartTimer(5)}
                disabled={isTimerRunning}
              >
                5 Min Sprint
              </button>
              <button
                type="button"
                className={`timer-preset-btn ${timerMinutes === 15 ? "active" : ""}`}
                onClick={() => handleStartTimer(15)}
                disabled={isTimerRunning}
              >
                15 Min Standard
              </button>
              <button
                type="button"
                className={`timer-preset-btn ${timerMinutes === 25 ? "active" : ""}`}
                onClick={() => handleStartTimer(25)}
                disabled={isTimerRunning}
              >
                25 Min Deep Work
              </button>
            </div>

            <div className="timer-controls">
              {!isTimerRunning ? (
                <button
                  type="button"
                  className="primary-button"
                  onClick={() => setIsTimerRunning(true)}
                >
                  Start Sprint ↗
                </button>
              ) : (
                <button
                  type="button"
                  className="btn-danger-small"
                  onClick={() => setIsTimerRunning(false)}
                >
                  Pause
                </button>
              )}
              <button
                type="button"
                className="btn-outline-small"
                onClick={handleResetTimer}
              >
                Reset
              </button>
            </div>

            {timerLogged && (
              <div className="timer-logged-alert">
                🎉 Sprint completed and logged to your Analytics!
              </div>
            )}
          </div>
        </div>
      )}

      {/* VIEWING SAVED MATERIAL MODAL */}
      {viewingItem && (
        <div className="modal-overlay" onClick={() => setViewingItem(null)}>
          <div className="modal-content modal-large" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h3>{viewingItem.title}</h3>
              <button
                type="button"
                className="modal-close-btn"
                onClick={() => setViewingItem(null)}
              >
                ✕
              </button>
            </div>
            <div className="modal-scroll-body">
              <MarkdownRenderer content={viewingItem.content} />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
