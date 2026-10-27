/**
 * StudyFlow.ai — Unified Persistent Storage Engine
 * Handles persistent client storage for Courses, Notes, Quizzes, Flashcards, Study Sessions, and Goals.
 * Dispatches sync events so all tabs update reactively.
 */

const STORAGE_KEYS = {
  COURSES: "studyflow_courses_v1",
  NOTES: "studyflow_notes_v1",
  QUIZZES: "studyflow_quizzes_v1",
  FLASHCARDS: "studyflow_flashcards_v1",
  SESSIONS: "studyflow_sessions_v1",
  GOALS: "studyflow_goals_v1",
  ACTIVITIES: "studyflow_activities_v1",
  MOCK_TESTS: "studyflow_mock_tests_v1",
  ACTIVE_MOCK_TEST: "studyflow_active_mock_v1",
  STUDY_PLANS: "studyflow_study_plans_v1",
  ACTIVE_STUDY_PLAN: "studyflow_active_plan_v1",
};

// Seed courses so new users have a clean starting point they can edit or delete
const DEFAULT_COURSES = [
  {
    id: "course-1",
    name: "Web Development",
    description: "Modern JavaScript, React components, and responsive layout architecture.",
    category: "Computer Science",
    color: "#7667f5",
    icon: "⌘",
    targetDate: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString().split("T")[0],
    createdAt: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString(),
    updatedAt: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString(),
  },
  {
    id: "course-2",
    name: "Data Structures",
    description: "Arrays, linked lists, trees, graphs, sorting, and algorithmic complexity.",
    category: "Computer Science",
    color: "#e9a34b",
    icon: "◇",
    targetDate: new Date(Date.now() + 45 * 24 * 60 * 60 * 1000).toISOString().split("T")[0],
    createdAt: new Date(Date.now() - 14 * 24 * 60 * 60 * 1000).toISOString(),
    updatedAt: new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString(),
  },
  {
    id: "course-3",
    name: "Mathematics",
    description: "Probability distributions, statistics, and discrete mathematical reasoning.",
    category: "Mathematics",
    color: "#39b89a",
    icon: "∑",
    targetDate: new Date(Date.now() + 60 * 24 * 60 * 60 * 1000).toISOString().split("T")[0],
    createdAt: new Date(Date.now() - 20 * 24 * 60 * 60 * 1000).toISOString(),
    updatedAt: new Date(Date.now() - 5 * 24 * 60 * 60 * 1000).toISOString(),
  },
];

const DEFAULT_GOALS = [
  {
    id: "goal-1",
    title: "Master Array & Search Algorithms",
    description: "Complete practice quizzes and study notes for Data Structures.",
    category: "quiz_score",
    target: 3,
    unit: "quizzes",
    courseId: "course-2",
    deadline: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString().split("T")[0],
    current: 0,
    status: "active",
    createdAt: new Date().toISOString(),
  },
  {
    id: "goal-2",
    title: "Log 60 Minutes of Active Revision",
    description: "Complete timed revision sessions this week.",
    category: "study_time",
    target: 60,
    unit: "minutes",
    courseId: null,
    deadline: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString().split("T")[0],
    current: 0,
    status: "active",
    createdAt: new Date().toISOString(),
  },
];

const DEFAULT_FLASHCARD_DECKS = [
  {
    id: "deck-cs-fundamentals",
    title: "Computer Science Core Concepts",
    courseId: "course-1",
    createdAt: new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString(),
    updatedAt: new Date(Date.now() - 1 * 24 * 60 * 60 * 1000).toISOString(),
    cards: [
      {
        id: "card-1",
        front: "What is the time complexity of searching in a balanced Binary Search Tree (BST)?",
        back: "O(log n) on average and in the balanced case. Each comparison halves the remaining search space.",
        status: "learning",
        intervalDays: 1,
        reviewCount: 1,
        nextReviewDate: new Date().toISOString().split("T")[0],
      },
      {
        id: "card-2",
        front: "Explain the difference between mutable and immutable data structures.",
        back: "Mutable objects can be modified after creation without changing their identity (e.g. JavaScript Arrays). Immutable objects cannot be changed once created (e.g. JavaScript Strings, React state).",
        status: "needs_practice",
        intervalDays: 1,
        reviewCount: 0,
        nextReviewDate: new Date().toISOString().split("T")[0],
      },
      {
        id: "card-3",
        front: "What is the purpose of the virtual DOM in React?",
        back: "The virtual DOM is an in-memory representation of the real DOM. React computes minimal differences (diffing) and performs batched updates to maximize rendering performance.",
        status: "mastered",
        intervalDays: 5,
        reviewCount: 3,
        nextReviewDate: new Date(Date.now() + 4 * 24 * 60 * 60 * 1000).toISOString().split("T")[0],
      },
    ],
  },
];

function triggerStorageEvent() {
  if (typeof window !== "undefined") {
    window.dispatchEvent(new Event("studyflow_storage_sync"));
  }
}

function getStoredItem(key, defaultValue) {
  if (typeof window === "undefined") return defaultValue;
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return defaultValue;
    return JSON.parse(raw);
  } catch (err) {
    console.error(`Failed to read storage key "${key}":`, err);
    return defaultValue;
  }
}

function setStoredItem(key, value) {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(key, JSON.stringify(value));
    triggerStorageEvent();
  } catch (err) {
    console.error(`Failed to write storage key "${key}":`, err);
  }
}

// ============================================
// COURSES API
// ============================================

export function getCourses() {
  const courses = getStoredItem(STORAGE_KEYS.COURSES, null);
  if (!courses) {
    setStoredItem(STORAGE_KEYS.COURSES, DEFAULT_COURSES);
    return DEFAULT_COURSES;
  }
  return courses;
}

export function saveCourse(courseData) {
  const courses = getCourses();
  const now = new Date().toISOString();

  if (courseData.id) {
    // Update existing course
    const index = courses.findIndex((c) => c.id === courseData.id);
    if (index >= 0) {
      courses[index] = {
        ...courses[index],
        ...courseData,
        updatedAt: now,
      };
      setStoredItem(STORAGE_KEYS.COURSES, courses);
      logActivity("course_updated", `Updated course "${courseData.name}"`, "My Courses");
      return courses[index];
    }
  }

  // Create new course
  const newCourse = {
    id: `course-${Date.now()}`,
    name: courseData.name || "Untitled Course",
    description: courseData.description || "",
    category: courseData.category || "General",
    color: courseData.color || "#7667f5",
    icon: courseData.icon || "⌘",
    targetDate: courseData.targetDate || null,
    createdAt: now,
    updatedAt: now,
  };

  courses.unshift(newCourse);
  setStoredItem(STORAGE_KEYS.COURSES, courses);
  logActivity("course_created", `Created course "${newCourse.name}"`, "My Courses");
  return newCourse;
}

