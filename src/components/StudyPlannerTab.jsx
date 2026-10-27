import { useState, useEffect } from "react";
import {
  getStudyPlans,
  getActiveStudyPlan,
  setActiveStudyPlanId,
  saveStudyPlan,
  deleteStudyPlan,
  toggleStudyPlanTask,
  rescheduleStudyPlanTask,
  addCustomStudyPlanTask,
  deleteStudyPlanTask,
  extractAssessmentWeaknesses,
  getCourses,
  getSavedNotes,
  getGoals,
} from "../utils/storage";

export default function StudyPlannerTab({
  setActivePage,
  onOpenNote,
  onSendToAITutor,
  initialPlanConfig = null,
}) {
  const [plans, setPlans] = useState(() => getStudyPlans());
  const [activePlan, setActivePlan] = useState(() => getActiveStudyPlan());
  const [courses, setCourses] = useState(() => getCourses());
  const [notes, setNotes] = useState(() => getSavedNotes());
  const [goals, setGoals] = useState(() => getGoals());

  // Filter & View State
  const [viewFilter, setViewFilter] = useState("all"); // "all" | "today" | "upcoming" | "priority" | "completed"
  const [selectedDayNumber, setSelectedDayNumber] = useState(1);
  const [searchQuery, setSearchQuery] = useState("");

  // Create Plan Modal State
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(() => Boolean(initialPlanConfig));
  const [isGenerating, setIsGenerating] = useState(false);
  const [generationError, setGenerationError] = useState("");

  // Add Task Modal State
  const [isAddTaskModalOpen, setIsAddTaskModalOpen] = useState(false);
  const [newTaskData, setNewTaskData] = useState({
    title: "",
    topic: "",
    type: "learn",
    estimatedMinutes: 30,
    priority: "Medium",
    scheduledDate: new Date().toISOString().split("T")[0],
    description: "",
  });

  // Reschedule Task State
  const [reschedulingTask, setReschedulingTask] = useState(null);
  const [rescheduleDate, setRescheduleDate] = useState("");

  // Plan Form State
  const [formData, setFormData] = useState(() => ({
    courseId: initialPlanConfig?.courseId || "",
    subject: initialPlanConfig?.subject || initialPlanConfig?.courseName || "",
    topics: Array.isArray(initialPlanConfig?.topics) ? initialPlanConfig.topics : [],
    dailyMinutes: initialPlanConfig?.dailyMinutes || 60,
    durationDays: initialPlanConfig?.durationDays || 14,
    targetExamDate: "",
    goalId: "",
  }));
  const [topicInput, setTopicInput] = useState("");

  // Handle incoming configuration adjustments during rendering
  const [prevConfig, setPrevConfig] = useState(initialPlanConfig);
  if (initialPlanConfig !== prevConfig) {
    setPrevConfig(initialPlanConfig);
    if (initialPlanConfig) {
      setFormData((prev) => ({
        ...prev,
        courseId: initialPlanConfig.courseId || "",
        subject: initialPlanConfig.subject || initialPlanConfig.courseName || prev.subject,
        topics: Array.isArray(initialPlanConfig.topics) && initialPlanConfig.topics.length > 0
          ? initialPlanConfig.topics
          : prev.topics,
        dailyMinutes: initialPlanConfig.dailyMinutes || prev.dailyMinutes,
        durationDays: initialPlanConfig.durationDays || prev.durationDays,
      }));
      setIsCreateModalOpen(true);
    }
  }

  // Pre-load assessment weaknesses for contextual hints
  const [assessmentWeaknesses, setAssessmentWeaknesses] = useState(() =>
    extractAssessmentWeaknesses()
  );

  function reloadPlannerData() {
    const updatedPlans = getStudyPlans();
    setPlans(updatedPlans);
    setActivePlan(getActiveStudyPlan());
    setCourses(getCourses());
    setNotes(getSavedNotes());
    setGoals(getGoals());
    setAssessmentWeaknesses(extractAssessmentWeaknesses());
  }

  useEffect(() => {
    window.addEventListener("studyflow_storage_sync", reloadPlannerData);
    return () => window.removeEventListener("studyflow_storage_sync", reloadPlannerData);
  }, []);

  // When course changes in create modal, refresh weaknesses for that course
  function handleCourseChange(selectedCourseId) {
    const foundCourse = courses.find((c) => c.id === selectedCourseId);
    const newWeaknesses = extractAssessmentWeaknesses(selectedCourseId || null);
    setAssessmentWeaknesses(newWeaknesses);

    setFormData((prev) => ({
      ...prev,
      courseId: selectedCourseId,
      subject: foundCourse ? foundCourse.name : prev.subject,
      topics:
        newWeaknesses.weakTopics.length > 0
          ? newWeaknesses.weakTopics.slice(0, 5)
          : prev.topics.length > 0
          ? prev.topics
          : foundCourse
          ? [foundCourse.name, "Foundations", "Core Principles"]
          : [],
      targetExamDate: foundCourse?.targetDate || prev.targetExamDate,
    }));
  }

  function handleAddTopic() {
    const trimmed = topicInput.trim();
    if (!trimmed) return;
    if (!formData.topics.includes(trimmed)) {
      setFormData((prev) => ({
        ...prev,
        topics: [...prev.topics, trimmed],
      }));
    }
    setTopicInput("");
  }

  function handleRemoveTopic(topicToRemove) {
    setFormData((prev) => ({
      ...prev,
      topics: prev.topics.filter((t) => t !== topicToRemove),
    }));
  }

  function handleAutoFillWeakTopics() {
    const weaknesses = extractAssessmentWeaknesses(formData.courseId || null);
    if (weaknesses.weakTopics.length > 0) {
      setFormData((prev) => ({
        ...prev,
        topics: Array.from(new Set([...prev.topics, ...weaknesses.weakTopics.slice(0, 6)])),
      }));
    } else {
      alert("No previous assessment mistakes recorded yet. Add your chosen topics manually!");
    }
  }

  async function handleGeneratePlan(e) {
    if (e) e.preventDefault();
    if (!formData.subject.trim()) {
      setGenerationError("Please enter a subject or select an existing course.");
      return;
    }

    if (formData.topics.length === 0 && !topicInput.trim()) {
      setGenerationError("Please add at least one topic to study.");
      return;
    }

    const finalTopics = [...formData.topics];
    if (topicInput.trim() && !finalTopics.includes(topicInput.trim())) {
      finalTopics.push(topicInput.trim());
    }

    setIsGenerating(true);
    setGenerationError("");

    const realHistory = extractAssessmentWeaknesses(formData.courseId || null);
    const availableNotes = notes.map((n) => ({ id: n.id, title: n.title, text: (n.text || "").slice(0, 500) }));

    const payload = {
      courseId: formData.courseId || null,
      subject: formData.subject.trim(),
      topics: finalTopics,
      dailyMinutes: parseInt(formData.dailyMinutes, 10) || 60,
      durationDays: parseInt(formData.durationDays, 10) || 14,
      targetExamDate: formData.targetExamDate || null,
      goalId: formData.goalId || null,
      assessmentHistory: realHistory.hasHistory ? realHistory : null,
      notesAvailable: availableNotes,
    };

    try {
      const endpoint = "/api/study-planner/generate";
      let response = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      }).catch(async () => {
        return await fetch("http://localhost:3001/api/study-planner/generate", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
      });

      const data = await response.json().catch(() => ({}));

      if (!response.ok || !data.success) {
        throw new Error(data.error || "Failed to generate study plan.");
      }

      const saved = saveStudyPlan({
        title: data.planTitle,
        subject: data.subject,
        courseId: data.courseId,
        topics: data.topics,
        dailyMinutes: data.dailyMinutes,
        durationDays: data.durationDays,
        targetExamDate: data.targetExamDate,
        goalId: data.goalId,
        tasks: data.tasks,
        personalizationContext: data.personalizationContext,
        summary: data.summary,
      });

      reloadPlannerData();
      setActivePlan(saved);
      setIsCreateModalOpen(false);
      setTopicInput("");
    } catch (err) {
      console.error("Study plan generation failed:", err);
      setGenerationError(err.message || "Failed to generate plan. Please try again.");
    } finally {
      setIsGenerating(false);
    }
  }

  function handleToggleTask(taskId) {
    if (!activePlan) return;
    toggleStudyPlanTask(activePlan.id, taskId);
    reloadPlannerData();
  }

  function handleSaveReschedule(e) {
    if (e) e.preventDefault();
    if (!reschedulingTask || !rescheduleDate) return;
    rescheduleStudyPlanTask(activePlan.id, reschedulingTask.id, rescheduleDate);
    setReschedulingTask(null);
    setRescheduleDate("");
    reloadPlannerData();
  }

  function handleCreateCustomTask(e) {
    if (e) e.preventDefault();
    if (!activePlan || !newTaskData.title.trim()) return;

    addCustomStudyPlanTask(activePlan.id, {
      ...newTaskData,
      dayNumber: selectedDayNumber,
    });

    setIsAddTaskModalOpen(false);
    setNewTaskData({
      title: "",
      topic: activePlan.subject || "General",
      type: "learn",
      estimatedMinutes: 30,
      priority: "Medium",
      scheduledDate: new Date().toISOString().split("T")[0],
      description: "",
    });
    reloadPlannerData();
  }

  function handleDeleteTask(taskId) {
    if (!activePlan) return;
    if (window.confirm("Are you sure you want to remove this task from your plan?")) {
      deleteStudyPlanTask(activePlan.id, taskId);
      reloadPlannerData();
    }
  }

  function handleDeleteCurrentPlan() {
    if (!activePlan) return;
    if (
      window.confirm(
        `Are you sure you want to delete "${activePlan.title}"? Your logged study history will be preserved.`
      )
    ) {
      deleteStudyPlan(activePlan.id);
      reloadPlannerData();
    }
  }

  function handleTaskAITutor(task) {
    const prompt = `I am currently working on my Study Plan task: "${task.title}" (${task.topic}).
Task Description: ${task.description || "Foundational review"}.
Please give me a concise conceptual breakdown, a memory trigger/analogy, and 2 fast recall questions to test my understanding!`;
    if (onSendToAITutor) {
      onSendToAITutor(prompt);
    } else {
      setActivePage("AI Tutor");
    }
  }

  function handleOpenLinkedNote(noteId) {
    const found = notes.find((n) => n.id === noteId);
    if (found && onOpenNote) {
      onOpenNote(found);
    } else {
      setActivePage("My Notes");
    }
  }

  // Filter tasks for active plan
  const tasks = activePlan?.tasks || [];
  const todayStr = new Date().toISOString().split("T")[0];

  const filteredTasks = tasks.filter((t) => {
    // Search query
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      const match =
        t.title.toLowerCase().includes(q) ||
        t.topic.toLowerCase().includes(q) ||
        (t.description || "").toLowerCase().includes(q);
      if (!match) return false;
    }

    if (viewFilter === "today") {
      return t.scheduledDate === todayStr;
    }
    if (viewFilter === "upcoming") {
      return !t.completed && t.scheduledDate >= todayStr;
    }
    if (viewFilter === "priority") {
      return t.priority === "High";
    }
    if (viewFilter === "completed") {
      return t.completed;
    }
    if (viewFilter === "by-day") {
      return t.dayNumber === selectedDayNumber;
    }
    return true;
  });

  // Calculate day-by-day metrics
  const totalDays = activePlan?.durationDays || 14;
  const dayTabs = Array.from({ length: totalDays }, (_, i) => i + 1);

  const completedCount = tasks.filter((t) => t.completed).length;
  const totalCount = tasks.length;
  const progressPct = totalCount > 0 ? Math.round((completedCount / totalCount) * 100) : 0;

  const todayTasks = tasks.filter((t) => t.scheduledDate === todayStr);
  const todayCompletedCount = todayTasks.filter((t) => t.completed).length;
  const todayTotalMinutes = todayTasks.reduce((acc, t) => acc + (t.estimatedMinutes || 0), 0);
  const todayCompletedMinutes = todayTasks
    .filter((t) => t.completed)
    .reduce((acc, t) => acc + (t.estimatedMinutes || 0), 0);

  return (
    <div className="planner-container">
      {/* HEADER SECTION */}
      <section className="welcome-section">
        <div>
          <div className="eyebrow">
            <span className="live-dot" /> INTELLIGENT PERSONALIZED LEARNING
          </div>
          <h1>
            AI Study Planner<span>.</span>
          </h1>
          <p className="welcome-subtitle">
            Curated daily study schedules adapting to your exam targets, daily time budget, and actual test mistakes.
          </p>
        </div>

        <div className="planner-header-actions">
          {plans.length > 1 && (
            <select
              className="planner-plan-select"
              value={activePlan?.id || ""}
              onChange={(e) => {
                setActiveStudyPlanId(e.target.value);
                reloadPlannerData();
              }}
            >
              {plans.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.title} ({p.durationDays}d)
                </option>
              ))}
            </select>
          )}

          <button
            type="button"
            className="primary-button"
            onClick={() => {
              setGenerationError("");
              setIsCreateModalOpen(true);
            }}
          >
            <span>✦</span> Create New Study Plan <span>↗</span>
          </button>
        </div>
      </section>

      {/* NO ACTIVE PLAN STATE */}
      {!activePlan ? (
        <div className="planner-empty-hero">
          <div className="empty-sparkle">📅</div>
          <h2>No Active Study Plan Yet</h2>
          <p>
            Build your first personalized schedule based on your available study time, chosen topics, and real test assessment diagnostics.
          </p>
          <div className="planner-empty-features">
            <div className="feature-chip">⏱ Daily study time limits respected</div>
            <div className="feature-chip">🎯 Direct integration with past test mistakes</div>
            <div className="feature-chip">✓ Dynamic rescheduling & task tracking</div>
          </div>
          <button
            type="button"
            className="primary-btn pulse-glow"
            onClick={() => setIsCreateModalOpen(true)}
          >
            Create My Personalized Study Plan ⚡
          </button>
        </div>
      ) : (
        <>
          {/* ACTIVE PLAN HERO CARD */}
          <div className="planner-hero-card">
            <div className="planner-hero-top">
              <div className="planner-hero-info">
                <div className="plan-badge-row">
                  <span className="plan-subject-tag">{activePlan.subject}</span>
                  <span className="plan-duration-tag">⏱ {activePlan.durationDays} Days Duration</span>
                  <span className="plan-time-tag">⚡ {activePlan.dailyMinutes} mins/day</span>
                  {activePlan.targetExamDate && (
                    <span className="plan-exam-tag">🎯 Exam: {activePlan.targetExamDate}</span>
                  )}
                </div>
                <h2>{activePlan.title}</h2>
                <p className="plan-summary-text">
                  {activePlan.summary || `Personalized schedule targeting ${activePlan.topics?.join(", ") || activePlan.subject}.`}
                </p>

                {activePlan.personalizationContext?.hasHistory && (
                  <div className="plan-personalization-badge">
                    <span>💡 <strong>Adaptive Diagnostic:</strong> Prioritized {activePlan.personalizationContext.weakTopicsCount || "past"} topic(s) with previous test mistakes in initial study days.</span>
                  </div>
                )}
              </div>

              <div className="planner-hero-stats">
                <div className="planner-progress-circle">
                  <div className="circle-inner">
                    <span className="circle-pct">{progressPct}%</span>
                    <span className="circle-label">Completed</span>
                  </div>
                </div>

                <div className="planner-meta-grid">
                  <div className="meta-cell">
                    <span className="meta-label">Tasks Done</span>
                    <strong>{completedCount} / {totalCount}</strong>
                  </div>
                  <div className="meta-cell">
                    <span className="meta-label">Today's Progress</span>
                    <strong>{todayCompletedCount} / {todayTasks.length}</strong>
                    <small>{todayCompletedMinutes}m of {todayTotalMinutes}m</small>
                  </div>
                </div>
              </div>
            </div>

            {/* ACTION STRIP */}
            <div className="planner-hero-footer">
              <div className="footer-left">
                <button
                  type="button"
                  className="secondary-btn small-btn"
                  onClick={() => setIsAddTaskModalOpen(true)}
                >
                  + Add Custom Task
                </button>
                <button
                  type="button"
                  className="secondary-btn small-btn"
                  onClick={() => setViewFilter("today")}
                >
                  Today's Tasks ({todayTasks.length})
                </button>
                <button
                  type="button"
                  className="secondary-btn small-btn"
                  onClick={() => setActivePage("Mock Tests")}
                >
                  Take Practice Assessment ↗
                </button>
              </div>

              <button
                type="button"
                className="danger-text-btn"
                onClick={handleDeleteCurrentPlan}
                title="Delete this study plan"
              >
                Delete Plan
              </button>
            </div>
          </div>

          {/* VIEW CONTROLS & FILTER TABS */}
          <div className="planner-toolbar">
            <div className="planner-filter-tabs">
              <button
                type="button"
                className={`p-tab ${viewFilter === "all" ? "active" : ""}`}
                onClick={() => setViewFilter("all")}
              >
                All Tasks ({totalCount})
              </button>
              <button
                type="button"
                className={`p-tab ${viewFilter === "today" ? "active" : ""}`}
                onClick={() => setViewFilter("today")}
              >
                Today ({todayTasks.length})
              </button>
              <button
                type="button"
                className={`p-tab ${viewFilter === "upcoming" ? "active" : ""}`}
                onClick={() => setViewFilter("upcoming")}
              >
                Upcoming Pending
              </button>
              <button
                type="button"
                className={`p-tab ${viewFilter === "priority" ? "active" : ""}`}
                onClick={() => setViewFilter("priority")}
              >
                High Priority
              </button>
              <button
                type="button"
                className={`p-tab ${viewFilter === "completed" ? "active" : ""}`}
                onClick={() => setViewFilter("completed")}
              >
                Completed ({completedCount})
              </button>
              <button
                type="button"
                className={`p-tab ${viewFilter === "by-day" ? "active" : ""}`}
                onClick={() => setViewFilter("by-day")}
              >
                Day-by-Day View
              </button>
            </div>

            <div className="planner-search-box">
              <input
                type="text"
                placeholder="Search tasks, topics, keywords..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
              />
            </div>
          </div>

          {/* DAY SELECTOR STRIP (When in Day-by-Day View) */}
          {viewFilter === "by-day" && (
            <div className="planner-day-strip">
              <span className="strip-title">Select Day:</span>
              <div className="day-pills-scroll">
                {dayTabs.map((dayNum) => {
                  const dayTasks = tasks.filter((t) => t.dayNumber === dayNum);
                  const isDayDone = dayTasks.length > 0 && dayTasks.every((t) => t.completed);
                  const isSelected = selectedDayNumber === dayNum;

                  return (
                    <button
                      key={dayNum}
                      type="button"
                      className={`day-selector-pill ${isSelected ? "selected" : ""} ${isDayDone ? "day-done" : ""}`}
                      onClick={() => setSelectedDayNumber(dayNum)}
                    >
                      <span className="pill-day-num">Day {dayNum}</span>
                      <span className="pill-day-sub">
                        {isDayDone ? "✓ Done" : `${dayTasks.filter((t) => t.completed).length}/${dayTasks.length}`}
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {/* TASKS LIST */}
          <div className="planner-tasks-section">
            <div className="tasks-section-header">
              <h3>
                {viewFilter === "today"
                  ? "Today's Scheduled Tasks"
                  : viewFilter === "by-day"
                  ? `Day ${selectedDayNumber} Curriculum`
                  : viewFilter === "priority"
                  ? "High Priority Remediations"
                  : viewFilter === "completed"
                  ? "Completed Tasks"
                  : "Curriculum Schedule"}
              </h3>
              <span className="tasks-counter">{filteredTasks.length} Tasks</span>
            </div>

            {filteredTasks.length === 0 ? (
              <div className="planner-no-tasks-card">
                <span className="empty-icon">✓</span>
                <h4>No tasks match this filter</h4>
                <p>
                  {viewFilter === "today"
                    ? "You have completed all scheduled tasks for today, or none are scheduled. Enjoy your momentum!"
                    : "Try adjusting your filters or search terms."}
                </p>
                {viewFilter === "today" && (
                  <button
                    type="button"
                    className="secondary-btn small-btn"
                    onClick={() => setViewFilter("all")}
                  >
                    View All Plan Tasks ↗
                  </button>
                )}
              </div>
            ) : (
              <div className="planner-task-cards-list">
                {filteredTasks.map((task) => {
                  const isToday = task.scheduledDate === todayStr;
                  const isOverdue = !task.completed && task.scheduledDate < todayStr;

                  return (
                    <div
                      key={task.id}
                      className={`planner-task-card ${task.completed ? "task-completed" : ""} ${isOverdue ? "task-overdue" : ""}`}
                    >
                      {/* TASK LEFT: CHECKBOX & PRIORITY */}
                      <div className="task-card-left">
                        <button
                          type="button"
                          className={`task-checkbox ${task.completed ? "checked" : ""}`}
                          onClick={() => handleToggleTask(task.id)}
                          title={task.completed ? "Mark incomplete" : "Mark completed"}
                        >
                          {task.completed ? "✓" : ""}
                        </button>

                        <div className="task-content">
                          <div className="task-tags-row">
                            <span className={`task-priority-tag ${task.priority.toLowerCase()}`}>
                              {task.priority} Priority
                            </span>
                            <span className={`task-type-tag ${task.type}`}>
                              {task.type === "learn"
                                ? "📖 Learn"
                                : task.type === "revise"
                                ? "◷ Revise"
                                : task.type === "practice"
                                ? "⚡ Practice"
                                : "✎ Assessment"}
                            </span>
                            <span className="task-time-tag">⏱ {task.estimatedMinutes}m</span>
                            <span className="task-date-tag">
                              📅 {task.scheduledDate} {isToday ? "(Today)" : isOverdue ? "(Overdue)" : ""}
                            </span>
                            <span className="task-topic-tag">{task.topic}</span>
                          </div>

                          <h4 className="task-title">{task.title}</h4>
                          {task.description && (
                            <p className="task-desc">{task.description}</p>
                          )}

                          {/* ACTION BUTTONS ON TASK */}
                          <div className="task-actions-row">
                            <button
                              type="button"
                              className="task-action-btn tutor"
                              onClick={() => handleTaskAITutor(task)}
                              title="Ask AI Tutor about this task"
                            >
                              💬 Ask AI Tutor
                            </button>

                            {task.linkedNoteId && (
                              <button
                                type="button"
                                className="task-action-btn note"
                                onClick={() => handleOpenLinkedNote(task.linkedNoteId)}
                                title="Open linked study note"
                              >
                                📄 Open Linked Note
                              </button>
                            )}

                            {task.type === "practice" && (
                              <button
                                type="button"
                                className="task-action-btn revision"
                                onClick={() => setActivePage("Revision")}
                                title="Practice flashcards or quizzes"
                              >
                                ◷ Practice Recall
                              </button>
                            )}

                            {task.type === "assessment" && (
                              <button
                                type="button"
                                className="task-action-btn mock"
                                onClick={() => setActivePage("Mock Tests")}
                                title="Take a mock examination"
                              >
                                ✎ Mock Tests Hub
                              </button>
                            )}

                            <button
                              type="button"
                              className="task-action-btn reschedule"
                              onClick={() => {
                                setReschedulingTask(task);
                                setRescheduleDate(task.scheduledDate || todayStr);
                              }}
                              title="Reschedule task to another date"
                            >
                              📅 Reschedule
                            </button>

                            <button
                              type="button"
                              className="task-action-btn delete"
                              onClick={() => handleDeleteTask(task.id)}
                              title="Remove task"
                            >
                              ✕
                            </button>
                          </div>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </>
      )}

      {/* MODAL: CREATE STUDY PLAN */}
      {isCreateModalOpen && (
        <div className="modal-overlay" onClick={() => !isGenerating && setIsCreateModalOpen(false)}>
          <div
            className="modal-content planner-create-modal"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="modal-header">
              <div className="ws-header-title">
                <span className="ws-badge">✦ CURRICULUM ARCHITECT</span>
                <h3>Generate Personalized Study Plan</h3>
              </div>
              {!isGenerating && (
                <button
                  type="button"
                  className="modal-close-btn"
                  onClick={() => setIsCreateModalOpen(false)}
                >
                  ✕
                </button>
              )}
            </div>

            <div className="ws-modal-body">
              {generationError && (
                <div className="mock-error-alert">
                  <span>⚠️ {generationError}</span>
                </div>
              )}

              {/* STEP 1: SUBJECT / COURSE */}
              <div className="planner-form-section">
                <label className="form-label">1. Course or Subject</label>
                <div className="course-select-grid">
                  <div className="field-group">
                    <label className="sub-label">Choose an Existing Course:</label>
                    <select
                      value={formData.courseId}
                      onChange={(e) => handleCourseChange(e.target.value)}
                    >
                      <option value="">-- Choose Course (Optional) --</option>
                      {courses.map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.icon || "⌘"} {c.name} ({c.category || "General"})
                        </option>
                      ))}
                    </select>
                  </div>

                  <div className="field-group">
                    <label className="sub-label">Or Custom Subject Name:</label>
                    <input
                      type="text"
                      placeholder="e.g. Distributed Systems, Organic Chemistry, Linear Algebra"
                      value={formData.subject}
                      onChange={(e) => setFormData((p) => ({ ...p, subject: e.target.value }))}
                    />
                  </div>
                </div>
              </div>

              {/* STEP 2: TOPICS TO COVER */}
              <div className="planner-form-section">
                <div className="topics-header-row">
                  <label className="form-label">2. Topics to Master</label>
                  {assessmentWeaknesses.hasHistory && assessmentWeaknesses.weakTopics.length > 0 && (
                    <button
                      type="button"
                      className="text-action-link"
                      onClick={handleAutoFillWeakTopics}
                    >
                      ⚡ Auto-Add Weak Topics from Test Mistakes ({assessmentWeaknesses.weakTopics.length})
                    </button>
                  )}
                </div>

                <div className="topic-input-row">
                  <input
                    type="text"
                    placeholder="Type topic and press Add (e.g. Memory Virtualization, Raft Consensus)"
                    value={topicInput}
                    onChange={(e) => setTopicInput(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        e.preventDefault();
                        handleAddTopic();
                      }
                    }}
                  />
                  <button
                    type="button"
                    className="secondary-btn"
                    onClick={handleAddTopic}
                  >
                    + Add Topic
                  </button>
                </div>

                {formData.topics.length > 0 ? (
                  <div className="selected-topics-chips">
                    {formData.topics.map((t) => (
                      <span key={t} className="selected-topic-chip">
                        {t}
                        <button
                          type="button"
                          onClick={() => handleRemoveTopic(t)}
                          title="Remove topic"
                        >
                          ✕
                        </button>
                      </span>
                    ))}
                  </div>
                ) : (
                  <p className="subtle-hint">
                    No topics added yet. Type topics above or click &quot;Auto-Add Weak Topics&quot; to target past mistakes.
                  </p>
                )}
              </div>

              {/* STEP 3: DAILY STUDY TIME */}
              <div className="planner-form-section">
                <label className="form-label">3. Available Daily Study Time</label>
                <div className="duration-pills-row">
                  {[30, 45, 60, 90, 120].map((mins) => (
                    <button
                      key={mins}
                      type="button"
                      className={`config-pill ${formData.dailyMinutes === mins ? "active" : ""}`}
                      onClick={() => setFormData((p) => ({ ...p, dailyMinutes: mins }))}
                    >
                      ⏱ {mins} Mins / Day
                    </button>
                  ))}
                </div>
              </div>

              {/* STEP 4: PLAN DURATION */}
              <div className="planner-form-section">
                <label className="form-label">4. Plan Duration</label>
                <div className="duration-pills-row">
                  {[
                    { days: 7, label: "7-Day Sprint" },
                    { days: 14, label: "14-Day Deep Study" },
                    { days: 30, label: "30-Day Comprehensive" },
                  ].map((dur) => (
                    <button
                      key={dur.days}
                      type="button"
                      className={`config-pill ${formData.durationDays === dur.days ? "active" : ""}`}
                      onClick={() => setFormData((p) => ({ ...p, durationDays: dur.days }))}
                    >
                      📅 {dur.label}
                    </button>
                  ))}
                </div>
              </div>

              {/* STEP 5: OPTIONAL EXAM DATE & GOAL */}
              <div className="planner-form-section">
                <label className="form-label">5. Optional Milestones & Targets</label>
                <div className="two-col-fields">
                  <div className="field-group">
                    <label className="sub-label">Target Exam Date:</label>
                    <input
                      type="date"
                      value={formData.targetExamDate}
                      onChange={(e) => setFormData((p) => ({ ...p, targetExamDate: e.target.value }))}
                    />
                  </div>

                  <div className="field-group">
                    <label className="sub-label">Align with Learning Goal:</label>
                    <select
                      value={formData.goalId}
                      onChange={(e) => setFormData((p) => ({ ...p, goalId: e.target.value }))}
                    >
                      <option value="">-- No specific goal --</option>
                      {goals.map((g) => (
                        <option key={g.id} value={g.id}>
                          {g.title} ({g.target} {g.unit})
                        </option>
                      ))}
                    </select>
                  </div>
                </div>
              </div>

              {/* ADAPTIVE CONTEXT NOTICE */}
              <div className="planner-diagnostic-alert">
                <span className="notice-icon">💡</span>
                <div>
                  <strong>Pedagogical Grounding:</strong>
                  {assessmentWeaknesses.hasHistory ? (
                    <p>
                      Found {assessmentWeaknesses.totalAttemptsAnalyzed} previous assessment attempt(s). We will prioritize your verified mistakes ({assessmentWeaknesses.confirmedErrors.length} errors, {assessmentWeaknesses.misconceptions.length} misconceptions) in the early days of your plan.
                    </p>
                  ) : (
                    <p>
                      No previous test attempts recorded. Your curriculum will be generated logically from foundational principles to advanced application without inventing fake weaknesses.
                    </p>
                  )}
                </div>
              </div>
            </div>

            <div className="modal-actions-footer">
              <button
                type="button"
                className="secondary-btn"
                disabled={isGenerating}
                onClick={() => setIsCreateModalOpen(false)}
              >
                Cancel
              </button>
              <button
                type="button"
                className="primary-btn pulse-glow"
                disabled={isGenerating}
                onClick={handleGeneratePlan}
              >
                {isGenerating ? "Crafting Your Study Plan with AI..." : "Generate Personalized Plan ⚡"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* MODAL: RESCHEDULE TASK */}
      {reschedulingTask && (
        <div className="modal-overlay" onClick={() => setReschedulingTask(null)}>
          <div className="modal-content small-modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h3>Reschedule Task</h3>
              <button
                type="button"
                className="modal-close-btn"
                onClick={() => setReschedulingTask(null)}
              >
                ✕
              </button>
            </div>
            <form onSubmit={handleSaveReschedule} className="modal-body-form">
              <p>
                Rescheduling: <strong>{reschedulingTask.title}</strong>
              </p>
              <div className="field-group">
                <label>Select New Scheduled Date:</label>
                <input
                  type="date"
                  value={rescheduleDate}
                  onChange={(e) => setRescheduleDate(e.target.value)}
                  required
                />
              </div>

              <div className="quick-dates-row">
                <button
                  type="button"
                  className="chip-btn"
                  onClick={() => setRescheduleDate(todayStr)}
                >
                  Today
                </button>
                <button
                  type="button"
                  className="chip-btn"
                  onClick={() => {
                    const tomorrow = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString().split("T")[0];
                    setRescheduleDate(tomorrow);
                  }}
                >
                  Tomorrow
                </button>
                <button
                  type="button"
                  className="chip-btn"
                  onClick={() => {
                    const in2Days = new Date(Date.now() + 2 * 24 * 60 * 60 * 1000).toISOString().split("T")[0];
                    setRescheduleDate(in2Days);
                  }}
                >
                  +2 Days
                </button>
              </div>

              <div className="modal-actions-footer">
                <button
                  type="button"
                  className="secondary-btn"
                  onClick={() => setReschedulingTask(null)}
                >
                  Cancel
                </button>
                <button type="submit" className="primary-btn">
                  Save New Date
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* MODAL: ADD CUSTOM TASK */}
      {isAddTaskModalOpen && (
        <div className="modal-overlay" onClick={() => setIsAddTaskModalOpen(false)}>
          <div className="modal-content small-modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h3>Add Custom Study Task</h3>
              <button
                type="button"
                className="modal-close-btn"
                onClick={() => setIsAddTaskModalOpen(false)}
              >
                ✕
              </button>
            </div>
            <form onSubmit={handleCreateCustomTask} className="modal-body-form">
              <div className="field-group">
                <label>Task Title:</label>
                <input
                  type="text"
                  placeholder="e.g. Read Chapter 4 on Virtual Memory"
                  value={newTaskData.title}
                  onChange={(e) => setNewTaskData((p) => ({ ...p, title: e.target.value }))}
                  required
                />
              </div>

              <div className="field-group">
                <label>Topic:</label>
                <input
                  type="text"
                  placeholder="e.g. Paging Algorithms"
                  value={newTaskData.topic}
                  onChange={(e) => setNewTaskData((p) => ({ ...p, topic: e.target.value }))}
                />
              </div>

              <div className="two-col-fields">
                <div className="field-group">
                  <label>Type:</label>
                  <select
                    value={newTaskData.type}
                    onChange={(e) => setNewTaskData((p) => ({ ...p, type: e.target.value }))}
                  >
                    <option value="learn">📖 Learn</option>
                    <option value="revise">◷ Revise</option>
                    <option value="practice">⚡ Practice</option>
                    <option value="assessment">✎ Assessment</option>
                  </select>
                </div>

                <div className="field-group">
                  <label>Estimated Minutes:</label>
                  <input
                    type="number"
                    min={5}
                    max={180}
                    value={newTaskData.estimatedMinutes}
                    onChange={(e) => setNewTaskData((p) => ({ ...p, estimatedMinutes: e.target.value }))}
                  />
                </div>
              </div>

              <div className="two-col-fields">
                <div className="field-group">
                  <label>Priority:</label>
                  <select
                    value={newTaskData.priority}
                    onChange={(e) => setNewTaskData((p) => ({ ...p, priority: e.target.value }))}
                  >
                    <option value="High">High</option>
                    <option value="Medium">Medium</option>
                    <option value="Low">Low</option>
                  </select>
                </div>

                <div className="field-group">
                  <label>Scheduled Date:</label>
                  <input
                    type="date"
                    value={newTaskData.scheduledDate}
                    onChange={(e) => setNewTaskData((p) => ({ ...p, scheduledDate: e.target.value }))}
                  />
                </div>
              </div>

              <div className="field-group">
                <label>Description / Notes:</label>
                <textarea
                  rows={3}
                  placeholder="Actionable notes or specific exercises to complete..."
                  value={newTaskData.description}
                  onChange={(e) => setNewTaskData((p) => ({ ...p, description: e.target.value }))}
                />
              </div>

              <div className="modal-actions-footer">
                <button
                  type="button"
                  className="secondary-btn"
                  onClick={() => setIsAddTaskModalOpen(false)}
                >
                  Cancel
                </button>
                <button type="submit" className="primary-btn">
                  Add Task to Plan
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
