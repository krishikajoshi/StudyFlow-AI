import { useState, useEffect } from "react";
import {
  getGoals,
  saveGoal,
  toggleGoalStatus,
  deleteGoal,
  getCourses,
} from "../utils/storage";

const GOAL_PRESETS = [
  {
    title: "Log 60 Minutes of Study",
    description: "Build steady momentum with active study sessions.",
    category: "study_time",
    target: 60,
    unit: "minutes",
  },
  {
    title: "Complete 3 Practice Quizzes",
    description: "Reinforce learning through active recall tests.",
    category: "quiz_score",
    target: 3,
    unit: "quizzes",
  },
  {
    title: "Review 25 Flashcards",
    description: "Strengthen long-term retention using spaced repetition.",
    category: "flashcards",
    target: 25,
    unit: "cards",
  },
  {
    title: "Complete 2 Timed Mock Tests",
    description: "Test exam readiness with realistic timed conditions.",
    category: "mock_test",
    target: 2,
    unit: "tests",
  },
];

export default function GoalsTab() {
  const [goals, setGoals] = useState(() => getGoals());
  const [courses, setCourses] = useState(() => getCourses());
  const [mountTime] = useState(() => Date.now());

  // Active filter tab: "active" | "completed" | "all"
  const [filterTab, setFilterTab] = useState("active");

  // Modal state
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingGoal, setEditingGoal] = useState(null);
  const [formData, setFormData] = useState({
    title: "",
    description: "",
    category: "study_time",
    target: 60,
    unit: "minutes",
    courseId: "",
    deadline: "",
  });

  function loadData() {
    setGoals(getGoals());
    setCourses(getCourses());
  }

  useEffect(() => {
    window.addEventListener("studyflow_storage_sync", loadData);
    return () => window.removeEventListener("studyflow_storage_sync", loadData);
  }, []);

  function handleOpenCreateModal(preset = null) {
    setEditingGoal(null);
    if (preset) {
      setFormData({
        title: preset.title,
        description: preset.description,
        category: preset.category,
        target: preset.target,
        unit: preset.unit,
        courseId: "",
        deadline: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString().split("T")[0],
      });
    } else {
      setFormData({
        title: "",
        description: "",
        category: "study_time",
        target: 60,
        unit: "minutes",
        courseId: "",
        deadline: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString().split("T")[0],
      });
    }
    setIsModalOpen(true);
  }

  function handleOpenEditModal(goal, e) {
    e.stopPropagation();
    setEditingGoal(goal);
    setFormData({
      title: goal.title || "",
      description: goal.description || "",
      category: goal.category || "study_time",
      target: goal.target || 1,
      unit: goal.unit || "units",
      courseId: goal.courseId || "",
      deadline: goal.deadline || "",
    });
    setIsModalOpen(true);
  }

  function handleSaveGoal(e) {
    e.preventDefault();
    if (!formData.title.trim()) return;

    saveGoal({
      id: editingGoal?.id,
      title: formData.title.trim(),
      description: formData.description.trim(),
      category: formData.category,
      target: parseInt(formData.target, 10) || 1,
      unit: formData.unit || "units",
      courseId: formData.courseId || null,
      deadline: formData.deadline || null,
    });

    setIsModalOpen(false);
    loadData();
  }

  function handleToggleStatus(id, e) {
    e.stopPropagation();
    toggleGoalStatus(id);
    loadData();
  }

  function handleDeleteGoal(id, title, e) {
    e.stopPropagation();
    if (window.confirm(`Are you sure you want to delete goal "${title}"?`)) {
      deleteGoal(id);
      loadData();
    }
  }

  function handleManualProgress(goal, delta, e) {
    e.stopPropagation();
    const newCurrent = Math.max(0, Math.min(goal.target, (goal.current || 0) + delta));
    const isNowCompleted = newCurrent >= goal.target;

    saveGoal({
      ...goal,
      current: newCurrent,
      status: isNowCompleted ? "completed" : goal.status === "completed" ? "active" : goal.status,
    });
    loadData();
  }

  const activeGoals = goals.filter((g) => g.status === "active");
  const completedGoals = goals.filter((g) => g.status === "completed");

  const displayedGoals =
    filterTab === "active"
      ? activeGoals
      : filterTab === "completed"
      ? completedGoals
      : goals;

  return (
    <div className="goals-tab-container">
      {/* HEADER SECTION */}
      <div className="goals-header-row">
        <div>
          <div className="eyebrow">TARGETS & ACCOUNTABILITY</div>
          <h1>
            My Goals<span>.</span>
          </h1>
          <p className="welcome-subtitle">
            Set actionable study milestones and track progress connected to your real study activity.
          </p>
        </div>

        <button
          type="button"
          className="primary-button"
          onClick={() => handleOpenCreateModal()}
        >
          <span>＋</span> Create Goal
        </button>
      </div>

      {/* FILTER TABS & METRICS */}
      <div className="goals-subnav-row">
        <div className="goals-tabs">
          <button
            type="button"
            className={`goals-tab-btn ${filterTab === "active" ? "active" : ""}`}
            onClick={() => setFilterTab("active")}
          >
            Active Goals ({activeGoals.length})
          </button>
          <button
            type="button"
            className={`goals-tab-btn ${filterTab === "completed" ? "active" : ""}`}
            onClick={() => setFilterTab("completed")}
          >
            Completed ({completedGoals.length})
          </button>
          <button
            type="button"
            className={`goals-tab-btn ${filterTab === "all" ? "active" : ""}`}
            onClick={() => setFilterTab("all")}
          >
            All ({goals.length})
          </button>
        </div>

        <div className="goals-completion-badge">
          <span>{completedGoals.length} of {goals.length} Finished</span>
          <strong>
            {goals.length > 0
              ? `${Math.round((completedGoals.length / goals.length) * 100)}%`
              : "0%"}
          </strong>
        </div>
      </div>

      {/* GOALS LIST */}
      {displayedGoals.length === 0 ? (
        <div className="goals-empty-state">
          <span className="empty-icon">◎</span>
          <h3>
            {filterTab === "completed"
              ? "No completed goals yet"
              : "No active goals set"}
          </h3>
          <p>
            {filterTab === "completed"
              ? "Keep working towards your active milestones! They will show here once completed."
              : "Choose a quick goal idea below or create your own custom milestone."}
          </p>

          {/* QUICK PRESET TEMPLATES */}
          <div className="goal-presets-grid">
            {GOAL_PRESETS.map((preset, idx) => (
              <div
                key={idx}
                className="goal-preset-card"
                onClick={() => handleOpenCreateModal(preset)}
              >
                <strong>{preset.title}</strong>
                <p>{preset.description}</p>
                <span>Click to adopt this goal →</span>
              </div>
            ))}
          </div>
        </div>
      ) : (
        <div className="goals-cards-grid">
          {displayedGoals.map((goal) => {
            const course = courses.find((c) => c.id === goal.courseId);
            const isCompleted = goal.status === "completed";
            const progressPct =
              goal.target > 0
                ? Math.min(100, Math.round(((goal.current || 0) / goal.target) * 100))
                : 0;

            const daysLeft = goal.deadline
              ? Math.ceil(
                  (new Date(goal.deadline).getTime() - mountTime) /
                    (1000 * 60 * 60 * 24)
                )
              : null;

            return (
              <div
                key={goal.id}
                className={`goal-card ${isCompleted ? "is-completed" : ""}`}
              >
                <div className="goal-card-top">
                  <button
                    type="button"
                    className={`goal-check-btn ${isCompleted ? "checked" : ""}`}
                    onClick={(e) => handleToggleStatus(goal.id, e)}
                    title={isCompleted ? "Mark incomplete" : "Mark completed"}
                  >
                    {isCompleted ? "✓" : ""}
                  </button>

                  <div className="goal-card-meta">
                    {course && (
                      <span className="course-pill-tiny" style={{ "--c-color": course.color }}>
                        {course.icon} {course.name}
                      </span>
                    )}
                    {daysLeft !== null && (
                      <span
                        className={`deadline-pill ${
                          daysLeft < 0
                            ? "overdue"
                            : daysLeft <= 2
                            ? "urgent"
                            : "normal"
                        }`}
                      >
                        {daysLeft < 0
                          ? "Overdue"
                          : daysLeft === 0
                          ? "Due today"
                          : `${daysLeft}d left`}
                      </span>
                    )}
                  </div>

                  <div className="goal-card-actions">
                    <button
                      type="button"
                      className="icon-action-btn"
                      onClick={(e) => handleOpenEditModal(goal, e)}
                      title="Edit goal"
                    >
                      ✎
                    </button>
                    <button
                      type="button"
                      className="icon-action-btn"
                      onClick={(e) => handleDeleteGoal(goal.id, goal.title, e)}
                      title="Delete goal"
                    >
                      ✕
                    </button>
                  </div>
                </div>

                <h3 className="goal-card-title">{goal.title}</h3>
                {goal.description && (
                  <p className="goal-card-desc">{goal.description}</p>
                )}

                {/* PROGRESS TRACK */}
                <div className="goal-progress-section">
                  <div className="goal-progress-label-row">
                    <span>Progress: {progressPct}%</span>
                    <strong>
                      {goal.current || 0} / {goal.target} {goal.unit}
                    </strong>
                  </div>

                  <div className="progress-track">
                    <div
                      className="progress-fill"
                      style={{ width: `${progressPct}%` }}
                    />
                  </div>

                  {/* Manual adjustment stepper */}
                  {!isCompleted && (
                    <div className="goal-stepper-row">
                      <small>Manual update:</small>
                      <button
                        type="button"
                        className="stepper-btn"
                        onClick={(e) => handleManualProgress(goal, -1, e)}
                        disabled={(goal.current || 0) <= 0}
                      >
                        –
                      </button>
                      <button
                        type="button"
                        className="stepper-btn"
                        onClick={(e) => handleManualProgress(goal, +1, e)}
                        disabled={(goal.current || 0) >= goal.target}
                      >
                        +
                      </button>
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* CREATE / EDIT GOAL MODAL */}
      {isModalOpen && (
        <div className="modal-overlay" onClick={() => setIsModalOpen(false)}>
          <div className="modal-content" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h3>{editingGoal ? "Edit Goal" : "Create Study Goal"}</h3>
              <button
                type="button"
                className="modal-close-btn"
                onClick={() => setIsModalOpen(false)}
              >
                ✕
              </button>
            </div>

            <form onSubmit={handleSaveGoal} className="modal-form">
              <div className="form-group">
                <label htmlFor="goal-title">Goal Title *</label>
                <input
                  id="goal-title"
                  type="text"
                  required
                  placeholder="e.g. Master Binary Search, Study 120 Minutes"
                  value={formData.title}
                  onChange={(e) => setFormData({ ...formData, title: e.target.value })}
                />
              </div>

              <div className="form-group">
                <label htmlFor="goal-desc">Description</label>
                <textarea
                  id="goal-desc"
                  rows={2}
                  placeholder="Why is this goal important? What will you practice?"
                  value={formData.description}
                  onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                />
              </div>

              <div className="form-row">
                <div className="form-group">
                  <label htmlFor="goal-cat">Goal Category</label>
                  <select
                    id="goal-cat"
                    value={formData.category}
                    onChange={(e) => {
                      const cat = e.target.value;
                      let unit = "units";
                      if (cat === "study_time") unit = "minutes";
                      if (cat === "quiz_score") unit = "quizzes";
                      if (cat === "mock_test") unit = "tests";
                      if (cat === "flashcards") unit = "cards";
                      setFormData({ ...formData, category: cat, unit });
                    }}
                  >
                    <option value="study_time">Study Time (Minutes)</option>
                    <option value="quiz_score">Practice Quizzes (Count)</option>
                    <option value="mock_test">Mock Examinations (Count)</option>
                    <option value="flashcards">Flashcard Reviews (Count)</option>
                    <option value="custom">Custom Milestone</option>
                  </select>
                </div>

                <div className="form-group">
                  <label htmlFor="goal-target">Target Target ({formData.unit})</label>
                  <input
                    id="goal-target"
                    type="number"
                    min="1"
                    required
                    value={formData.target}
                    onChange={(e) => setFormData({ ...formData, target: e.target.value })}
                  />
                </div>
              </div>

              <div className="form-row">
                <div className="form-group">
                  <label htmlFor="goal-course">Link to Course (Optional)</label>
                  <select
                    id="goal-course"
                    value={formData.courseId}
                    onChange={(e) => setFormData({ ...formData, courseId: e.target.value })}
                  >
                    <option value="">No Course Link</option>
                    {courses.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="form-group">
                  <label htmlFor="goal-deadline">Deadline Date</label>
                  <input
                    id="goal-deadline"
                    type="date"
                    value={formData.deadline}
                    onChange={(e) => setFormData({ ...formData, deadline: e.target.value })}
                  />
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
                  {editingGoal ? "Save Changes" : "Create Goal"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