export function deleteCourse(id) {
  const courses = getCourses();
  const course = courses.find((c) => c.id === id);
  const filtered = courses.filter((c) => c.id !== id);
  setStoredItem(STORAGE_KEYS.COURSES, filtered);

  if (course) {
    logActivity("course_deleted", `Deleted course "${course.name}"`, "My Courses");
  }
  return true;
}

export function getCourseById(id) {
  return getCourses().find((c) => c.id === id) || null;
}

// ============================================
// NOTES & SAVED STUDY MATERIALS API
// ============================================

export function getSavedNotes() {
  return getStoredItem(STORAGE_KEYS.NOTES, []);
}

export function saveStudyNote(noteData) {
  const notes = getSavedNotes();
  const now = new Date().toISOString();

  if (noteData.id) {
    const index = notes.findIndex((n) => n.id === noteData.id);
    if (index >= 0) {
      notes[index] = {
        ...notes[index],
        ...noteData,
        updatedAt: now,
      };
      setStoredItem(STORAGE_KEYS.NOTES, notes);
      logActivity("note_updated", `Updated study note "${notes[index].title || notes[index].fileName}"`, "My Notes");
      return notes[index];
    }
  }

  const newNote = {
    id: `note-${Date.now()}`,
    title: noteData.title || noteData.fileName || "Study Note",
    fileName: noteData.fileName || "Uploaded Material",
    pageCount: noteData.pageCount || 1,
    text: noteData.text || "",
    courseId: noteData.courseId || null,
    summary: noteData.summary || null,
    topics: noteData.topics || null,
    mcqs: noteData.mcqs || null,
    mcqCount: noteData.mcqCount || null,
    revision: noteData.revision || null,
    createdAt: now,
    updatedAt: now,
  };

  notes.unshift(newNote);
  setStoredItem(STORAGE_KEYS.NOTES, notes);
  logActivity("note_saved", `Saved study note "${newNote.title}"`, "My Notes");
  return newNote;
}

export function deleteStudyNote(id) {
  const notes = getSavedNotes();
  const note = notes.find((n) => n.id === id);
  const filtered = notes.filter((n) => n.id !== id);
  setStoredItem(STORAGE_KEYS.NOTES, filtered);

  if (note) {
    logActivity("note_deleted", `Deleted note "${note.title || note.fileName}"`, "My Notes");
  }
  return true;
}

export function getNoteById(id) {
  return getSavedNotes().find((n) => n.id === id) || null;
}

// ============================================
// QUIZ ATTEMPTS & PERFORMANCE API
// ============================================

export function getQuizAttempts() {
  return getStoredItem(STORAGE_KEYS.QUIZZES, []);
}

export function saveQuizAttempt(attemptData) {
  const attempts = getQuizAttempts();
  const now = new Date().toISOString();

  const newAttempt = {
    id: `quiz-${Date.now()}`,
    title: attemptData.title || "Practice Quiz",
    courseId: attemptData.courseId || null,
    noteId: attemptData.noteId || null,
    totalQuestions: attemptData.totalQuestions || 0,
    correctCount: attemptData.correctCount || 0,
    scorePercentage:
      attemptData.totalQuestions > 0
        ? Math.round((attemptData.correctCount / attemptData.totalQuestions) * 100)
        : 0,
    incorrectQuestions: attemptData.incorrectQuestions || [],
    createdAt: now,
  };

  attempts.unshift(newAttempt);
  setStoredItem(STORAGE_KEYS.QUIZZES, attempts);

  // Automatically log a 5-minute study session for taking the quiz
  logStudySession({
    type: "quiz",
    durationMinutes: 5,
    courseId: newAttempt.courseId,
    noteId: newAttempt.noteId,
    title: `Completed quiz: ${newAttempt.title} (${newAttempt.correctCount}/${newAttempt.totalQuestions})`,
  });

  logActivity(
    "quiz_completed",
    `Completed quiz "${newAttempt.title}" with score ${newAttempt.scorePercentage}%`,
    "Analytics"
  );

  // Check and update quiz goals
  updateQuizGoalsProgress();

  return newAttempt;
}

// ============================================
// MOCK TESTS & ASSESSMENT API
// ============================================

export function getMockTests() {
  return getStoredItem(STORAGE_KEYS.MOCK_TESTS, []);
}

export function saveMockTest(testData) {
  const tests = getMockTests();
  const now = new Date().toISOString();

  if (testData.id) {
    const index = tests.findIndex((t) => t.id === testData.id);
    if (index >= 0) {
      tests[index] = {
        ...tests[index],
        ...testData,
        updatedAt: now,
      };
      setStoredItem(STORAGE_KEYS.MOCK_TESTS, tests);
      return tests[index];
    }
  }

  const newTest = {
    id: `mock-test-${Date.now()}`,
    title: testData.title || "Custom Mock Examination",
    sourceType: testData.sourceType || "topic", // "pdf" | "notes" | "course" | "topic"
    sourceName: testData.sourceName || "General Topic",
    sourceText: testData.sourceText || "",
    courseId: testData.courseId || null,
    noteId: testData.noteId || null,
    difficulty: testData.difficulty || "Medium", // "Easy" | "Medium" | "Hard" | "Mixed"
    durationMinutes: parseInt(testData.durationMinutes, 10) || 30,
    questionCount: parseInt(testData.questionCount, 10) || 10,
    format: testData.format || "mixed", // "mcq" | "short" | "long" | "mixed"
    distribution: testData.distribution || { mcq: 5, short: 3, long: 2 },
    customMarks: testData.customMarks || { mcq: 2, short: 4, long: 8 },
    questions: testData.questions || [],
    totalMarks: testData.totalMarks || (testData.questions || []).reduce((sum, q) => sum + (q.marks || 0), 0),
    attempts: testData.attempts || [],
    createdAt: now,
    updatedAt: now,
  };

  tests.unshift(newTest);
  setStoredItem(STORAGE_KEYS.MOCK_TESTS, tests);
  logActivity("mock_test_created", `Created Mock Test "${newTest.title}" (${newTest.questionCount} questions, ${newTest.totalMarks} marks)`, "Mock Tests");
  return newTest;
}

