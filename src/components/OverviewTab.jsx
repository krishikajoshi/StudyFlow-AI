import { useState, useEffect } from "react";
import {
  getCourses,
  getSavedNotes,
  getQuizAttempts,
  getStudySessions,
  getGoals,
  getRecentActivities,
  getFlashcardDecks,
  getMockTestMetrics,
  getActiveStudyPlan,
  getStudyPlannerMetrics,
  toggleStudyPlanTask,
} from "../utils/storage";

export default function OverviewTab({
  setActivePage,
  onOpenNote,
  onOpenCourse,
  onOpenStudyPlanner = null,
}) {
  const [courses, setCourses] = useState(() => getCourses());
  const [notes, setNotes] = useState(() => getSavedNotes());
  const [quizzes, setQuizzes] = useState(() => getQuizAttempts());
  const [sessions, setSessions] = useState(() => getStudySessions());
  const [goals, setGoals] = useState(() => getGoals());
  const [activities, setActivities] = useState(() => getRecentActivities(8));
  const [flashcardDecks, setFlashcardDecks] = useState(() => getFlashcardDecks());
  const [mockMetrics, setMockMetrics] = useState(() => getMockTestMetrics());
  const [activePlan, setActivePlan] = useState(() => getActiveStudyPlan());
  const [plannerMetrics, setPlannerMetrics] = useState(() => getStudyPlannerMetrics());
  const [mountTime] = useState(() => Date.now());

  function refreshData() {
    setCourses(getCourses());
    setNotes(getSavedNotes());
    setQuizzes(getQuizAttempts());
    setSessions(getStudySessions());
    setGoals(getGoals());
    setActivities(getRecentActivities(8));
    setFlashcardDecks(getFlashcardDecks());
    setMockMetrics(getMockTestMetrics());
    setActivePlan(getActiveStudyPlan());
    setPlannerMetrics(getStudyPlannerMetrics());
  }

  useEffect(() => {
    const handleSync = () => refreshData();
    window.addEventListener("studyflow_storage_sync", handleSync);
    return () => window.removeEventListener("studyflow_storage_sync", handleSync);
  }, []);

  // Time-aware greeting
  const hour = new Date(mountTime).getHours();
  const greeting =
    hour < 12
      ? "Good morning"
      : hour < 18
      ? "Good afternoon"
      : "Good evening";

  const todayFormatted = new Intl.DateTimeFormat("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
  }).format(new Date(mountTime));

  // Real aggregated metrics
  const totalStudyMinutes = sessions.reduce(
    (sum, s) => sum + (s.durationMinutes || 0),
    0
  );
  const totalHours = (totalStudyMinutes / 60).toFixed(1);

  // Real quiz accuracy
  let totalScore = 0;
  quizzes.forEach((q) => {
    totalScore += q.scorePercentage || 0;
  });
  const avgAccuracy = quizzes.length > 0 ? Math.round(totalScore / quizzes.length) : null;

  // Flashcards due today
  const todayStr = new Date(mountTime).toISOString().split("T")[0];
  let cardsDueCount = 0;
  flashcardDecks.forEach((deck) => {
    (deck.cards || []).forEach((c) => {
      if (!c.nextReviewDate || c.nextReviewDate <= todayStr) {
        cardsDueCount++;
      }
    });
  });

  const recentNotes = notes.slice(0, 3);

  return (
    <div className="overview-container">
      {/* WELCOME SECTION */}
      <section className="welcome-section">
        <div>
          <div className="eyebrow">
            <span className="live-dot" /> {todayFormatted.toUpperCase()}
          </div>
          <h1>
            {greeting}<span>.</span>
          </h1>
          <p className="welcome-subtitle">
            Every step forward builds confidence. Track your active study materials and pick up right where you left off.
          </p>
        </div>

        <button
          className="primary-button"
          onClick={() => setActivePage("AI Tutor")}
        >
          <span>✧</span> Ask AI Tutor <span>↗</span>
        </button>
      </section>

      {/* REAL METRICS SUMMARY CARDS */}
      <section className="stats-grid">
        <div
          className="stat-card"
          onClick={() => onOpenCourse ? onOpenCourse() : setActivePage("My Courses")}
          style={{ cursor: "pointer" }}
          title="View all courses"
        >
          <div className="stat-icon purple">▤</div>
          <div className="stat-label">ENROLLED COURSES</div>
          <div className="stat-value">{courses.length}</div>
          <div className="stat-note">
            {courses.length === 1 ? "1 active course" : `${courses.length} active courses`}
          </div>
        </div>

        <div className="stat-card">
          <div className="stat-icon orange">◷</div>
          <div className="stat-label">RECORDED STUDY TIME</div>
          <div className="stat-value">
            {totalHours}
            <small style={{ fontSize: "14px", fontWeight: 600, color: "#777" }}>h</small>
          </div>
          <div className="stat-note">
            {sessions.length === 0
              ? "No sessions logged yet"
              : `${sessions.length} recorded session${sessions.length === 1 ? "" : "s"}`}
          </div>
        </div>

        <div className="stat-card">
          <div className="stat-icon green">📄</div>
          <div className="stat-label">SAVED MATERIALS</div>
          <div className="stat-value">{notes.length}</div>
          <div className="stat-note">
            {notes.length === 0 ? "Upload notes to start" : "In your library"}
          </div>
        </div>

        <div className="stat-card">
          <div className="stat-icon blue">◎</div>
          <div className="stat-label">PRACTICE ACCURACY</div>
          <div className="stat-value">
            {avgAccuracy !== null ? `${avgAccuracy}%` : "—"}
          </div>
          <div className="stat-note">
            {quizzes.length === 0
              ? "No quizzes attempted yet"
              : `Across ${quizzes.length} quiz${quizzes.length === 1 ? "" : "zes"}`}
          </div>
        </div>
      </section>

      {/* QUICK ACTIONS ROW */}
      <section className="quick-actions-card">
        <div className="quick-actions-header">
          <strong>Quick Actions</strong>
          <span>Jump into study tasks</span>
        </div>
        <div className="quick-actions-grid">
          <button
            type="button"
            className="quick-action-btn"
            onClick={() => setActivePage("My Notes")}
          >
            <span className="qa-icon">📄</span>
            <div>
              <strong>Upload PDF Material</strong>
              <small>Extract text and summarize</small>
            </div>
          </button>

          <button
            type="button"
            className="quick-action-btn"
            onClick={() => setActivePage("AI Tutor")}
          >
            <span className="qa-icon">✧</span>
            <div>
              <strong>Ask AI Tutor</strong>
              <small>Get clear step-by-step explanations</small>
            </div>
          </button>

          <button
            type="button"
            className="quick-action-btn"
            onClick={() => setActivePage("Revision")}
          >
            <span className="qa-icon">🗂</span>
            <div>
              <strong>Practice Flashcards</strong>
              <small>
                {cardsDueCount > 0 ? `${cardsDueCount} card(s) due today` : "Review study decks"}
              </small>
            </div>
          </button>

          <button
            type="button"
            className="quick-action-btn"
            onClick={() => setActivePage("My Goals")}
          >
            <span className="qa-icon">◎</span>
            <div>
              <strong>Set a Study Goal</strong>
              <small>Track milestones & targets</small>
            </div>
          </button>

          <button
            type="button"
            className="quick-action-btn"
            onClick={() => setActivePage("Mock Tests")}
          >
            <span className="qa-icon">✎</span>
            <div>
              <strong>Mock Examination</strong>
              <small>{mockMetrics.totalAttempts > 0 ? `${mockMetrics.totalAttempts} taken · Best ${mockMetrics.bestScorePercentage}%` : "Timed test with AI grading"}</small>
            </div>
          </button>

          <button
            type="button"
            className="quick-action-btn"
            onClick={() => {
              if (onOpenStudyPlanner) onOpenStudyPlanner();
              else setActivePage("Study Planner");
            }}
          >
            <span className="qa-icon">◫</span>
            <div>
              <strong>AI Study Planner</strong>
              <small>{activePlan ? `${plannerMetrics.todayCompleted}/${plannerMetrics.todayTotal} tasks done today` : "Adaptive daily schedules"}</small>
            </div>
          </button>
        </div>
      </section>

      {/* TODAY'S ACTIVE STUDY PLAN CARD */}
      {activePlan && (
        <section className="overview-planner-card" style={{ marginBottom: "28px" }}>
          <div className="planner-card-header">
            <div style={{ display: "flex", alignItems: "center", gap: "12px", flexWrap: "wrap" }}>
              <span className="plan-pill-tag">✦ ACTIVE STUDY SCHEDULE</span>
              <h3 style={{ margin: 0, fontSize: "18px", color: "var(--text-main)" }}>
                {activePlan.title}
              </h3>
              <span style={{ fontSize: "12px", background: "#f1edfe", color: "#6350db", padding: "3px 8px", borderRadius: "100px", fontWeight: "600" }}>
                {plannerMetrics.completionPercentage}% Overall Complete
              </span>
            </div>

            <button
              type="button"
              className="text-action-link"
              onClick={() => {
                if (onOpenStudyPlanner) onOpenStudyPlanner();
                else setActivePage("Study Planner");
              }}
            >
              Open Full Study Planner ↗
            </button>
          </div>

          <div className="overview-planner-body">
            <div className="overview-planner-tasks">
              {plannerMetrics.todayTotal === 0 ? (
                <div style={{ padding: "12px 16px", color: "var(--text-subtle)", fontSize: "14px" }}>
                  🎉 No pending tasks scheduled for today! Keep up the momentum or schedule upcoming topics.
                </div>
              ) : (
                plannerMetrics.todayTasks.map((t) => (
                  <div key={t.id} className={`overview-task-item ${t.completed ? "task-done" : ""}`}>
                    <button
                      type="button"
                      className={`task-checkbox-small ${t.completed ? "checked" : ""}`}
                      onClick={() => {
                        toggleStudyPlanTask(activePlan.id, t.id);
                        refreshData();
                      }}
                      title={t.completed ? "Mark incomplete" : "Mark complete"}
                    >
                      {t.completed ? "✓" : ""}
                    </button>
                    <div className="task-info">
                      <strong className="task-title-text">{t.title}</strong>
                      <span className="task-meta-text">
                        {t.topic} · ⏱ {t.estimatedMinutes}m · {t.priority} Priority
                      </span>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        </section>
      )}

      {/* PRIMARY TWO-COLUMN SECTION: CONTINUE LEARNING & RECENT ACTIVITY */}
      <div className="overview-two-col">
        {/* CONTINUE LEARNING */}
        <div className="panel continue-panel">
          <div className="panel-heading">
            <div>
              <h2>Continue Learning</h2>
              <p>Pick up where you left off</p>
            </div>
            <button
              className="text-button"
              onClick={() => setActivePage("My Notes")}
            >
              View all notes ↗
            </button>
          </div>

          {recentNotes.length === 0 ? (
            <div className="overview-empty-box">
              <span className="empty-icon">▤</span>
              <strong>No notes uploaded yet</strong>
              <p>Upload a lecture PDF in My Notes to begin generating summaries and quizzes.</p>
              <button
                type="button"
                className="btn-outline-small"
                onClick={() => setActivePage("My Notes")}
              >
                Upload your first note ↗
              </button>
            </div>
          ) : (
            <div className="continue-items-list">
              {recentNotes.map((note) => {
                const course = courses.find((c) => c.id === note.courseId);

                return (
                  <div key={note.id} className="continue-card">
                    <div className="continue-card-icon">📄</div>
                    <div className="continue-card-copy">
                      <strong>{note.title || note.fileName}</strong>
                      <div className="continue-meta">
                        <span>{note.pageCount} pages</span>
                        {course && (
                          <button
                            type="button"
                            className="course-pill-tiny"
                            style={{ "--c-color": course.color, cursor: "pointer", border: "none", background: "none", padding: "0 4px" }}
                            onClick={() => onOpenCourse ? onOpenCourse(course.id) : setActivePage("My Courses")}
                            title={`Open ${course.name}`}
                          >
                            {course.icon} {course.name}
                          </button>
                        )}
                        {note.summary && <span className="badge-tiny">Summary Ready</span>}
                      </div>
                    </div>
                    <button
                      type="button"
                      className="continue-resume-btn"
                      onClick={() => onOpenNote && onOpenNote(note)}
                    >
                      Resume ↗
                    </button>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* RECENT REAL ACTIVITY TIMELINE */}
        <div className="panel activity-panel">
          <div className="panel-heading">
            <div>
              <h2>Recent Learning Activity</h2>
              <p>Events recorded from your actual study</p>
            </div>
            <button
              className="text-button"
              onClick={() => setActivePage("Analytics")}
            >
              View analytics ↗
            </button>
          </div>

          {activities.length === 0 ? (
            <div className="overview-empty-box">
              <span className="empty-icon">◷</span>
              <strong>No activity recorded yet</strong>
              <p>Complete quizzes, study sessions, or save notes to see your learning timeline.</p>
            </div>
          ) : (
            <div className="overview-timeline">
              {activities.map((act) => {
                const timeDiff = Math.round(
                  (mountTime - new Date(act.timestamp).getTime()) / (1000 * 60)
                );
                const timeLabel =
                  timeDiff < 1
                    ? "Just now"
                    : timeDiff < 60
                    ? `${timeDiff}m ago`
                    : timeDiff < 1440
                    ? `${Math.round(timeDiff / 60)}h ago`
                    : `${Math.round(timeDiff / 1440)}d ago`;

                const icon =
                  act.type.includes("quiz")
                    ? "✎"
                    : act.type.includes("note")
                    ? "📄"
                    : act.type.includes("goal")
                    ? "◎"
                    : act.type.includes("course")
                    ? "⌘"
                    : "✦";

                return (
                  <div key={act.id} className="timeline-row">
                    <span className="timeline-icon">{icon}</span>
                    <div className="timeline-copy">
                      <p>{act.message}</p>
                      <small>{timeLabel}</small>
                    </div>
                    {act.tabLink && (
                      <button
                        type="button"
                        className="timeline-link-btn"
                        onClick={() => setActivePage(act.tabLink)}
                      >
                        {act.tabLink} ↗
                      </button>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {/* UPCOMING REVISION & ACTIVE GOALS PREVIEW */}
      <div className="overview-two-col" style={{ marginTop: "24px" }}>
        {/* REVISION SCHEDULE PREVIEW */}
        <div className="panel revision-preview-panel">
          <div className="panel-heading">
            <div>
              <h2>Upcoming Revision</h2>
              <p>Keep your recall sharp with spaced reviews</p>
            </div>
            <button
              className="text-button"
              onClick={() => setActivePage("Revision")}
            >
              Revision Hub ↗
            </button>
          </div>

          {cardsDueCount === 0 && flashcardDecks.length === 0 ? (
            <div className="overview-empty-box">
              <span className="empty-icon">⚡</span>
              <strong>No review items due</strong>
              <p>Generate flashcards from your notes in My Notes to activate smart spaced repetition.</p>
            </div>
          ) : (
            <div className="revision-preview-content">
              <div className="rev-stat-highlight">
                <span className="rev-stat-num">{cardsDueCount}</span>
                <div>
                  <strong>Card{cardsDueCount === 1 ? "" : "s"} due for review today</strong>
                  <p>Spaced repetition reinforces long-term retention.</p>
                </div>
              </div>

              <div className="rev-deck-list">
                {flashcardDecks.slice(0, 3).map((deck) => (
                  <div key={deck.id} className="rev-deck-row">
                    <span>🗂 {deck.title}</span>
                    <span className="badge-tiny">{deck.cards?.length || 0} cards</span>
                  </div>
                ))}
              </div>

              <button
                type="button"
                className="primary-button"
                style={{ width: "100%", justifyContent: "center", marginTop: "14px" }}
                onClick={() => setActivePage("Revision")}
              >
                Start Revision Session ↗
              </button>
            </div>
          )}
        </div>

        {/* ACTIVE GOALS SNAPSHOT */}
        <div className="panel goals-snapshot-panel">
          <div className="panel-heading">
            <div>
              <h2>Active Goals ({goals.filter((g) => g.status === "active").length})</h2>
              <p>Progress on your milestones</p>
            </div>
            <button
              className="text-button"
              onClick={() => setActivePage("My Goals")}
            >
              Manage goals ↗
            </button>
          </div>

          {goals.length === 0 ? (
            <div className="overview-empty-box">
              <span className="empty-icon">◎</span>
              <strong>No goals created yet</strong>
              <p>Setting specific study targets helps maintain consistent focus.</p>
              <button
                type="button"
                className="btn-outline-small"
                onClick={() => setActivePage("My Goals")}
              >
                Create your first goal ↗
              </button>
            </div>
          ) : (
            <div className="goals-snapshot-list">
              {goals
                .filter((g) => g.status === "active")
                .slice(0, 3)
                .map((goal) => {
                  const progressPct =
                    goal.target > 0
                      ? Math.min(100, Math.round((goal.current / goal.target) * 100))
                      : 0;

                  return (
                    <div key={goal.id} className="goal-snapshot-item">
                      <div className="goal-snapshot-top">
                        <strong>{goal.title}</strong>
                        <span>
                          {goal.current} / {goal.target} {goal.unit} ({progressPct}%)
                        </span>
                      </div>
                      <div className="progress-track">
                        <div
                          className="progress-fill"
                          style={{ width: `${progressPct}%` }}
                        />
                      </div>
                    </div>
                  );
                })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
