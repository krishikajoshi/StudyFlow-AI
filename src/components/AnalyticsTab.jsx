import { useState, useEffect } from "react";
import {
  getStudySessions,
  getQuizAttempts,
  getCourses,
  getGoals,
  getMockTestMetrics,
  getMockTests,
  extractAssessmentWeaknesses,
  getStudyPlannerMetrics,
} from "../utils/storage";

export default function AnalyticsTab({ setActivePage, onOpenStudyPlanner = null }) {
  const [sessions, setSessions] = useState(() => getStudySessions());
  const [quizzes, setQuizzes] = useState(() => getQuizAttempts());
  const [courses, setCourses] = useState(() => getCourses());
  const [goals, setGoals] = useState(() => getGoals());
  const [mockMetrics, setMockMetrics] = useState(() => getMockTestMetrics());
  const [mockTests, setMockTests] = useState(() => getMockTests());
  const [plannerMetrics, setPlannerMetrics] = useState(() => getStudyPlannerMetrics());
  const [mountTime] = useState(() => Date.now());

  // Time filter: "7d" | "30d" | "all"
  const [timeFilter, setTimeFilter] = useState("7d");

  function loadData() {
    setSessions(getStudySessions());
    setQuizzes(getQuizAttempts());
    setCourses(getCourses());
    setGoals(getGoals());
    setMockMetrics(getMockTestMetrics());
    setMockTests(getMockTests());
    setPlannerMetrics(getStudyPlannerMetrics());
  }

  useEffect(() => {
    window.addEventListener("studyflow_storage_sync", loadData);
    return () => window.removeEventListener("studyflow_storage_sync", loadData);
  }, []);

  // Filter sessions by selected time range
  const now = mountTime;
  const filterCutoff =
    timeFilter === "7d"
      ? now - 7 * 24 * 60 * 60 * 1000
      : timeFilter === "30d"
      ? now - 30 * 24 * 60 * 60 * 1000
      : 0;

  const filteredSessions = sessions.filter(
    (s) => new Date(s.timestamp).getTime() >= filterCutoff
  );

  const filteredQuizzes = quizzes.filter(
    (q) => new Date(q.createdAt).getTime() >= filterCutoff
  );

  // Aggregated study time
  const totalMinutes = filteredSessions.reduce(
    (sum, s) => sum + (s.durationMinutes || 0),
    0
  );
  const totalHours = (totalMinutes / 60).toFixed(1);

  // Real quiz statistics
  let quizScoreSum = 0;
  filteredQuizzes.forEach((q) => {
    quizScoreSum += q.scorePercentage || 0;
  });
  const avgQuizAccuracy =
    filteredQuizzes.length > 0
      ? Math.round(quizScoreSum / filteredQuizzes.length)
      : null;

  // Build daily activity chart from real sessions
  const daysCount = timeFilter === "7d" ? 7 : timeFilter === "30d" ? 14 : 14;
  const chartDays = [];

  for (let i = daysCount - 1; i >= 0; i--) {
    const d = new Date(now - i * 24 * 60 * 60 * 1000);
    const dateStr = d.toISOString().split("T")[0];
    const dayLabel =
      daysCount <= 7
        ? d.toLocaleDateString("en-US", { weekday: "short" })
        : `${d.getMonth() + 1}/${d.getDate()}`;

    // Sum minutes for this date
    const dayMinutes = filteredSessions
      .filter((s) => s.timestamp.startsWith(dateStr))
      .reduce((sum, s) => sum + (s.durationMinutes || 0), 0);

    chartDays.push({
      dateStr,
      label: dayLabel,
      hours: +(dayMinutes / 60).toFixed(1),
    });
  }

  const maxDailyHours = Math.max(
    ...chartDays.map((c) => c.hours),
    2.5 // Minimum ceiling for pleasant scale
  );

  // Study time by course
  const courseStudyBreakdown = courses.map((course) => {
    const courseMinutes = filteredSessions
      .filter((s) => s.courseId === course.id)
      .reduce((sum, s) => sum + (s.durationMinutes || 0), 0);

    return {
      id: course.id,
      name: course.name,
      color: course.color,
      icon: course.icon,
      hours: +(courseMinutes / 60).toFixed(1),
      minutes: courseMinutes,
    };
  });

  // Topics / questions needing review
  const mistakeTopics = [];
  filteredQuizzes.forEach((q) => {
    (q.incorrectQuestions || []).forEach((m) => {
      mistakeTopics.push({
        question: m.question,
        quiz: q.title,
        correct: m.correctAnswerText || m.correctOption,
      });
    });
  });

  const completedGoalsCount = goals.filter((g) => g.status === "completed").length;

  return (
    <div className="analytics-tab-container">
      {/* HEADER SECTION WITH FILTER */}
      <div className="analytics-header-row">
        <div>
          <div className="eyebrow">DATA-DRIVEN INSIGHTS</div>
          <h1>
            Learning Analytics<span>.</span>
          </h1>
          <p className="welcome-subtitle">
            An accurate view of your actual study time, quiz accuracy, course effort, and milestones.
          </p>
        </div>

        <div className="analytics-time-filters">
          <button
            type="button"
            className={`filter-chip ${timeFilter === "7d" ? "active" : ""}`}
            onClick={() => setTimeFilter("7d")}
          >
            Last 7 Days
          </button>
          <button
            type="button"
            className={`filter-chip ${timeFilter === "30d" ? "active" : ""}`}
            onClick={() => setTimeFilter("30d")}
          >
            Last 30 Days
          </button>
          <button
            type="button"
            className={`filter-chip ${timeFilter === "all" ? "active" : ""}`}
            onClick={() => setTimeFilter("all")}
          >
            All Time
          </button>
        </div>
      </div>

      {/* TOP REAL METRICS CARDS */}
      <section className="stats-grid">
        <div className="stat-card">
          <div className="stat-icon orange">◷</div>
          <div className="stat-label">RECORDED STUDY TIME</div>
          <div className="stat-value">
            {totalHours}
            <small style={{ fontSize: "14px", fontWeight: 600, color: "#777" }}>h</small>
          </div>
          <div className="stat-note">
            {totalMinutes === 0
              ? "No study logged yet"
              : `${totalMinutes} minutes in ${timeFilter === "7d" ? "7 days" : "period"}`}
          </div>
        </div>

        <div className="stat-card">
          <div className="stat-icon purple">⚡</div>
          <div className="stat-label">COMPLETED SESSIONS</div>
          <div className="stat-value">{filteredSessions.length}</div>
          <div className="stat-note">
            {filteredSessions.length === 0
              ? "Start a sprint in Revision"
              : "Focus & practice sessions"}
          </div>
        </div>

        <div className="stat-card">
          <div className="stat-icon blue">◎</div>
          <div className="stat-label">AVERAGE ACCURACY</div>
          <div className="stat-value">
            {avgQuizAccuracy !== null ? `${avgQuizAccuracy}%` : "—"}
          </div>
          <div className="stat-note">
            {filteredQuizzes.length === 0
              ? "No quiz attempts yet"
              : `Across ${filteredQuizzes.length} quiz${filteredQuizzes.length === 1 ? "" : "zes"}`}
          </div>
        </div>

        <div className="stat-card">
          <div className="stat-icon purple">✎</div>
          <div className="stat-label">MOCK EXAM ACCURACY</div>
          <div className="stat-value">
            {mockMetrics.avgScorePercentage !== null ? `${mockMetrics.avgScorePercentage}%` : "—"}
          </div>
          <div className="stat-note">
            {mockMetrics.totalAttempts === 0
              ? `${mockTests.length} tests ready`
              : `Best: ${mockMetrics.bestScorePercentage}% · ${mockMetrics.totalAttempts} taken across ${mockTests.length} tests`}
          </div>
        </div>

        <div className="stat-card">
          <div className="stat-icon purple">◫</div>
          <div className="stat-label">STUDY PLAN PROGRESS</div>
          <div className="stat-value">
            {plannerMetrics.hasActivePlan ? `${plannerMetrics.completionPercentage}%` : "—"}
          </div>
          <div className="stat-note">
            {plannerMetrics.hasActivePlan
              ? `Today: ${plannerMetrics.todayCompleted}/${plannerMetrics.todayTotal} tasks done`
              : "No active plan active"}
          </div>
        </div>

        <div className="stat-card">
          <div className="stat-icon green">✓</div>
          <div className="stat-label">GOALS COMPLETED</div>
          <div className="stat-value">
            {completedGoalsCount}
            <small style={{ fontSize: "14px", fontWeight: 600, color: "#777" }}>/{goals.length}</small>
          </div>
          <div className="stat-note">
            {goals.length === 0
              ? "Set goals in My Goals"
              : `${Math.round((completedGoalsCount / (goals.length || 1)) * 100)}% completion rate`}
          </div>
        </div>
      </section>

      {/* REAL STUDY TIME ACTIVITY CHART */}
      <section className="panel activity-chart-panel">
        <div className="panel-heading">
          <div>
            <h2>Study Rhythm</h2>
            <p>
              Daily hours logged from revision sprints, practice quizzes, and study sessions.
            </p>
          </div>
          <span className="period-chip">
            {timeFilter === "7d" ? "Last 7 Days" : timeFilter === "30d" ? "Last 30 Days" : "All Time"}
          </span>
        </div>

        <div className="activity-summary">
          <strong>
            {totalHours} <span>hours logged</span>
          </strong>
          {totalMinutes === 0 && (
            <span className="trend-badge" style={{ background: "#fef3c7", color: "#b45309" }}>
              ✦ No activity recorded yet in this timeframe
            </span>
          )}
        </div>

        <div className="chart">
          {chartDays.map((col, idx) => {
            const heightPct = Math.round((col.hours / maxDailyHours) * 100);

            return (
              <div className="chart-column" key={idx}>
                <div className="bar-area">
                  <div
                    className={`bar ${col.hours > 0 ? "highlight-bar" : ""}`}
                    style={{ height: `${Math.max(col.hours > 0 ? 8 : 2, heightPct)}%` }}
                    title={`${col.label}: ${col.hours} hours`}
                  >
                    {col.hours > 0 && (
                      <span className="bar-tooltip">{col.hours}h</span>
                    )}
                  </div>
                </div>
                <span className="chart-label">{col.label}</span>
              </div>
            );
          })}
        </div>

        <div className="chart-footer">
          <span>✦</span> Study time logs automatically when you complete quizzes or finish a revision sprint.
        </div>
      </section>

      {/* BOTTOM TWO-COLUMN: COURSE DISTRIBUTION & QUIZ HISTORY */}
      <div className="overview-two-col" style={{ marginTop: "24px" }}>
        {/* COURSE TIME BREAKDOWN */}
        <div className="panel course-breakdown-panel">
          <div className="panel-heading">
            <div>
              <h2>Course Time Distribution</h2>
              <p>Where your study time is going</p>
            </div>
            <button
              className="text-button"
              onClick={() => setActivePage("My Courses")}
            >
              Courses ↗
            </button>
          </div>

          {courses.length === 0 ? (
            <div className="overview-empty-box">
              <span className="empty-icon">⌘</span>
              <strong>No courses created</strong>
              <p>Create courses to associate notes and track time per subject.</p>
            </div>
          ) : (
            <div className="course-breakdown-list">
              {courseStudyBreakdown.map((c) => {
                const totalCourseMinutes = totalMinutes || 1;
                const sharePct = Math.round((c.minutes / totalCourseMinutes) * 100);

                return (
                  <div key={c.id} className="course-breakdown-item">
                    <div className="cb-top">
                      <div className="cb-title">
                        <span className="cb-icon" style={{ background: c.color }}>
                          {c.icon}
                        </span>
                        <strong>{c.name}</strong>
                      </div>
                      <span className="cb-hours">{c.hours}h ({c.minutes > 0 ? sharePct : 0}%)</span>
                    </div>

                    <div className="progress-track">
                      <div
                        className="progress-fill"
                        style={{
                          width: `${c.minutes > 0 ? sharePct : 0}%`,
                          background: c.color,
                        }}
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* QUIZ & MOCK TEST ACCURACY RESULTS */}
        <div className="panel quiz-history-panel">
          <div className="panel-heading">
            <div>
              <h2>Recent Assessments</h2>
              <p>Practice quizzes and timed mock examinations</p>
            </div>
            <button
              className="text-button"
              onClick={() => setActivePage("Mock Tests")}
            >
              Mock Tests Hub ↗
            </button>
          </div>

          {filteredQuizzes.length === 0 && mockMetrics.totalAttempts === 0 ? (
            <div className="overview-empty-box">
              <span className="empty-icon">✎</span>
              <strong>No assessments completed yet</strong>
              <p>
                Take a practice quiz or mock examination to populate your performance history.
              </p>
            </div>
          ) : (
            <div className="quiz-history-list">
              {/* Show recent mock attempts first if any */}
              {(mockMetrics.recentAttempts || []).slice(0, 3).map((m) => (
                <div key={m.id} className="quiz-history-row" style={{ borderLeft: "3px solid #6350db" }}>
                  <div>
                    <strong>{m.testTitle} <span style={{ fontSize: "10px", color: "#6350db", background: "#f1edfe", padding: "2px 6px", borderRadius: "4px" }}>MOCK</span></strong>
                    <small>
                      {new Date(m.createdAt || m.submittedAt).toLocaleDateString()} · {m.score}/{m.totalMarks} marks
                    </small>
                  </div>
                  <span
                    className={`score-pill ${
                      m.percentage >= 80
                        ? "score-high"
                        : m.percentage >= 50
                        ? "score-mid"
                        : "score-low"
                    }`}
                  >
                    {m.percentage}%
                  </span>
                </div>
              ))}

              {filteredQuizzes.slice(0, 3).map((q) => (
                <div key={q.id} className="quiz-history-row">
                  <div>
                    <strong>{q.title} <span style={{ fontSize: "10px", color: "#e67700", background: "#fff9db", padding: "2px 6px", borderRadius: "4px" }}>QUIZ</span></strong>
                    <small>
                      {new Date(q.createdAt).toLocaleDateString()} · {q.correctCount}/{q.totalQuestions} correct
                    </small>
                  </div>
                  <span
                    className={`score-pill ${
                      q.scorePercentage >= 80
                        ? "score-high"
                        : q.scorePercentage >= 50
                        ? "score-mid"
                        : "score-low"
                    }`}
                  >
                    {q.scorePercentage}%
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* TOPICS WITH REPEATED MISTAKES & ASSESSMENT DIAGNOSTICS */}
      {(() => {
        const assessmentWeaknesses = extractAssessmentWeaknesses();
        const hasWeaknesses = assessmentWeaknesses.hasHistory && (assessmentWeaknesses.weakTopics.length > 0 || mistakeTopics.length > 0);

        if (!hasWeaknesses) return null;

        return (
          <section className="panel mistakes-summary-panel" style={{ marginTop: "24px" }}>
            <div className="panel-heading" style={{ flexWrap: "wrap", gap: "12px" }}>
              <div>
                <h2>Assessment Diagnostics & Areas for Reinforcement</h2>
                <p>
                  Identified from real mock examination evaluations and practice quizzes ({assessmentWeaknesses.totalAttemptsAnalyzed} attempts analyzed)
                </p>
              </div>

              <div style={{ display: "flex", gap: "10px", alignItems: "center" }}>
                {onOpenStudyPlanner && assessmentWeaknesses.weakTopics.length > 0 && (
                  <button
                    type="button"
                    className="primary-btn small-btn"
                    onClick={() => {
                      onOpenStudyPlanner({
                        topics: assessmentWeaknesses.weakTopics.slice(0, 5),
                        durationDays: 14,
                        dailyMinutes: 60,
                      });
                    }}
                  >
                    ⚡ Generate Study Plan for Weak Areas ↗
                  </button>
                )}

                <button
                  className="text-button"
                  onClick={() => setActivePage("Revision")}
                >
                  Revision Hub ↗
                </button>
              </div>
            </div>

            {/* DIAGNOSTIC COUNTERS */}
            <div style={{ display: "flex", gap: "10px", flexWrap: "wrap", margin: "14px 0" }}>
              <span className="chip" style={{ background: "#ffe3e3", color: "#c92a2a", fontWeight: "600" }}>
                🔴 {assessmentWeaknesses.confirmedErrors.length} Confirmed Errors
              </span>
              <span className="chip" style={{ background: "#fff3bf", color: "#d9480f", fontWeight: "600" }}>
                🟠 {assessmentWeaknesses.misconceptions.length} Conceptual Misconceptions
              </span>
              {assessmentWeaknesses.recurringMistakes.length > 0 && (
                <span className="chip" style={{ background: "#f3f0ff", color: "#6741d9", fontWeight: "600" }}>
                  🔁 {assessmentWeaknesses.recurringMistakes.length} Recurring Mistakes
                </span>
              )}
              {assessmentWeaknesses.weakTopics.length > 0 && (
                <span className="chip" style={{ background: "#e7f5ff", color: "#1971c2", fontWeight: "600" }}>
                  Top Weak Topics: {assessmentWeaknesses.weakTopics.slice(0, 3).join(", ")}
                </span>
              )}
            </div>

            <div className="mistakes-chips-grid">
              {assessmentWeaknesses.misconceptions.slice(0, 2).map((m, idx) => (
                <div key={`misc-${idx}`} className="mistake-mini-card" style={{ borderLeft: "3px solid #f59f00" }}>
                  <span className="mistake-quiz-name">{m.source} · Misconception</span>
                  <p className="mistake-q-snippet">{m.question}</p>
                  <span className="mistake-key-ans" style={{ color: "#d9480f" }}>
                    💡 Fix: {m.recommendation.slice(0, 80)}...
                  </span>
                </div>
              ))}

              {mistakeTopics.slice(0, 2).map((m, idx) => (
                <div key={`quiz-${idx}`} className="mistake-mini-card">
                  <span className="mistake-quiz-name">{m.quiz}</span>
                  <p className="mistake-q-snippet">{m.question}</p>
                  <span className="mistake-key-ans">✓ Correct: {m.correct}</span>
                </div>
              ))}
            </div>
          </section>
        );
      })()}
    </div>
  );
}