export function deleteMockTest(id) {
  const tests = getMockTests();
  const test = tests.find((t) => t.id === id);
  const filtered = tests.filter((t) => t.id !== id);
  setStoredItem(STORAGE_KEYS.MOCK_TESTS, filtered);

  // If this test was active, clear active attempt
  const active = getActiveMockTest();
  if (active && active.testId === id) {
    clearActiveMockTest();
  }

  if (test) {
    logActivity("mock_test_deleted", `Deleted Mock Test "${test.title}"`, "Mock Tests");
  }
  return true;
}

export function getMockTestById(id) {
  return getMockTests().find((t) => t.id === id) || null;
}

export function saveMockTestAttempt(testId, attemptData) {
  const tests = getMockTests();
  const testIndex = tests.findIndex((t) => t.id === testId);
  if (testIndex < 0) return null;

  const test = tests[testIndex];
  const now = new Date().toISOString();

  // Create unique attempt record
  const newAttempt = {
    id: `attempt-${Date.now()}-${Math.random().toString(36).substr(2, 4)}`,
    testId,
    startedAt: attemptData.startedAt || now,
    submittedAt: now,
    timeTakenSeconds: attemptData.timeTakenSeconds || 0,
    userAnswers: attemptData.userAnswers || {},
    markedForReview: attemptData.markedForReview || [],
    evaluations: attemptData.evaluations || {}, // { [qId]: { marksAwarded, maxMarks, strengths, missingConcepts, mistakes, feedback } }
    mcqScore: attemptData.mcqScore || 0,
    mcqTotal: attemptData.mcqTotal || 0,
    writtenScore: attemptData.writtenScore || 0,
    writtenTotal: attemptData.writtenTotal || 0,
    score: attemptData.score || 0,
    totalMarks: attemptData.totalMarks || test.totalMarks || 0,
    percentage:
      (attemptData.totalMarks || test.totalMarks) > 0
        ? Math.round((attemptData.score / (attemptData.totalMarks || test.totalMarks)) * 100)
        : 0,
    evaluationStatus: attemptData.evaluationStatus || "completed", // "completed" | "pending" | "failed"
    evaluationError: attemptData.evaluationError || null,
    createdAt: now,
  };

  test.attempts = test.attempts || [];
  test.attempts.unshift(newAttempt);
  test.updatedAt = now;

  tests[testIndex] = test;
  setStoredItem(STORAGE_KEYS.MOCK_TESTS, tests);

  // Clear active attempt state if it matched this test
  clearActiveMockTest();

  // Automatically log a study session for taking the test
  const durationMinutes = Math.max(1, Math.round((newAttempt.timeTakenSeconds || 60) / 60));
  logStudySession({
    type: "mock_test",
    durationMinutes,
    courseId: test.courseId,
    noteId: test.noteId,
    title: `Completed Mock Test: ${test.title} (${newAttempt.score}/${newAttempt.totalMarks} marks · ${newAttempt.percentage}%)`,
  });

  logActivity(
    "mock_test_completed",
    `Completed Mock Test "${test.title}" — Score: ${newAttempt.score}/${newAttempt.totalMarks} (${newAttempt.percentage}%)`,
    "Mock Tests"
  );

  // Update goals progress
  updateMockTestGoalsProgress();

  return newAttempt;
}

export function updateMockTestAttempt(testId, attemptId, patchData) {
  const tests = getMockTests();
  const testIndex = tests.findIndex((t) => t.id === testId);
  if (testIndex < 0) return null;

  const test = tests[testIndex];
  test.attempts = test.attempts || [];
  const attemptIndex = test.attempts.findIndex((a) => a.id === attemptId);
  if (attemptIndex < 0) return null;

  test.attempts[attemptIndex] = {
    ...test.attempts[attemptIndex],
    ...patchData,
    updatedAt: new Date().toISOString(),
  };

  tests[testIndex] = test;
  setStoredItem(STORAGE_KEYS.MOCK_TESTS, tests);
  return test.attempts[attemptIndex];
}

// In-progress test recovery & autosave
export function getActiveMockTest() {
  return getStoredItem(STORAGE_KEYS.ACTIVE_MOCK_TEST, null);
}

export function saveActiveMockTest(state) {
  setStoredItem(STORAGE_KEYS.ACTIVE_MOCK_TEST, state);
}

export function clearActiveMockTest() {
  if (typeof window !== "undefined") {
    try {
      localStorage.removeItem(STORAGE_KEYS.ACTIVE_MOCK_TEST);
      triggerStorageEvent();
    } catch (e) {
      console.error("Failed to clear active mock test:", e);
    }
  }
}

// Aggregated real metrics for mock tests
export function getMockTestMetrics() {
  const tests = getMockTests();
  let totalAttempts = 0;
  let totalScoreSum = 0;
  let bestScorePercentage = 0;
  let totalMarksEarned = 0;
  let totalPossibleMarks = 0;
  let totalMCQMarksEarned = 0;
  let totalMCQMarksPossible = 0;
  let totalWrittenMarksEarned = 0;
  let totalWrittenMarksPossible = 0;
  const allAttempts = [];

  tests.forEach((test) => {
    (test.attempts || []).forEach((attempt) => {
      totalAttempts++;
      totalScoreSum += attempt.percentage || 0;
      if (attempt.percentage > bestScorePercentage) {
        bestScorePercentage = attempt.percentage;
      }
      totalMarksEarned += attempt.score || 0;
      totalPossibleMarks += attempt.totalMarks || 0;
      totalMCQMarksEarned += attempt.mcqScore || 0;
      totalMCQMarksPossible += attempt.mcqTotal || 0;
      totalWrittenMarksEarned += attempt.writtenScore || 0;
      totalWrittenMarksPossible += attempt.writtenTotal || 0;

      allAttempts.push({
        ...attempt,
        testTitle: test.title,
        courseId: test.courseId,
        difficulty: test.difficulty,
        format: test.format,
      });
    });
  });

  allAttempts.sort((a, b) => new Date(b.createdAt || b.submittedAt).getTime() - new Date(a.createdAt || a.submittedAt).getTime());

  const avgScorePercentage = totalAttempts > 0 ? Math.round(totalScoreSum / totalAttempts) : null;
  const mcqAccuracy = totalMCQMarksPossible > 0 ? Math.round((totalMCQMarksEarned / totalMCQMarksPossible) * 100) : null;
  const writtenAccuracy = totalWrittenMarksPossible > 0 ? Math.round((totalWrittenMarksEarned / totalWrittenMarksPossible) * 100) : null;

  return {
    totalTestsCreated: tests.length,
    totalAttempts,
    avgScorePercentage,
    bestScorePercentage: totalAttempts > 0 ? bestScorePercentage : null,
    totalMarksEarned,
    totalPossibleMarks,
    mcqAccuracy,
    writtenAccuracy,
    recentAttempts: allAttempts.slice(0, 10),
  };
}

