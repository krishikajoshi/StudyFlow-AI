import { useState, useEffect } from "react";
import {
  getCourses,
  saveCourse,
  deleteCourse,
  getSavedNotes,
  getQuizAttempts,
  getStudySessions,
  getGoals,
  getMockTests,
  getStudyPlans,
} from "../utils/storage";

const COURSE_ICONS = ["⌘", "◇", "∑", "⚡", "⚛", "💻", "🧠", "📐", "🔬", "🌍"];
const COURSE_COLORS = [
  "#7667f5",
  "#e9a34b",
  "#39b89a",
  "#ec4899",
  "#3b82f6",
  "#8b5cf6",
  "#f43f5e",
  "#10b981",
];

import { useRef } from "react";

export default function CoursesTab({
  onOpenNote,
  setActivePage,
  initialCourseId = null,
  onOpenMockTestForCourse = null,
  onOpenStudyPlanner = null,
}) {
  const [courses, setCourses] = useState(() => getCourses());
  const [notes, setNotes] = useState(() => getSavedNotes());
  const [quizzes, setQuizzes] = useState(() => getQuizAttempts());
  const [sessions, setSessions] = useState(() => getStudySessions());
  const [goals, setGoals] = useState(() => getGoals());
  const [mockTests, setMockTests] = useState(() => getMockTests());
  const [studyPlans, setStudyPlans] = useState(() => getStudyPlans());

  // Course selection for detail view
  const [selectedCourseId, setSelectedCourseId] = useState(() => initialCourseId || null);

  const prevCourseIdRef = useRef(initialCourseId);
  useEffect(() => {
    if (initialCourseId && initialCourseId !== prevCourseIdRef.current) {
      prevCourseIdRef.current = initialCourseId;
      setSelectedCourseId(initialCourseId);
    }
  }, [initialCourseId]);

  // Search, filter & sort
  const [searchQuery, setSearchQuery] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("all");
  const [sortBy, setSortBy] = useState("recent");

  // Modal state
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingCourse, setEditingCourse] = useState(null);
  const [formData, setFormData] = useState({
    name: "",
    description: "",
    category: "",
    targetDate: "",
    icon: "⌘",
    color: "#7667f5",
  });

  function loadData() {
    setCourses(getCourses());
    setNotes(getSavedNotes());
    setQuizzes(getQuizAttempts());
    setSessions(getStudySessions());
    setGoals(getGoals());
    setMockTests(getMockTests());
    setStudyPlans(getStudyPlans());
  }

  useEffect(() => {
    const handleSync = () => loadData();
    window.addEventListener("studyflow_storage_sync", handleSync);
    return () => window.removeEventListener("studyflow_storage_sync", handleSync);
  }, []);

  function handleOpenCreateModal() {
    setEditingCourse(null);
    setFormData({
      name: "",
      description: "",
      category: "",
      targetDate: "",
      icon: "⌘",
      color: "#7667f5",
    });
    setIsModalOpen(true);
  }

  function handleOpenEditModal(course, e) {
    e.stopPropagation();
    setEditingCourse(course);
    setFormData({
      name: course.name || "",
      description: course.description || "",
      category: course.category || "",
      targetDate: course.targetDate || "",
      icon: course.icon || "⌘",
      color: course.color || "#7667f5",
    });
    setIsModalOpen(true);
  }

  function handleSaveCourse(e) {
    e.preventDefault();
    if (!formData.name.trim()) return;

    saveCourse({
      id: editingCourse?.id,
      name: formData.name.trim(),
      description: formData.description.trim(),
      category: formData.category.trim() || "General",
      targetDate: formData.targetDate || null,
      icon: formData.icon,
      color: formData.color,
    });

    setIsModalOpen(false);
    loadData();
  }

  function handleDeleteCourse(id, name, e) {
    e.stopPropagation();
    if (window.confirm(`Are you sure you want to delete "${name}"? Associated materials will remain in your notes.`)) {
      deleteCourse(id);
      if (selectedCourseId === id) {
        setSelectedCourseId(null);
      }
      loadData();
    }
  }

  // Filter and sort courses
  const categories = Array.from(
    new Set(courses.map((c) => c.category).filter(Boolean))
  );

  let displayedCourses = courses.filter((c) => {
    const matchesSearch =
      c.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      c.description.toLowerCase().includes(searchQuery.toLowerCase());
    const matchesCategory =
      categoryFilter === "all" || c.category === categoryFilter;
    return matchesSearch && matchesCategory;
  });

  if (sortBy === "name") {
    displayedCourses.sort((a, b) => a.name.localeCompare(b.name));
  } else if (sortBy === "recent") {
    displayedCourses.sort(
      (a, b) => new Date(b.updatedAt || b.createdAt) - new Date(a.updatedAt || a.createdAt)
    );
  }

  // Active Course Detail Data
  const activeCourse = courses.find((c) => c.id === selectedCourseId);
  const courseNotes = notes.filter((n) => n.courseId === selectedCourseId);
  const courseQuizzes = quizzes.filter((q) => q.courseId === selectedCourseId);
  const courseSessions = sessions.filter((s) => s.courseId === selectedCourseId);
  const courseGoals = goals.filter((g) => g.courseId === selectedCourseId);

  const courseStudyMinutes = courseSessions.reduce(
    (sum, s) => sum + (s.durationMinutes || 0),
    0
  );

  // Meaningful course progress: based on completed course goals or analyzed notes
  const completedCourseGoals = courseGoals.filter((g) => g.status === "completed").length;
  const notesWithAI = courseNotes.filter((n) => n.summary || n.mcqs || n.revision).length;

  let courseProgressPct = null;
  let progressSubtitle = "No Course Goals";

  if (courseGoals.length > 0) {
    courseProgressPct = Math.round((completedCourseGoals / courseGoals.length) * 100);
    progressSubtitle = `${completedCourseGoals}/${courseGoals.length} Goals Finished`;
  } else if (courseNotes.length > 0) {
    courseProgressPct = Math.round((notesWithAI / courseNotes.length) * 100);
    progressSubtitle = `${notesWithAI}/${courseNotes.length} Materials Analyzed`;
  }

  return (
    <div className="courses-tab-container">
      {/* HEADER SECTION */}
      <div className="courses-heading-row">
        <div>
          <div className="eyebrow">CURRICULUM MANAGEMENT</div>
          <h1>
            My Courses<span>.</span>
          </h1>
          <p className="welcome-subtitle">
            Organize study materials, notes, practice quizzes, and milestones by subject.
          </p>
        </div>

        <button
          type="button"
          className="primary-button"
          onClick={handleOpenCreateModal}
        >
          <span>＋</span> Create Course
        </button>
      </div>

      {/* DETAIL VIEW OF A SELECTED COURSE */}
      {activeCourse ? (
        <div className="course-detail-view">
          <div className="course-detail-header" style={{ "--c-color": activeCourse.color }}>
            <button
              type="button"
              className="course-back-btn"
              onClick={() => setSelectedCourseId(null)}
            >
              ← Back to all courses
            </button>

            <div className="course-detail-main">
              <div className="course-detail-icon-wrap">{activeCourse.icon}</div>
              <div className="course-detail-info">
                <span className="course-category-tag">{activeCourse.category}</span>
                <h2>{activeCourse.name}</h2>
                <p>{activeCourse.description || "No description provided."}</p>
                <div className="course-detail-dates">
                  <span>Created: {new Date(activeCourse.createdAt).toLocaleDateString()}</span>
                  {activeCourse.targetDate && (
                    <span>· Target: {new Date(activeCourse.targetDate).toLocaleDateString()}</span>
                  )}
                </div>
              </div>

              <div className="course-detail-actions">
                <button
                  type="button"
                  className="btn-outline-small"
                  onClick={(e) => handleOpenEditModal(activeCourse, e)}
                >
                  Edit Course
                </button>
                <button
                  type="button"
                  className="btn-danger-small"
                  onClick={(e) => handleDeleteCourse(activeCourse.id, activeCourse.name, e)}
                >
                  Delete
                </button>
              </div>
            </div>

            {/* REAL PROGRESS / ACTIVITY BANNER */}
            <div className="course-stats-strip">
              <div className="course-stat-unit">
                <strong>{courseNotes.length}</strong>
                <small>Linked Notes</small>
              </div>
              <div className="course-stat-unit">
                <strong>{courseQuizzes.length}</strong>
                <small>Quizzes Completed</small>
              </div>
              <div className="course-stat-unit">
                <strong>{mockTests.filter((m) => m.courseId === activeCourse.id).length}</strong>
                <small>Mock Tests</small>
              </div>
              <div className="course-stat-unit">
                <strong>{(courseStudyMinutes / 60).toFixed(1)}h</strong>
                <small>Study Time Logged</small>
              </div>
              <div className="course-stat-unit">
                <strong>
                  {courseProgressPct !== null ? `${courseProgressPct}%` : "—"}
                </strong>
                <small>{progressSubtitle}</small>
              </div>
            </div>
          </div>

          {/* COURSE CONTENT SECTIONS */}
          <div className="course-detail-grid">
            {/* LINKED NOTES & MATERIALS */}
            <div className="panel course-content-panel">
              <div className="panel-heading">
                <div>
                  <h3>Associated Study Notes ({courseNotes.length})</h3>
                  <p>Materials assigned to this course</p>
                </div>
                <button
                  className="text-button"
                  onClick={() => setActivePage && setActivePage("My Notes")}
                >
                  Upload new note ↗
                </button>
              </div>

              {courseNotes.length === 0 ? (
                <div className="overview-empty-box">
                  <span className="empty-icon">📄</span>
                  <strong>No notes linked to this course yet</strong>
                  <p>In My Notes, assign uploaded lecture PDFs to this course.</p>
                </div>
              ) : (
                <div className="course-notes-list">
                  {courseNotes.map((note) => (
                    <div key={note.id} className="course-note-card">
                      <div className="course-note-info">
                        <strong>{note.title || note.fileName}</strong>
                        <div className="continue-meta">
                          <span>{note.pageCount} pages</span>
                          {note.summary && <span className="badge-tiny">Summary Ready</span>}
                          {note.mcqs && <span className="badge-tiny">Quiz Ready</span>}
                        </div>
                      </div>
                      <button
                        type="button"
                        className="continue-resume-btn"
                        onClick={() => onOpenNote && onOpenNote(note)}
                      >
                        Open ↗
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* COURSE QUIZ ATTEMPTS & REVISION */}
            <div className="panel course-content-panel">
              <div className="panel-heading">
                <div>
                  <h3>Practice Quiz History ({courseQuizzes.length})</h3>
                  <p>Real quiz attempts recorded for this course</p>
                </div>
                <button
                  className="text-button"
                  onClick={() => setActivePage && setActivePage("Revision")}
                >
                  Revision Hub ↗
                </button>
              </div>

              {courseQuizzes.length === 0 ? (
                <div className="overview-empty-box">
                  <span className="empty-icon">✎</span>
                  <strong>No quizzes taken for this course yet</strong>
                  <p>Generate practice MCQs from notes in this course and save your scores.</p>
                </div>
              ) : (
                <div className="course-quiz-list">
                  {courseQuizzes.map((quiz) => (
                    <div key={quiz.id} className="course-quiz-item">
                      <div>
                        <strong>{quiz.title}</strong>
                        <small>
                          {new Date(quiz.createdAt).toLocaleDateString()} · {quiz.correctCount}/
                          {quiz.totalQuestions} correct
                        </small>
                      </div>
                      <span className="quiz-score-badge">{quiz.scorePercentage}%</span>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* COURSE PERSONALIZED STUDY PLAN PANEL */}
            <div className="panel course-content-panel" style={{ gridColumn: "1 / -1" }}>
              <div className="panel-heading">
                <div>
                  <h3>Personalized AI Study Schedule</h3>
                  <p>Daily structured plan and milestone tracking for {activeCourse.name}</p>
                </div>
                {onOpenStudyPlanner && (
                  <button
                    className="text-button"
                    onClick={() => {
                      onOpenStudyPlanner({
                        courseId: activeCourse.id,
                        courseName: activeCourse.name,
                        subject: activeCourse.name,
                        topics: notes.filter((n) => n.courseId === activeCourse.id).map((n) => n.title).slice(0, 4),
                      });
                    }}
                  >
                    {studyPlans.find((p) => p.courseId === activeCourse.id) ? "View in Study Planner ↗" : "Create Study Plan for Course ↗"}
                  </button>
                )}
              </div>

              {(() => {
                const plan = studyPlans.find((p) => p.courseId === activeCourse.id);
                if (!plan) {
                  return (
                    <div className="overview-empty-box">
                      <span className="empty-icon">📅</span>
                      <strong>No active study schedule generated for this course</strong>
                      <p>Generate a 7, 14, or 30-day adaptive study plan based on your available daily time and test mistakes.</p>
                      {onOpenStudyPlanner && (
                        <button
                          type="button"
                          className="primary-btn small-btn"
                          style={{ marginTop: "12px" }}
                          onClick={() => {
                            onOpenStudyPlanner({
                              courseId: activeCourse.id,
                              courseName: activeCourse.name,
                              subject: activeCourse.name,
                              topics: notes.filter((n) => n.courseId === activeCourse.id).map((n) => n.title).slice(0, 4),
                            });
                          }}
                        >
                          Generate Course Study Plan ⚡
                        </button>
                      )}
                    </div>
                  );
                }

                const tasks = plan.tasks || [];
                const completed = tasks.filter((t) => t.completed).length;
                const pct = tasks.length > 0 ? Math.round((completed / tasks.length) * 100) : 0;

                return (
                  <div className="course-plan-widget" style={{ padding: "16px", background: "linear-gradient(135deg, #faf9ff 0%, #ffffff 100%)", borderRadius: "12px", border: "1px solid #e5dbff" }}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "12px" }}>
                      <div>
                        <strong style={{ fontSize: "16px", color: "#4c32b3" }}>{plan.title}</strong>
                        <div style={{ fontSize: "13px", color: "#666", marginTop: "2px" }}>
                          {plan.durationDays} Days · {plan.dailyMinutes} mins/day · {tasks.length} Total Tasks
                        </div>
                      </div>
                      <span style={{ fontSize: "18px", fontWeight: "700", color: "#6350db" }}>{pct}% Done</span>
                    </div>

                    <div style={{ width: "100%", height: "8px", background: "#eee", borderRadius: "4px", overflow: "hidden", marginBottom: "14px" }}>
                      <div style={{ width: `${pct}%`, height: "100%", background: "linear-gradient(90deg, #7667f5, #6350db)", borderRadius: "4px" }} />
                    </div>

                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                      <span style={{ fontSize: "13px", color: "#555" }}>
                        ✓ {completed} of {tasks.length} tasks completed
                      </span>
                      {onOpenStudyPlanner && (
                        <button
                          type="button"
                          className="primary-btn small-btn"
                          onClick={() => onOpenStudyPlanner({ courseId: activeCourse.id })}
                        >
                          Open Active Plan ↗
                        </button>
                      )}
                    </div>
                  </div>
                );
              })()}
            </div>

            {/* COURSE MOCK TESTS PANEL */}
            <div className="panel course-content-panel" style={{ gridColumn: "1 / -1" }}>
              <div className="panel-heading">
                <div>
                  <h3>Course Mock Examinations ({mockTests.filter((m) => m.courseId === activeCourse.id).length})</h3>
                  <p>Timed exams and comprehensive assessments for this course</p>
                </div>
                <button
                  className="text-button"
                  onClick={() => {
                    if (onOpenMockTestForCourse) {
                      onOpenMockTestForCourse(activeCourse.id);
                    } else if (setActivePage) {
                      setActivePage("Mock Tests");
                    }
                  }}
                >
                  Create Course Mock Test ↗
                </button>
              </div>

              {mockTests.filter((m) => m.courseId === activeCourse.id).length === 0 ? (
                <div className="overview-empty-box">
                  <span className="empty-icon">📝</span>
                  <strong>No mock tests generated for this course yet</strong>
                  <p>Simulate a realistic timed exam based on this course's syllabus and study notes.</p>
                </div>
              ) : (
                <div className="course-quiz-list">
                  {mockTests
                    .filter((m) => m.courseId === activeCourse.id)
                    .map((test) => {
                      const latestAtt = test.attempts?.[0];
                      return (
                        <div key={test.id} className="course-quiz-item">
                          <div>
                            <strong>{test.title}</strong>
                            <small>
                              {test.difficulty} · {test.questionCount} Questions · {test.totalMarks} Marks · {test.attempts?.length || 0} attempts
                            </small>
                          </div>
                          <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                            {latestAtt && (
                              <span className="quiz-score-badge" style={{ background: "#f1edfe", color: "#6350db" }}>
                                Best: {latestAtt.percentage}%
                              </span>
                            )}
                            <button
                              type="button"
                              className="continue-resume-btn"
                              onClick={() => {
                                if (onOpenMockTestForCourse) {
                                  onOpenMockTestForCourse(activeCourse.id);
                                } else if (setActivePage) {
                                  setActivePage("Mock Tests");
                                }
                              }}
                            >
                              Open ↗
                            </button>
                          </div>
                        </div>
                      );
                    })}
                </div>
              )}
            </div>
          </div>
        </div>
      ) : (
        /* ALL COURSES VIEW */
        <>
          {/* FILTER & SEARCH TOOLBAR */}
          <div className="courses-toolbar">
            <div className="courses-search-wrap">
              <span className="search-icon">🔍</span>
              <input
                type="text"
                className="courses-search-input"
                placeholder="Search courses by name or topic..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
              />
            </div>

            <div className="courses-filters">
              {categories.length > 0 && (
                <select
                  value={categoryFilter}
                  onChange={(e) => setCategoryFilter(e.target.value)}
                  className="courses-filter-select"
                >
                  <option value="all">All Categories</option>
                  {categories.map((cat) => (
                    <option key={cat} value={cat}>
                      {cat}
                    </option>
                  ))}
                </select>
              )}

              <select
                value={sortBy}
                onChange={(e) => setSortBy(e.target.value)}
                className="courses-filter-select"
              >
                <option value="recent">Recently Updated</option>
                <option value="name">Course Name (A–Z)</option>
              </select>
            </div>
          </div>

          {/* COURSES GRID */}
          {displayedCourses.length === 0 ? (
            <div className="courses-empty-state">
              <span className="empty-icon">⌘</span>
              <h3>No courses found</h3>
              <p>
                {searchQuery || categoryFilter !== "all"
                  ? "Try clearing your search filters."
                  : "Create your first course to organize your notes, summaries, and practice quizzes."}
              </p>
              <button
                type="button"
                className="primary-button"
                onClick={handleOpenCreateModal}
              >
                Create your first course ↗
              </button>
            </div>
          ) : (
            <div className="courses-cards-grid">
              {displayedCourses.map((course) => {
                const linkedNotes = notes.filter((n) => n.courseId === course.id);
                const linkedQuizzes = quizzes.filter((q) => q.courseId === course.id);
                const linkedSessions = sessions.filter((s) => s.courseId === course.id);
                const minutesLogged = linkedSessions.reduce((sum, s) => sum + (s.durationMinutes || 0), 0);

                return (
                  <div
                    key={course.id}
                    className="course-card"
                    style={{ "--course-accent": course.color }}
                    onClick={() => setSelectedCourseId(course.id)}
                  >
                    <div className="course-card-top">
                      <div className="course-card-icon" style={{ background: course.color }}>
                        {course.icon}
                      </div>

                      <div className="course-card-badges">
                        <span className="course-cat-pill">{course.category}</span>
                        <div className="course-card-kebab">
                          <button
                            type="button"
                            className="icon-action-btn"
                            onClick={(e) => handleOpenEditModal(course, e)}
                            title="Edit course"
                          >
                            ✎
                          </button>
                          <button
                            type="button"
                            className="icon-action-btn"
                            onClick={(e) => handleDeleteCourse(course.id, course.name, e)}
                            title="Delete course"
                          >
                            ✕
                          </button>
                        </div>
                      </div>
                    </div>

                    <h3 className="course-card-title">{course.name}</h3>
                    <p className="course-card-desc">{course.description || "No description provided."}</p>

                    <div className="course-card-footer">
                      <div className="course-metrics-inline">
                        <span>📄 {linkedNotes.length} notes</span>
                        <span>✎ {linkedQuizzes.length} quizzes</span>
                        <span>📝 {mockTests.filter((m) => m.courseId === course.id).length} tests</span>
                        <span>◷ {(minutesLogged / 60).toFixed(1)}h</span>
                      </div>
                      <span className="course-open-arrow">Open →</span>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </>
      )}

      {/* CREATE / EDIT COURSE MODAL */}
      {isModalOpen && (
        <div className="modal-overlay" onClick={() => setIsModalOpen(false)}>
          <div className="modal-content" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h3>{editingCourse ? "Edit Course" : "Create New Course"}</h3>
              <button
                type="button"
                className="modal-close-btn"
                onClick={() => setIsModalOpen(false)}
              >
                ✕
              </button>
            </div>

            <form onSubmit={handleSaveCourse} className="modal-form">
              <div className="form-group">
                <label htmlFor="course-name">Course Name *</label>
                <input
                  id="course-name"
                  type="text"
                  required
                  placeholder="e.g. Distributed Systems, Calculus II"
                  value={formData.name}
                  onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                />
              </div>

              <div className="form-group">
                <label htmlFor="course-desc">Description</label>
                <textarea
                  id="course-desc"
                  rows={3}
                  placeholder="What key subjects and concepts does this course cover?"
                  value={formData.description}
                  onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                />
              </div>

              <div className="form-row">
                <div className="form-group">
                  <label htmlFor="course-cat">Subject / Category</label>
                  <input
                    id="course-cat"
                    type="text"
                    placeholder="e.g. Computer Science, Science"
                    value={formData.category}
                    onChange={(e) => setFormData({ ...formData, category: e.target.value })}
                  />
                </div>

                <div className="form-group">
                  <label htmlFor="course-date">Target Completion Date</label>
                  <input
                    id="course-date"
                    type="date"
                    value={formData.targetDate}
                    onChange={(e) => setFormData({ ...formData, targetDate: e.target.value })}
                  />
                </div>
              </div>

              <div className="form-group">
                <label>Course Icon</label>
                <div className="icon-selector-grid">
                  {COURSE_ICONS.map((ic) => (
                    <button
                      key={ic}
                      type="button"
                      className={`icon-choice-btn ${formData.icon === ic ? "selected" : ""}`}
                      onClick={() => setFormData({ ...formData, icon: ic })}
                    >
                      {ic}
                    </button>
                  ))}
                </div>
              </div>

              <div className="form-group">
                <label>Theme Color</label>
                <div className="color-selector-grid">
                  {COURSE_COLORS.map((col) => (
                    <button
                      key={col}
                      type="button"
                      className={`color-choice-btn ${formData.color === col ? "selected" : ""}`}
                      style={{ background: col }}
                      onClick={() => setFormData({ ...formData, color: col })}
                    />
                  ))}
                </div>
              </div>

              <div className="modal-actions">
                <button
                  type="button"
                  className="btn-outline-small"
                  onClick={() => setIsModalOpen(false)}
                >
                  Cancel
                </button>
                <button type="submit" className="primary-button">
                  {editingCourse ? "Save Changes" : "Create Course"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