// ============================================
// PERSONALIZED STUDY PLANNER & MISTAKE DIAGNOSTICS API
// ============================================

export function getStudyPlans() {
  return getStoredItem(STORAGE_KEYS.STUDY_PLANS, []);
}

export function saveStudyPlan(planData) {
  const plans = getStudyPlans();
  const now = new Date().toISOString();

  if (planData.id) {
    const index = plans.findIndex((p) => p.id === planData.id);
    if (index >= 0) {
      plans[index] = {
        ...plans[index],
        ...planData,
        updatedAt: now,
      };
      setStoredItem(STORAGE_KEYS.STUDY_PLANS, plans);
      return plans[index];
    }
  }

  const newPlan = {
    id: `plan-${Date.now()}`,
    title: planData.title || `${planData.subject || "Study"} Plan`,
    subject: planData.subject || "General Study",
    courseId: planData.courseId || null,
    topics: planData.topics || [],
    dailyMinutes: parseInt(planData.dailyMinutes, 10) || 60,
    durationDays: parseInt(planData.durationDays, 10) || 14,
    targetExamDate: planData.targetExamDate || null,
    goalId: planData.goalId || null,
    tasks: planData.tasks || [],
    personalizationContext: planData.personalizationContext || null,
    createdAt: now,
    updatedAt: now,
  };

  plans.unshift(newPlan);
  setStoredItem(STORAGE_KEYS.STUDY_PLANS, plans);
  setActiveStudyPlanId(newPlan.id);
  logActivity("study_plan_created", `Created personalized study plan "${newPlan.title}" (${newPlan.durationDays} days)`, "Study Planner");
  return newPlan;
}

export function deleteStudyPlan(id) {
  const plans = getStudyPlans();
  const plan = plans.find((p) => p.id === id);
  const filtered = plans.filter((p) => p.id !== id);
  setStoredItem(STORAGE_KEYS.STUDY_PLANS, filtered);

  const activeId = getActiveStudyPlanId();
  if (activeId === id) {
    setActiveStudyPlanId(filtered.length > 0 ? filtered[0].id : null);
  }

  if (plan) {
    logActivity("study_plan_deleted", `Deleted study plan "${plan.title}"`, "Study Planner");
  }
  return true;
}

export function getStudyPlanById(id) {
  return getStudyPlans().find((p) => p.id === id) || null;
}

export function getActiveStudyPlanId() {
  return getStoredItem(STORAGE_KEYS.ACTIVE_STUDY_PLAN, null);
}

export function setActiveStudyPlanId(id) {
  setStoredItem(STORAGE_KEYS.ACTIVE_STUDY_PLAN, id);
}

export function getActiveStudyPlan() {
  const plans = getStudyPlans();
  if (plans.length === 0) return null;
  const activeId = getActiveStudyPlanId();
  if (activeId) {
    const found = plans.find((p) => p.id === activeId);
    if (found) return found;
  }
  return plans[0];
}

export function toggleStudyPlanTask(planId, taskId) {
  const plans = getStudyPlans();
  const planIndex = plans.findIndex((p) => p.id === planId);
  if (planIndex < 0) return null;

  const plan = plans[planIndex];
  const task = (plan.tasks || []).find((t) => t.id === taskId);
  if (!task) return null;

  task.completed = !task.completed;
  task.completedAt = task.completed ? new Date().toISOString() : null;
  plan.updatedAt = new Date().toISOString();

  plans[planIndex] = plan;
  setStoredItem(STORAGE_KEYS.STUDY_PLANS, plans);

  if (task.completed) {
    // Automatically record a study session for completing this planned task
    logStudySession({
      type: "planner",
      durationMinutes: Math.max(5, task.estimatedMinutes || 20),
      courseId: plan.courseId,
      title: `Completed Task: ${task.title} (${task.topic})`,
    });

    logActivity(
      "task_completed",
      `Completed study task "${task.title}" (${task.estimatedMinutes || 20}m)`,
      "Study Planner"
    );
  }

  return task;
}

export function rescheduleStudyPlanTask(planId, taskId, newDate) {
  const plans = getStudyPlans();
  const planIndex = plans.findIndex((p) => p.id === planId);
  if (planIndex < 0) return null;

  const plan = plans[planIndex];
  const task = (plan.tasks || []).find((t) => t.id === taskId);
  if (!task) return null;

  task.scheduledDate = newDate;
  plan.updatedAt = new Date().toISOString();

  plans[planIndex] = plan;
  setStoredItem(STORAGE_KEYS.STUDY_PLANS, plans);
  return task;
}

export function addCustomStudyPlanTask(planId, taskData) {
  const plans = getStudyPlans();
  const planIndex = plans.findIndex((p) => p.id === planId);
  if (planIndex < 0) return null;

  const plan = plans[planIndex];
  const newTask = {
    id: `task-${Date.now()}-${Math.random().toString(36).substr(2, 4)}`,
    dayNumber: taskData.dayNumber || 1,
    scheduledDate: taskData.scheduledDate || new Date().toISOString().split("T")[0],
    title: taskData.title || "Custom Study Task",
    topic: taskData.topic || plan.subject || "General",
    description: taskData.description || "",
    type: taskData.type || "practice",
    estimatedMinutes: parseInt(taskData.estimatedMinutes, 10) || 20,
    priority: taskData.priority || "Medium",
    completed: false,
    completedAt: null,
    linkedNoteId: taskData.linkedNoteId || null,
    linkedCourseId: taskData.linkedCourseId || plan.courseId || null,
  };

  plan.tasks = plan.tasks || [];
  plan.tasks.push(newTask);
  plan.updatedAt = new Date().toISOString();

  plans[planIndex] = plan;
  setStoredItem(STORAGE_KEYS.STUDY_PLANS, plans);
  return newTask;
}

export function deleteStudyPlanTask(planId, taskId) {
  const plans = getStudyPlans();
  const planIndex = plans.findIndex((p) => p.id === planId);
  if (planIndex < 0) return false;

  const plan = plans[planIndex];
  plan.tasks = (plan.tasks || []).filter((t) => t.id !== taskId);
  plan.updatedAt = new Date().toISOString();

  plans[planIndex] = plan;
  setStoredItem(STORAGE_KEYS.STUDY_PLANS, plans);
  return true;
}

export function getStudyPlannerMetrics() {
  const plans = getStudyPlans();
  const activePlan = getActiveStudyPlan();
  const todayStr = new Date().toISOString().split("T")[0];

  let todayTasks = [];
  let todayCompleted = 0;
  let totalTasks = 0;
  let completedTasks = 0;

  if (activePlan && Array.isArray(activePlan.tasks)) {
    totalTasks = activePlan.tasks.length;
    completedTasks = activePlan.tasks.filter((t) => t.completed).length;

    todayTasks = activePlan.tasks.filter((t) => t.scheduledDate === todayStr);
    todayCompleted = todayTasks.filter((t) => t.completed).length;
  }

  const completionPercentage = totalTasks > 0 ? Math.round((completedTasks / totalTasks) * 100) : 0;

  return {
    totalPlans: plans.length,
    activePlan,
    todayTasks,
    todayCompleted,
    todayTotal: todayTasks.length,
    totalTasks,
    completedTasks,
    completionPercentage,
  };
}

/**
 * Extracts real assessment weaknesses, mistakes, and recurring errors from past mock tests and quizzes.
 * Strictly uses actual data; does NOT invent fake learning weaknesses if data is absent.
 */
export function extractAssessmentWeaknesses(courseId = null) {
  const mockTests = getMockTests();
  const quizzes = getQuizAttempts();

  const relevantTests = courseId
    ? mockTests.filter((t) => t.courseId === courseId)
    : mockTests;

  const relevantQuizzes = courseId
    ? quizzes.filter((q) => q.courseId === courseId)
    : quizzes;

  const weakTopicsCount = {};
  const confirmedErrors = [];
  const misconceptions = [];
  const incompleteExpl = [];
  const questionMistakeOccurrences = {}; // for detecting recurring mistakes across attempts
  const allAttempts = [];

  // Analyze mock tests
  relevantTests.forEach((test) => {
    const attempts = test.attempts || [];
    attempts.forEach((att) => {
      allAttempts.push({ ...att, testTitle: test.title, courseId: test.courseId });
      const evs = att.evaluations || {};

      (test.questions || []).forEach((q) => {
        const ev = evs[q.id];
        if (!ev) return;

        const maxMarks = q.marks || 1;
        const marksAwarded = Number(ev.marksAwarded) || 0;
        const studentAnswer = att.userAnswers?.[q.id] || "";

        // Track topic weakness if marks were lost
        if (marksAwarded < maxMarks) {
          const topicName = q.topic || test.sourceName || test.title;
          weakTopicsCount[topicName] = (weakTopicsCount[topicName] || 0) + (maxMarks - marksAwarded);

          // Track question mistake occurrences for recurring detection
          const qKey = q.question.trim().toLowerCase();
          questionMistakeOccurrences[qKey] = (questionMistakeOccurrences[qKey] || 0) + 1;

          // Categorize error type
          if (q.type === "mcq") {
            confirmedErrors.push({
              source: `${test.title} (Mock Test)`,
              question: q.question,
              studentAnswer: studentAnswer ? `Selected Option (${studentAnswer})` : "Left Blank",
              correctAnswer: `Option (${q.correctOption}): ${q.explanation || ""}`,
              feedback: ev.feedback || q.explanation,
              category: "confirmed_error",
              topic: topicName,
              date: att.createdAt || att.submittedAt,
              recommendation: `Revise concept: ${q.question.slice(0, 60)}... Review explanation: ${q.explanation || ""}`,
            });
          } else {
            // Written questions: examine if misunderstanding or incomplete
            const hasMistakes = Array.isArray(ev.mistakes) && ev.mistakes.length > 0;
            const hasMissing = Array.isArray(ev.missingConcepts) && ev.missingConcepts.length > 0;

            if (hasMistakes) {
              misconceptions.push({
                source: `${test.title} (Mock Test)`,
                question: q.question,
                studentAnswer: studentAnswer || "No answer submitted",
                correctAnswer: q.referenceAnswer,
                feedback: ev.feedback,
                mistakes: ev.mistakes,
                category: "underlying_misconception",
                topic: topicName,
                date: att.createdAt || att.submittedAt,
                recommendation: `Clarify conceptual distinction: ${ev.mistakes.join("; ")}`,
              });
            } else if (hasMissing || marksAwarded > 0) {
              incompleteExpl.push({
                source: `${test.title} (Mock Test)`,
                question: q.question,
                studentAnswer: studentAnswer,
                correctAnswer: q.referenceAnswer,
                feedback: ev.feedback,
                missingConcepts: ev.missingConcepts || [],
                category: "incomplete_explanation",
                topic: topicName,
                date: att.createdAt || att.submittedAt,
                recommendation: `Practice complete explanations including: ${(ev.missingConcepts || []).join(", ")}`,
              });
            } else {
              confirmedErrors.push({
                source: `${test.title} (Mock Test)`,
                question: q.question,
                studentAnswer: studentAnswer || "No answer submitted",
                correctAnswer: q.referenceAnswer,
                feedback: ev.feedback,
                category: "confirmed_error",
                topic: topicName,
                date: att.createdAt || att.submittedAt,
                recommendation: `Study model answer: ${q.referenceAnswer.slice(0, 100)}...`,
              });
            }
          }
        }
      });
    });
  });

  // Analyze practice quizzes
  relevantQuizzes.forEach((quiz) => {
    (quiz.incorrectQuestions || []).forEach((m) => {
      const topicName = quiz.title || "Practice Quiz";
      weakTopicsCount[topicName] = (weakTopicsCount[topicName] || 0) + 1;

      const qKey = (m.question || "").trim().toLowerCase();
      if (qKey) {
        questionMistakeOccurrences[qKey] = (questionMistakeOccurrences[qKey] || 0) + 1;
      }

      confirmedErrors.push({
        source: `${quiz.title} (Quiz)`,
        question: m.question,
        studentAnswer: m.selectedOption ? `Selected (${m.selectedOption})` : "Wrong choice",
        correctAnswer: m.correctAnswerText || m.correctOption,
        feedback: m.explanation || "Review correct answer.",
        category: "confirmed_error",
        topic: topicName,
        date: quiz.createdAt,
        recommendation: `Review quiz answer: ${m.correctAnswerText || m.explanation || ""}`,
      });
    });
  });

  // Identify recurring mistakes (mistakes appearing 2+ times across attempts or tests)
  const recurringMistakes = Object.keys(questionMistakeOccurrences)
    .filter((qKey) => questionMistakeOccurrences[qKey] > 1)
    .map((qKey) => {
      const found = confirmedErrors.find((e) => e.question.trim().toLowerCase() === qKey) ||
                    misconceptions.find((m) => m.question.trim().toLowerCase() === qKey);
      return {
        question: found ? found.question : qKey,
        occurrences: questionMistakeOccurrences[qKey],
        topic: found ? found.topic : "Core Concept",
        recommendation: `Priority revision required: missed in ${questionMistakeOccurrences[qKey]} separate attempts. Focus on core mechanism before retesting.`,
      };
    });

  // Rank weak topics by lost marks
  const sortedWeakTopics = Object.keys(weakTopicsCount)
    .sort((a, b) => weakTopicsCount[b] - weakTopicsCount[a]);

  return {
    hasHistory: allAttempts.length > 0 || relevantQuizzes.length > 0,
    totalAttemptsAnalyzed: allAttempts.length + relevantQuizzes.length,
    weakTopics: sortedWeakTopics,
    confirmedErrors,
    misconceptions,
    incompleteExpl,
    recurringMistakes,
  };
}

/**
 * Detailed diagnostic breakdown for a single mock test attempt.
 * Evaluates confirmed errors, underlying misconceptions, incomplete explanations,
 * formula/method issues, and cross-references user history to flag recurring mistakes.
 */
export function analyzeSingleMockTestAttempt(test, currentAttempt) {
  if (!test || !currentAttempt) return null;

  const mockTests = getMockTests();
  const questions = test.questions || [];
  const evaluations = currentAttempt.evaluations || {};
  const userAnswers = currentAttempt.userAnswers || {};

  // Build index of other attempts across the user's test history to detect recurring mistakes
  const previousMissedQuestionCounts = {};
  mockTests.forEach((otherTest) => {
    (otherTest.attempts || []).forEach((att) => {
      // Don't count current attempt in previous history
      if (att.id === currentAttempt.id) return;
      const otherEvs = att.evaluations || {};
      (otherTest.questions || []).forEach((oq) => {
        const oev = otherEvs[oq.id];
        if (oev && (Number(oev.marksAwarded) || 0) < (oq.marks || 1)) {
          const key = oq.question.trim().toLowerCase();
          previousMissedQuestionCounts[key] = (previousMissedQuestionCounts[key] || 0) + 1;
        }
      });
    });
  });

  const confirmedErrors = [];
  const misconceptions = [];
  const incompleteExplanations = [];
  const formulaMethodIssues = [];
  const recurringMistakes = [];
  const weakTopicsMap = {};
  const strengths = [];

  questions.forEach((q) => {
    const ev = evaluations[q.id];
    if (!ev) return;

    const maxMarks = q.marks || 1;
    const marksAwarded = Number(ev.marksAwarded) || 0;
    const studentAnswer = userAnswers[q.id] || "";
    const topic = q.topic || test.sourceName || test.title;
    const qKey = q.question.trim().toLowerCase();
    const isRecurring = (previousMissedQuestionCounts[qKey] || 0) > 0;
    const totalPreviousFails = previousMissedQuestionCounts[qKey] || 0;

    if (marksAwarded >= maxMarks * 0.85) {
      strengths.push({
        questionId: q.id,
        question: q.question,
        topic,
        marksAwarded,
        maxMarks,
        feedback: ev.feedback || "Solid conceptual understanding demonstrated.",
        strengths: ev.strengths || [],
      });
      return;
    }

    // Lost marks -> track topic
    const lostMarks = maxMarks - marksAwarded;
    weakTopicsMap[topic] = (weakTopicsMap[topic] || 0) + lostMarks;

    const baseIssue = {
      questionId: q.id,
      question: q.question,
      type: q.type,
      topic,
      studentAnswer,
      referenceAnswer: q.referenceAnswer || (q.options ? `Option ${q.correctOption}: ${q.explanation || ""}` : ""),
      correctOption: q.correctOption,
      marksAwarded,
      maxMarks,
      lostMarks,
      feedback: ev.feedback || q.explanation || "Review model explanation.",
      isRecurring,
      previousOccurrences: totalPreviousFails,
    };

    if (isRecurring) {
      recurringMistakes.push({
        ...baseIssue,
        recurringReason: `Missed in this attempt and ${totalPreviousFails} previous attempt(s). Highly critical concept requiring fundamental revision.`,
      });
    }

    if (q.type === "mcq") {
      confirmedErrors.push({
        ...baseIssue,
        category: "confirmed_error",
        explanation: q.explanation || "The selected alternative contradicts key principles.",
        recommendation: `Revise definition and properties of "${topic}". Review: ${q.explanation || ""}`,
      });
    } else {
      // Written answers
      const mistakes = Array.isArray(ev.mistakes) ? ev.mistakes : [];
      const missing = Array.isArray(ev.missingConcepts) ? ev.missingConcepts : [];

      // Check for formula / method application issues
      const textToCheck = `${ev.feedback || ""} ${mistakes.join(" ")}`.toLowerCase();
      const isFormulaOrMethod =
        textToCheck.includes("formula") ||
        textToCheck.includes("calculation") ||
        textToCheck.includes("method") ||
        textToCheck.includes("equation") ||
        textToCheck.includes("step");

      if (isFormulaOrMethod && mistakes.length > 0) {
        formulaMethodIssues.push({
          ...baseIssue,
          category: "formula_method_issue",
          mistakes,
          missingConcepts: missing,
          recommendation: `Check procedural steps: ${mistakes.join("; ")}. Re-derive solution using standard formula.`,
        });
      } else if (mistakes.length > 0) {
        misconceptions.push({
          ...baseIssue,
          category: "underlying_misconception",
          mistakes,
          missingConcepts: missing,
          recommendation: `Clarify conceptual distinction: ${mistakes.join("; ")}. Study why the model answer approaches it differently.`,
        });
      } else if (missing.length > 0 || marksAwarded > 0) {
        incompleteExplanations.push({
          ...baseIssue,
          category: "incomplete_explanation",
          missingConcepts: missing,
          recommendation: `Ensure you state all necessary criteria. You missed: ${missing.join(", ")}.`,
        });
      } else {
        confirmedErrors.push({
          ...baseIssue,
          category: "confirmed_error",
          recommendation: studentAnswer.trim()
            ? `Your response did not satisfy the question criteria. Review model answer: ${(q.referenceAnswer || "").slice(0, 90)}...`
            : "Left unattempted. Review foundational theory and practice writing concise answers.",
        });
      }
    }
  });

  const rankedWeakTopics = Object.keys(weakTopicsMap).sort(
    (a, b) => weakTopicsMap[b] - weakTopicsMap[a]
  );

  return {
    testId: test.id,
    attemptId: currentAttempt.id,
    testTitle: test.title,
    scorePercentage: currentAttempt.percentage || 0,
    totalQuestions: questions.length,
    totalErrors: confirmedErrors.length + misconceptions.length + incompleteExplanations.length + formulaMethodIssues.length,
    confirmedErrors,
    misconceptions,
    incompleteExplanations,
    formulaMethodIssues,
    recurringMistakes,
    weakTopics: rankedWeakTopics,
    strengths,
  };
}


// ============================================
// FLASHCARDS & SPACED REPETITION API
// ============================================

export function getFlashcardDecks() {
  return getStoredItem(STORAGE_KEYS.FLASHCARDS, DEFAULT_FLASHCARD_DECKS);
}

export function saveFlashcardDeck(deckData) {
  const decks = getFlashcardDecks();
  const now = new Date().toISOString();

  if (deckData.id) {
    const index = decks.findIndex((d) => d.id === deckData.id);
    if (index >= 0) {
      decks[index] = { ...decks[index], ...deckData, updatedAt: now };
      setStoredItem(STORAGE_KEYS.FLASHCARDS, decks);
      return decks[index];
    }
  }

  const newDeck = {
    id: `deck-${Date.now()}`,
    title: deckData.title || "Flashcard Deck",
    courseId: deckData.courseId || null,
    noteId: deckData.noteId || null,
    cards: deckData.cards || [],
    createdAt: now,
    updatedAt: now,
  };

  decks.unshift(newDeck);
  setStoredItem(STORAGE_KEYS.FLASHCARDS, decks);
  logActivity("flashcard_created", `Created flashcard deck "${newDeck.title}" (${newDeck.cards.length} cards)`, "Revision");
  return newDeck;
}

export function updateFlashcardReview(deckId, cardId, rating) {
  const decks = getFlashcardDecks();
  const deck = decks.find((d) => d.id === deckId);
  if (!deck) return null;

  const card = deck.cards.find((c) => c.id === cardId);
  if (!card) return null;

  const now = new Date();
  let intervalDays = card.intervalDays || 1;

  if (rating === "easy") {
    intervalDays = Math.max(3, Math.round(intervalDays * 2.5));
    card.status = "mastered";
  } else if (rating === "medium") {
    intervalDays = Math.max(1, Math.round(intervalDays * 1.5));
    card.status = "learning";
  } else {
    // Hard / Needs practice
    intervalDays = 1;
    card.status = "needs_practice";
  }

  const nextReview = new Date(now.getTime() + intervalDays * 24 * 60 * 60 * 1000);
  card.lastReviewed = now.toISOString();
  card.nextReviewDate = nextReview.toISOString().split("T")[0];
  card.intervalDays = intervalDays;
  card.reviewCount = (card.reviewCount || 0) + 1;
  card.lastRating = rating;

  deck.updatedAt = now.toISOString();
  setStoredItem(STORAGE_KEYS.FLASHCARDS, decks);
  return card;
}

// ============================================
// STUDY SESSIONS & TIME TRACKING API
// ============================================

export function getStudySessions() {
  return getStoredItem(STORAGE_KEYS.SESSIONS, []);
}

export function logStudySession(sessionData) {
  const sessions = getStudySessions();
  const now = new Date().toISOString();

  const newSession = {
    id: `session-${Date.now()}`,
    type: sessionData.type || "notes",
    durationMinutes: Math.max(1, parseInt(sessionData.durationMinutes, 10) || 5),
    courseId: sessionData.courseId || null,
    noteId: sessionData.noteId || null,
    title: sessionData.title || "Study Session",
    timestamp: now,
  };

  sessions.unshift(newSession);
  setStoredItem(STORAGE_KEYS.SESSIONS, sessions);

  // Update study time goals
  updateStudyTimeGoalsProgress();

  return newSession;
}

// ============================================
// GOALS API
// ============================================

export function getGoals() {
  const goals = getStoredItem(STORAGE_KEYS.GOALS, null);
  if (!goals) {
    setStoredItem(STORAGE_KEYS.GOALS, DEFAULT_GOALS);
    return DEFAULT_GOALS;
  }
  return goals;
}

export function saveGoal(goalData) {
  const goals = getGoals();
  const now = new Date().toISOString();

  if (goalData.id) {
    const index = goals.findIndex((g) => g.id === goalData.id);
    if (index >= 0) {
      goals[index] = {
        ...goals[index],
        ...goalData,
        updatedAt: now,
      };
      setStoredItem(STORAGE_KEYS.GOALS, goals);
      logActivity("goal_updated", `Updated goal "${goals[index].title}"`, "My Goals");
      return goals[index];
    }
  }

  const newGoal = {
    id: `goal-${Date.now()}`,
    title: goalData.title || "Study Goal",
    description: goalData.description || "",
    category: goalData.category || "study_time",
    target: parseInt(goalData.target, 10) || 1,
    unit: goalData.unit || "minutes",
    courseId: goalData.courseId || null,
    deadline: goalData.deadline || null,
    current: 0,
    status: "active",
    createdAt: now,
  };

  goals.unshift(newGoal);
  setStoredItem(STORAGE_KEYS.GOALS, goals);
  logActivity("goal_created", `Created goal "${newGoal.title}"`, "My Goals");
  return newGoal;
}

export function toggleGoalStatus(id) {
  const goals = getGoals();
  const goal = goals.find((g) => g.id === id);
  if (!goal) return null;

  goal.status = goal.status === "completed" ? "active" : "completed";
  goal.completedAt = goal.status === "completed" ? new Date().toISOString() : null;
  if (goal.status === "completed") {
    goal.current = goal.target;
    logActivity("goal_completed", `🎉 Completed goal "${goal.title}"!`, "My Goals");
  }

  setStoredItem(STORAGE_KEYS.GOALS, goals);
  return goal;
}

export function deleteGoal(id) {
  const goals = getGoals();
  const goal = goals.find((g) => g.id === id);
  const filtered = goals.filter((g) => g.id !== id);
  setStoredItem(STORAGE_KEYS.GOALS, filtered);

  if (goal) {
    logActivity("goal_deleted", `Deleted goal "${goal.title}"`, "My Goals");
  }
  return true;
}

function updateStudyTimeGoalsProgress() {
  const goals = getGoals();
  const sessions = getStudySessions();
  const totalMinutes = sessions.reduce((sum, s) => sum + (s.durationMinutes || 0), 0);

  let updated = false;
  goals.forEach((g) => {
    if (g.category === "study_time" && g.status !== "completed") {
      let currentMinutes = totalMinutes;
      if (g.courseId) {
        currentMinutes = sessions
          .filter((s) => s.courseId === g.courseId)
          .reduce((sum, s) => sum + (s.durationMinutes || 0), 0);
      }
      g.current = Math.min(currentMinutes, g.target);
      if (g.current >= g.target) {
        g.status = "completed";
        g.completedAt = new Date().toISOString();
      }
      updated = true;
    }
  });

  if (updated) {
    setStoredItem(STORAGE_KEYS.GOALS, goals);
  }
}

function updateQuizGoalsProgress() {
  const goals = getGoals();
  const quizzes = getQuizAttempts();

  let updated = false;
  goals.forEach((g) => {
    if (g.category === "quiz_score" && g.status !== "completed") {
      const relevant = g.courseId
        ? quizzes.filter((q) => q.courseId === g.courseId)
        : quizzes;
      g.current = Math.min(relevant.length, g.target);
      if (g.current >= g.target) {
        g.status = "completed";
        g.completedAt = new Date().toISOString();
      }
      updated = true;
    }
  });

  if (updated) {
    setStoredItem(STORAGE_KEYS.GOALS, goals);
  }
}

export function updateMockTestGoalsProgress() {
  const goals = getGoals();
  const tests = getMockTests();
  const allAttempts = [];
  tests.forEach((t) => {
    (t.attempts || []).forEach((a) => allAttempts.push({ ...a, courseId: t.courseId }));
  });

  let updated = false;
  goals.forEach((g) => {
    if ((g.category === "mock_test" || g.category === "quiz_score") && g.status !== "completed") {
      const relevant = g.courseId
        ? allAttempts.filter((a) => a.courseId === g.courseId)
        : allAttempts;
      
      if (g.category === "mock_test") {
        g.current = Math.min(relevant.length, g.target);
        if (g.current >= g.target) {
          g.status = "completed";
          g.completedAt = new Date().toISOString();
        }
        updated = true;
      }
    }
  });

  if (updated) {
    setStoredItem(STORAGE_KEYS.GOALS, goals);
  }
}

// ============================================
// ACTIVITY LOG API
// ============================================

export function getRecentActivities(limit = 15) {
  const activities = getStoredItem(STORAGE_KEYS.ACTIVITIES, []);
  return activities.slice(0, limit);
}

export function logActivity(type, message, tabLink = "Overview") {
  const activities = getStoredItem(STORAGE_KEYS.ACTIVITIES, []);
  const newActivity = {
    id: `act-${Date.now()}-${Math.random().toString(36).substr(2, 4)}`,
    type,
    message,
    tabLink,
    timestamp: new Date().toISOString(),
  };

  activities.unshift(newActivity);
  // Keep last 50 activities
  setStoredItem(STORAGE_KEYS.ACTIVITIES, activities.slice(0, 50));
}

// ============================================
// AGGREGATED REAL METRICS
// ============================================

export function getPlatformMetrics() {
  const courses = getCourses();
  const notes = getSavedNotes();
  const quizzes = getQuizAttempts();
  const sessions = getStudySessions();
  const goals = getGoals();
  const decks = getFlashcardDecks();
  const mockMetrics = getMockTestMetrics();

  // Total study minutes from actual recorded sessions
  const totalMinutes = sessions.reduce((acc, s) => acc + (s.durationMinutes || 0), 0);
  const totalHours = (totalMinutes / 60).toFixed(1);

  // Overall accuracy
  let totalScore = 0;
  quizzes.forEach((q) => {
    totalScore += q.scorePercentage || 0;
  });
  const avgAccuracy = quizzes.length > 0 ? Math.round(totalScore / quizzes.length) : null;

  // Total flashcards
  const totalCards = decks.reduce((sum, d) => sum + (d.cards?.length || 0), 0);

  // Completed goals
  const completedGoals = goals.filter((g) => g.status === "completed").length;

  return {
    coursesCount: courses.length,
    notesCount: notes.length,
    quizzesCount: quizzes.length,
    sessionsCount: sessions.length,
    totalMinutes,
    totalHours,
    avgAccuracy,
    totalCards,
    completedGoals,
    totalGoals: goals.length,
    mockTestsCount: mockMetrics.totalTestsCreated,
    mockAttemptsCount: mockMetrics.totalAttempts,
    avgMockScore: mockMetrics.avgScorePercentage,
    bestMockScore: mockMetrics.bestScorePercentage,
    studyPlansCount: getStudyPlans().length,
  };
}
