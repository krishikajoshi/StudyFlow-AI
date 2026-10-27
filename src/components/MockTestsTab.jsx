import { useState, useEffect, useRef } from "react";
import {
  getMockTests,
  saveMockTest,
  deleteMockTest,
  getMockTestById,
  saveMockTestAttempt,
  updateMockTestAttempt,
  getActiveMockTest,
  saveActiveMockTest,
  clearActiveMockTest,
  getMockTestMetrics,
  getSavedNotes,
  getCourses,
  saveStudyNote,
  analyzeSingleMockTestAttempt,
  extractAssessmentWeaknesses,
} from "../utils/storage";
import { apiFetch, getApiErrorMessage } from "../utils/api";

export default function MockTestsTab({
  setActivePage,
  onOpenNote = null,
  onOpenCourse = null,
  preselectedCourseId = null,
  onSendToAITutor = null,
  onOpenStudyPlanner = null,
}) {
  // Current view: "dashboard" | "create" | "preview" | "exam" | "evaluating" | "results"
  const [view, setView] = useState("dashboard");
  const [diagnosticFilter, setDiagnosticFilter] = useState("all");

  // Storage data
  const [mockTests, setMockTests] = useState(() => getMockTests());
  const [metrics, setMetrics] = useState(() => getMockTestMetrics());
  const [savedNotes, setSavedNotes] = useState(() => getSavedNotes());
  const [courses, setCourses] = useState(() => getCourses());
  const [activeExamState, setActiveExamState] = useState(() => getActiveMockTest());

  // Currently inspected/active test & attempt initialized lazily from active storage session
  const [currentTest, setCurrentTest] = useState(() => {
    const active = getActiveMockTest();
    return active?.testId ? getMockTestById(active.testId) : null;
  });
  const [currentAttempt, setCurrentAttempt] = useState(null);

  // Configuration form state
  const [config, setConfig] = useState({
    sourceType: preselectedCourseId ? "course" : "topic", // "notes" | "course" | "topic"
    selectedNoteId: "",
    selectedCourseId: preselectedCourseId || "",
    topic: "",
    referenceNotes: "",
    difficulty: "Medium", // "Easy" | "Medium" | "Hard" | "Mixed"
    durationMinutes: 30, // 15, 30, 45, 60
    questionCount: 10, // 5, 10, 15, 20
    format: "mixed", // "mcq" | "short" | "long" | "mixed"
    distribution: { mcq: 5, short: 3, long: 2 },
    useDefaultMarks: true,
    customMarks: { mcq: 2, short: 4, long: 8 },
  });

  const [isGenerating, setIsGenerating] = useState(false);
  const [generationError, setGenerationError] = useState("");

  // Examination state initialized lazily
  const [examAnswers, setExamAnswers] = useState(() => {
    const active = getActiveMockTest();
    return active?.answers || {};
  });
  const [markedForReview, setMarkedForReview] = useState(() => {
    const active = getActiveMockTest();
    return active?.markedForReview || [];
  });
  const [currentQuestionIndex, setCurrentQuestionIndex] = useState(() => {
    const active = getActiveMockTest();
    return active?.currentQuestionIndex || 0;
  });
  const [secondsRemaining, setSecondsRemaining] = useState(() => {
    const active = getActiveMockTest();
    if (active && active.testId) {
      const test = getMockTestById(active.testId);
      if (test && active.startedAt) {
        const startedTime = new Date(active.startedAt).getTime();
        const durationSec = (test.durationMinutes || 30) * 60;
        const elapsedSec = Math.floor((Date.now() - startedTime) / 1000);
        return Math.max(0, durationSec - elapsedSec);
      }
    }
    return 30 * 60;
  });
  const [isExamSubmitting, setIsExamSubmitting] = useState(false);
  const [showSubmitConfirmModal, setShowSubmitConfirmModal] = useState(false);
  const [autosaveIndicator, setAutosaveIndicator] = useState("All answers autosaved");

  // Evaluation & retry state
  const [isEvaluating, setIsEvaluating] = useState(false);
  const [evaluationError, setEvaluationError] = useState("");

  // Results review filters
  const [resultsFilter, setResultsFilter] = useState("all"); // "all" | "correct" | "needs_work" | "marked"
  const [savedNoteQuestionId, setSavedNoteQuestionId] = useState(null);

  // Reload data on storage sync
  function refreshData() {
    setMockTests(getMockTests());
    setMetrics(getMockTestMetrics());
    setSavedNotes(getSavedNotes());
    setCourses(getCourses());
    setActiveExamState(getActiveMockTest());
  }

  useEffect(() => {
    window.addEventListener("studyflow_storage_sync", refreshData);
    return () => window.removeEventListener("studyflow_storage_sync", refreshData);
  }, []);

  const executeSubmissionRef = useRef(null);

  // Timer countdown hook for examination
  useEffect(() => {
    let timer = null;
    if (view === "exam" && secondsRemaining > 0 && !isExamSubmitting) {
      timer = setInterval(() => {
        setSecondsRemaining((prev) => {
          if (prev <= 1) {
            clearInterval(timer);
            // Automatic safe submission when time expires
            if (executeSubmissionRef.current) {
              executeSubmissionRef.current();
            }
            return 0;
          }
          return prev - 1;
        });
      }, 1000);
    }
    return () => clearInterval(timer);
  }, [view, secondsRemaining, isExamSubmitting]);

  // Question distribution synchronizer when questionCount changes
  function handleQuestionCountChange(count) {
    const num = parseInt(count, 10);
    let mcq = Math.round(num * 0.5);
    let short = Math.round(num * 0.3);
    let long = num - mcq - short;
    if (long < 0) {
      mcq += long;
      long = 0;
    }
    setConfig((prev) => ({
      ...prev,
      questionCount: num,
      distribution: { mcq, short, long },
    }));
  }

  // Calculate total marks preview
  const calculatedTotalMarks = (() => {
    const { questionCount, format, distribution, useDefaultMarks, customMarks } = config;
    const mcqM = useDefaultMarks ? 2 : parseInt(customMarks.mcq, 10) || 2;
    const shortM = useDefaultMarks ? 4 : parseInt(customMarks.short, 10) || 4;
    const longM = useDefaultMarks ? 8 : parseInt(customMarks.long, 10) || 8;

    if (format === "mcq") return questionCount * mcqM;
    if (format === "short") return questionCount * shortM;
    if (format === "long") return questionCount * longM;

    return (
      (distribution.mcq || 0) * mcqM +
      (distribution.short || 0) * shortM +
      (distribution.long || 0) * longM
    );
  })();

  // Generate test handler
  async function handleGenerateTest() {
    setGenerationError("");
    setIsGenerating(true);

    try {
      // Resolve source text & name
      let sourceText = "";
      let sourceName = "";
      let courseId = null;
      let noteId = null;

      if (config.sourceType === "notes") {
        const note = savedNotes.find((n) => n.id === config.selectedNoteId);
        if (!note) {
          throw new Error("Please select an uploaded study note from the list.");
        }
        sourceText = note.text || note.summary || note.revision || "";
        sourceName = note.title || note.fileName || "Uploaded Note";
        noteId = note.id;
        courseId = note.courseId;
      } else if (config.sourceType === "course") {
        const course = courses.find((c) => c.id === config.selectedCourseId);
        if (!course) {
          throw new Error("Please select a course.");
        }
        courseId = course.id;
        sourceName = course.name;
        // Collect notes from this course
        const courseNotes = savedNotes.filter((n) => n.courseId === course.id);
        if (courseNotes.length > 0) {
          sourceText = courseNotes.map((n) => n.text || n.summary || "").join("\n\n");
        } else {
          sourceText = `${course.name}: ${course.description || ""}`;
        }
      } else {
        // Custom topic
        if (!config.topic.trim()) {
          throw new Error("Please enter a subject topic for your mock test.");
        }
        sourceName = config.topic.trim();
        sourceText = config.referenceNotes.trim();
      }

      const payload = {
        sourceType: config.sourceType,
        sourceName,
        sourceText,
        topic: config.topic,
        difficulty: config.difficulty,
        durationMinutes: config.durationMinutes,
        questionCount: config.questionCount,
        format: config.format,
        distribution: config.distribution,
        customMarks: config.useDefaultMarks ? { mcq: 2, short: 4, long: 8 } : config.customMarks,
      };

      const response = await apiFetch("/api/mock-test/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      const data = await response.json().catch(() => ({}));

      if (!response.ok) {
        throw new Error(data.error || "Failed to generate mock test. Please try again.");
      }

      if (!data.questions || data.questions.length === 0) {
        throw new Error("No questions were generated. Please try again with a different source.");
      }

      // Save generated test into storage
      const saved = saveMockTest({
        title: data.testTitle || `${sourceName} Mock Examination`,
        sourceType: config.sourceType,
        sourceName,
        sourceText,
        courseId,
        noteId,
        difficulty: config.difficulty,
        durationMinutes: data.durationMinutes || config.durationMinutes,
        questionCount: data.questions.length,
        format: config.format,
        distribution: data.distribution || config.distribution,
        customMarks: payload.customMarks,
        questions: data.questions,
        totalMarks: data.totalMarks,
      });

      setCurrentTest(saved);
      setView("preview");
    } catch (err) {
      setGenerationError(getApiErrorMessage(err));
    } finally {
      setIsGenerating(false);
    }
  }

  // Start Examination
  function handleStartExam(test) {
    const examTest = test || currentTest;
    if (!examTest) return;

    setCurrentTest(examTest);
    const initialAnswers = {};
    setExamAnswers(initialAnswers);
    setMarkedForReview([]);
    setCurrentQuestionIndex(0);

    const durationSec = (examTest.durationMinutes || 30) * 60;
    setSecondsRemaining(durationSec);
    setIsExamSubmitting(false);

    // Persist active state in localStorage so refreshes resume immediately
    saveActiveMockTest({
      testId: examTest.id,
      startedAt: new Date().toISOString(),
      answers: initialAnswers,
      markedForReview: [],
      currentQuestionIndex: 0,
    });

    setView("exam");
  }

  // Resume In-Progress Examination
  function handleResumeExam() {
    const active = getActiveMockTest();
    if (!active || !active.testId) return;

    const test = getMockTestById(active.testId);
    if (!test) return;

    const startedTime = new Date(active.startedAt).getTime();
    const durationSec = (test.durationMinutes || 30) * 60;
    const elapsedSec = Math.floor((Date.now() - startedTime) / 1000);
    const remaining = Math.max(0, durationSec - elapsedSec);

    setCurrentTest(test);
    setExamAnswers(active.answers || {});
    setMarkedForReview(active.markedForReview || []);
    setCurrentQuestionIndex(active.currentQuestionIndex || 0);
    setSecondsRemaining(remaining);
    setIsExamSubmitting(false);
    setView("exam");
  }

  function handleDiscardActiveExam() {
    clearActiveMockTest();
    setActiveExamState(null);
  }

  // User selects an MCQ answer or types a written answer
  function handleAnswerChange(qId, value) {
    const updated = {
      ...examAnswers,
      [qId]: value,
    };
    setExamAnswers(updated);

    // Autosave immediately to active test state
    if (currentTest) {
      const active = getActiveMockTest() || {};
      saveActiveMockTest({
        ...active,
        testId: currentTest.id,
        startedAt: active.startedAt || new Date().toISOString(),
        answers: updated,
        markedForReview,
        currentQuestionIndex,
      });

      const now = new Date();
      setAutosaveIndicator(`Autosaved at ${now.toLocaleTimeString()}`);
    }
  }

  // Clear answer for current question
  function handleClearAnswer(qId) {
    const updated = { ...examAnswers };
    delete updated[qId];
    setExamAnswers(updated);

    if (currentTest) {
      const active = getActiveMockTest() || {};
      saveActiveMockTest({
        ...active,
        answers: updated,
      });
      setAutosaveIndicator("Answer cleared");
    }
  }

  // Toggle mark for review
  function handleToggleReview(qId) {
    let updated;
    if (markedForReview.includes(qId)) {
      updated = markedForReview.filter((id) => id !== qId);
    } else {
      updated = [...markedForReview, qId];
    }
    setMarkedForReview(updated);

    if (currentTest) {
      const active = getActiveMockTest() || {};
      saveActiveMockTest({
        ...active,
        markedForReview: updated,
      });
    }
  }

  // Final Submit Handler
  async function executeSubmission() {
    if (!currentTest) return;

    setIsExamSubmitting(true);
    setView("evaluating");
    setIsEvaluating(true);
    setEvaluationError("");

    const questions = currentTest.questions || [];
    const active = getActiveMockTest() || {};
    const startedAt = active.startedAt || new Date().toISOString();
    const timeTakenSeconds = Math.max(
      10,
      Math.floor((Date.now() - new Date(startedAt).getTime()) / 1000)
    );

    // 1. Grade MCQs objectively against stored correct answers
    let mcqEarnedMarks = 0;
    let mcqTotalMarks = 0;
    const mcqEvaluations = {};

    questions.forEach((q) => {
      if (q.type === "mcq") {
        mcqTotalMarks += q.marks || 2;
        const studentChoice = examAnswers[q.id];
        const isCorrect =
          studentChoice &&
          q.correctOption &&
          studentChoice.toUpperCase() === q.correctOption.toUpperCase();

        if (isCorrect) {
          mcqEarnedMarks += q.marks || 2;
        }

        mcqEvaluations[q.id] = {
          marksAwarded: isCorrect ? q.marks || 2 : 0,
          maxMarks: q.marks || 2,
          isCorrect,
          selectedOption: studentChoice || null,
          correctOption: q.correctOption,
          explanation: q.explanation || "No explanation provided.",
          strengths: isCorrect ? ["Selected the correct option."] : [],
          missingConcepts: !isCorrect
            ? [`Correct answer was (${q.correctOption}): ${q.explanation || ""}`]
            : [],
          mistakes: !isCorrect && studentChoice ? [`Selected option (${studentChoice})`] : [],
          feedback: isCorrect
            ? "Accurate understanding demonstrated."
            : `Incorrect choice. ${q.explanation || ""}`,
        };
      }
    });

    // 2. Prepare written answers for AI evaluation
    const writtenQuestions = questions.filter(
      (q) => q.type === "short" || q.type === "long"
    );
    const writtenAnswersPayload = writtenQuestions.map((q) => ({
      questionId: q.id,
      questionType: q.type,
      questionText: q.question,
      maxMarks: q.marks,
      referenceAnswer: q.referenceAnswer,
      rubric: q.rubric,
      studentAnswer: examAnswers[q.id] || "",
    }));

    let writtenEvaluations = {};
    let writtenEarnedMarks = 0;
    let writtenTotalMarks = writtenQuestions.reduce((sum, q) => sum + (q.marks || 0), 0);
    let evaluationStatus = "completed";
    let evalErrorMsg = null;

    if (writtenAnswersPayload.length > 0) {
      try {
        const response = await apiFetch("/api/mock-test/evaluate", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            testId: currentTest.id,
            writtenAnswers: writtenAnswersPayload,
          }),
        });

        const data = await response.json().catch(() => ({}));

        if (!response.ok || !data.evaluations) {
          throw new Error(
            data.error ||
              "AI evaluation service is temporarily unavailable. Your answers are saved."
          );
        }

        writtenEvaluations = data.evaluations;

        // Sum written marks
        Object.keys(writtenEvaluations).forEach((qId) => {
          const ev = writtenEvaluations[qId];
          writtenEarnedMarks += Number(ev.marksAwarded) || 0;
        });
      } catch (err) {
        console.warn("AI written evaluation failed:", err);
        evaluationStatus = "pending";
        evalErrorMsg = getApiErrorMessage(err);

        // Mark written questions as pending evaluation
        writtenQuestions.forEach((q) => {
          writtenEvaluations[q.id] = {
            marksAwarded: 0,
            maxMarks: q.marks,
            isPending: true,
            feedback: "Evaluation pending retry.",
            strengths: [],
            missingConcepts: [],
            mistakes: [],
          };
        });
      }
    }

    // 3. Application calculates final total score from question-level marks
    const totalEarnedMarks = Math.round((mcqEarnedMarks + writtenEarnedMarks) * 10) / 10;
    const totalPossibleMarks = currentTest.totalMarks || mcqTotalMarks + writtenTotalMarks;

    const mergedEvaluations = {
      ...mcqEvaluations,
      ...writtenEvaluations,
    };

    // 4. Save attempt to database/localStorage
    const savedAttempt = saveMockTestAttempt(currentTest.id, {
      startedAt,
      timeTakenSeconds,
      userAnswers: examAnswers,
      markedForReview,
      evaluations: mergedEvaluations,
      mcqScore: mcqEarnedMarks,
      mcqTotal: mcqTotalMarks,
      writtenScore: writtenEarnedMarks,
      writtenTotal: writtenTotalMarks,
      score: totalEarnedMarks,
      totalMarks: totalPossibleMarks,
      evaluationStatus,
      evaluationError: evalErrorMsg,
    });

    setCurrentAttempt(savedAttempt);
    setIsEvaluating(false);
    setIsExamSubmitting(false);
    setView("results");
  }

  useEffect(() => {
    executeSubmissionRef.current = executeSubmission;
  });

  // Retry AI evaluation for pending attempts
  async function handleRetryEvaluation() {
    if (!currentTest || !currentAttempt) return;

    setIsEvaluating(true);
    setEvaluationError("");

    const questions = currentTest.questions || [];
    const writtenQuestions = questions.filter(
      (q) => q.type === "short" || q.type === "long"
    );
    const writtenAnswersPayload = writtenQuestions.map((q) => ({
      questionId: q.id,
      questionType: q.type,
      questionText: q.question,
      maxMarks: q.marks,
      referenceAnswer: q.referenceAnswer,
      rubric: q.rubric,
      studentAnswer: currentAttempt.userAnswers?.[q.id] || "",
    }));

    try {
      const response = await apiFetch("/api/mock-test/evaluate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          testId: currentTest.id,
          writtenAnswers: writtenAnswersPayload,
        }),
      });

      const data = await response.json().catch(() => ({}));
      if (!response.ok || !data.evaluations) {
        throw new Error(data.error || "Retry evaluation failed. Please try again.");
      }

      let newWrittenEarned = 0;
      Object.keys(data.evaluations).forEach((qId) => {
        newWrittenEarned += Number(data.evaluations[qId].marksAwarded) || 0;
      });

      const updatedEvaluations = {
        ...(currentAttempt.evaluations || {}),
        ...data.evaluations,
      };

      const updatedScore =
        Math.round(((currentAttempt.mcqScore || 0) + newWrittenEarned) * 10) / 10;
      const updatedPercentage =
        currentAttempt.totalMarks > 0
          ? Math.round((updatedScore / currentAttempt.totalMarks) * 100)
          : 0;

      const updated = updateMockTestAttempt(currentTest.id, currentAttempt.id, {
        evaluations: updatedEvaluations,
        writtenScore: newWrittenEarned,
        score: updatedScore,
        percentage: updatedPercentage,
        evaluationStatus: "completed",
        evaluationError: null,
      });

      setCurrentAttempt(updated);
      refreshData();
    } catch (err) {
      setEvaluationError(getApiErrorMessage(err));
    } finally {
      setIsEvaluating(false);
    }
  }

  // Retake Test (creates a brand new attempt, preserving the previous one!)
  function handleRetakeTest(test) {
    const targetTest = test || currentTest;
    if (!targetTest) return;

    setCurrentTest(targetTest);
    setCurrentAttempt(null);
    handleStartExam(targetTest);
  }

  // Format seconds into MM:SS
  function formatTime(totalSeconds) {
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
  }

  // Send question context to AI Tutor
  function handleAskAITutor(question, studentAnswer, referenceAnswer, feedback) {
    const tutorQuestion = `In my mock test, I had this question:
"${question.question}"

My submitted answer was:
"${studentAnswer || "[Left Blank]"}"

The reference answer is:
"${referenceAnswer}"

Examiner feedback:
"${feedback}"

Could you please explain the conceptual gap in simple terms and give me a clear way to remember and solve similar questions in the future?`;

    if (onSendToAITutor) {
      onSendToAITutor(tutorQuestion);
    } else {
      // Fallback: copy to clipboard and open AI Tutor
      navigator.clipboard.writeText(tutorQuestion).catch(() => {});
      setActivePage("AI Tutor");
    }
  }

  // Save question to My Notes
  function handleSaveQuestionToNotes(q, studentAnswer, referenceAnswer, feedback) {
    const noteTitle = `Review Note: ${q.question.slice(0, 45)}...`;
    const noteContent = `# Mock Test Review Note

## Question (${q.marks} Marks)
${q.question}

${
  q.type === "mcq" && q.options
    ? `### Options\n${q.options.map((o) => `- **${o.label}.** ${o.text}`).join("\n")}\n\n**Correct Answer:** Option ${q.correctOption}\n`
    : ""
}

## My Submitted Answer
> ${studentAnswer || "*No answer provided*"}

## Model Reference Answer
${referenceAnswer}

## Examiner Feedback & Areas for Improvement
- ${feedback}

---
*Saved from StudyFlow.ai Mock Test Examination*
`;

    saveStudyNote({
      title: noteTitle,
      fileName: `${currentTest?.title || "Mock Test"} - Review.md`,
      courseId: currentTest?.courseId || null,
      text: noteContent,
      summary: `Review note for question: ${q.question}`,
    });

    setSavedNoteQuestionId(q.id);
    setTimeout(() => setSavedNoteQuestionId(null), 3000);
  }

  // Active question in exam
  const activeQuestion = currentTest?.questions?.[currentQuestionIndex] || null;
  const totalExamQuestions = currentTest?.questions?.length || 0;
  const answeredCount = Object.keys(examAnswers).filter(
    (k) => examAnswers[k] && String(examAnswers[k]).trim()
  ).length;
  const unansweredCount = totalExamQuestions - answeredCount;

  // ============================================
  // RENDER: PREVIEW SCREEN
  // ============================================
  if (view === "preview" && currentTest) {
    return (
      <div className="mock-test-container">
        <div className="mock-preview-card">
          <div className="mock-preview-badge">✦ EXAMINATION READY</div>
          <h2>{currentTest.title}</h2>
          <p className="mock-preview-desc">
            Your examination has been generated and grounded in your study material. Review the configuration and guidelines below before beginning.
          </p>

          <div className="mock-preview-grid">
            <div className="mock-preview-item">
              <span className="mock-preview-label">Source Material</span>
              <strong className="mock-preview-val">{currentTest.sourceName}</strong>
            </div>
            <div className="mock-preview-item">
              <span className="mock-preview-label">Difficulty</span>
              <strong className="mock-preview-val">{currentTest.difficulty}</strong>
            </div>
            <div className="mock-preview-item">
              <span className="mock-preview-label">Duration</span>
              <strong className="mock-preview-val">{currentTest.durationMinutes} Minutes</strong>
            </div>
            <div className="mock-preview-item">
              <span className="mock-preview-label">Total Questions</span>
              <strong className="mock-preview-val">{currentTest.questionCount} Questions</strong>
            </div>
            <div className="mock-preview-item">
              <span className="mock-preview-label">Total Marks</span>
              <strong className="mock-preview-val">{currentTest.totalMarks} Marks</strong>
            </div>
            <div className="mock-preview-item">
              <span className="mock-preview-label">Question Breakdown</span>
              <strong className="mock-preview-val">
                {currentTest.distribution?.mcq || 0} MCQ · {currentTest.distribution?.short || 0} Short · {currentTest.distribution?.long || 0} Long
              </strong>
            </div>
          </div>

          <div className="mock-preview-rules">
            <h4>📋 Examination Guidelines:</h4>
            <ul>
              <li><strong>Continuous Timer:</strong> Once started, the countdown timer runs continuously.</li>
              <li><strong>Autosave:</strong> Every MCQ choice and written keystroke is autosaved automatically.</li>
              <li><strong>Interruption Protection:</strong> If you refresh or close the tab, your in-progress answers are saved.</li>
              <li><strong>Integrity:</strong> Correct answers and rubrics remain hidden until final submission.</li>
              <li><strong>Automatic Submission:</strong> If the timer expires, your test will be submitted safely.</li>
            </ul>
          </div>

          <div className="mock-preview-actions">
            <button
              type="button"
              className="secondary-btn"
              onClick={() => setView("dashboard")}
            >
              Back to Dashboard
            </button>
            <button
              type="button"
              className="primary-btn pulse-glow"
              onClick={() => handleStartExam(currentTest)}
            >
              Start Examination Now ⏱
            </button>
          </div>
        </div>
      </div>
    );
  }

  // ============================================
  // RENDER: REAL EXAMINATION INTERFACE
  // ============================================
  if (view === "exam" && currentTest && activeQuestion) {
    const isTimerWarning = secondsRemaining <= 300 && secondsRemaining > 120;
    const isTimerCritical = secondsRemaining <= 120;
    const currentQId = activeQuestion.id;
    const isAnswered = Boolean(
      examAnswers[currentQId] && String(examAnswers[currentQId]).trim()
    );
    const isMarked = markedForReview.includes(currentQId);

    return (
      <div className="mock-exam-shell">
        {/* TOP EXAMINATION BAR */}
        <header className="mock-exam-header">
          <div className="mock-exam-info">
            <span className="mock-exam-tag">EXAMINATION IN PROGRESS</span>
            <h3 className="mock-exam-title">{currentTest.title}</h3>
          </div>

          <div className="mock-exam-status-chips">
            <div className={`mock-timer-chip ${isTimerCritical ? "critical" : isTimerWarning ? "warning" : ""}`}>
              <span className="timer-icon">⏱</span>
              <span className="timer-digits">{formatTime(secondsRemaining)}</span>
            </div>

            <div className="mock-answered-chip">
              <span>✓ Answered:</span>
              <strong>{answeredCount} / {totalExamQuestions}</strong>
            </div>

            {markedForReview.length > 0 && (
              <div className="mock-review-chip">
                <span>⚑ Review:</span>
                <strong>{markedForReview.length}</strong>
              </div>
            )}

            <button
              type="button"
              className="mock-submit-btn"
              onClick={() => setShowSubmitConfirmModal(true)}
            >
              Submit Test ↗
            </button>
          </div>
        </header>

        {/* MAIN EXAM WORKSPACE */}
        <div className="mock-exam-layout">
          {/* QUESTION PALETTE / NAVIGATION DRAWER */}
          <aside className="mock-palette-sidebar">
            <div className="mock-palette-title">
              <span>Question Palette</span>
              <span className="mock-palette-counter">{totalExamQuestions} Questions</span>
            </div>

            <div className="mock-palette-grid">
              {currentTest.questions.map((q, idx) => {
                const answered = Boolean(
                  examAnswers[q.id] && String(examAnswers[q.id]).trim()
                );
                const marked = markedForReview.includes(q.id);
                const isCurrent = idx === currentQuestionIndex;

                let stateClass = "";
                if (isCurrent) stateClass += " active";
                if (marked) stateClass += " marked";
                else if (answered) stateClass += " answered";
                else stateClass += " unanswered";

                return (
                  <button
                    key={q.id}
                    type="button"
                    className={`mock-palette-btn ${stateClass}`}
                    onClick={() => setCurrentQuestionIndex(idx)}
                    title={`Question ${idx + 1} (${q.type.toUpperCase()} · ${q.marks} Marks)`}
                  >
                    {idx + 1}
                    {marked && <span className="palette-flag-dot" />}
                  </button>
                );
              })}
            </div>

            <div className="mock-palette-legend">
              <div className="legend-item"><span className="legend-dot answered" /> Answered</div>
              <div className="legend-item"><span className="legend-dot unanswered" /> Unanswered</div>
              <div className="legend-item"><span className="legend-dot marked" /> Marked for Review</div>
              <div className="legend-item"><span className="legend-dot active" /> Current</div>
            </div>

            <div className="mock-autosave-footer">
              <span className="autosave-dot" /> {autosaveIndicator}
            </div>
          </aside>

          {/* ACTIVE QUESTION PANEL */}
          <main className="mock-question-panel">
            <div className="mock-question-header">
              <div className="mock-q-meta">
                <span className="mock-q-num">Question {currentQuestionIndex + 1} of {totalExamQuestions}</span>
                <span className={`mock-q-type-badge ${activeQuestion.type}`}>
                  {activeQuestion.type === "mcq"
                    ? "Multiple Choice"
                    : activeQuestion.type === "short"
                    ? "Short Answer"
                    : "Long Answer"}
                </span>
                <span className="mock-q-marks-badge">{activeQuestion.marks} Marks</span>
              </div>

              <div className="mock-q-actions">
                <button
                  type="button"
                  className={`mock-flag-btn ${isMarked ? "is-flagged" : ""}`}
                  onClick={() => handleToggleReview(currentQId)}
                >
                  {isMarked ? "⚑ Marked for Review" : "⚐ Mark for Review"}
                </button>
                {isAnswered && (
                  <button
                    type="button"
                    className="mock-clear-btn"
                    onClick={() => handleClearAnswer(currentQId)}
                  >
                    Clear Answer
                  </button>
                )}
              </div>
            </div>

            <div className="mock-q-body">
              <h3 className="mock-q-text">{activeQuestion.question}</h3>

              {/* MCQ SELECTION */}
              {activeQuestion.type === "mcq" && (
                <div className="mock-options-group">
                  {(activeQuestion.options || []).map((opt) => {
                    const selected = examAnswers[currentQId] === opt.label;
                    return (
                      <div
                        key={opt.label}
                        className={`mock-option-card ${selected ? "selected" : ""}`}
                        onClick={() => handleAnswerChange(currentQId, opt.label)}
                        role="button"
                        tabIndex={0}
                        onKeyDown={(e) => {
                          if (e.key === "Enter" || e.key === " ") {
                            handleAnswerChange(currentQId, opt.label);
                          }
                        }}
                      >
                        <div className="mock-option-radio">
                          {selected ? <span className="radio-dot" /> : null}
                        </div>
                        <span className="mock-option-label">{opt.label}.</span>
                        <span className="mock-option-text">{opt.text}</span>
                      </div>
                    );
                  })}
                </div>
              )}

              {/* SHORT ANSWER TEXTAREA */}
              {activeQuestion.type === "short" && (
                <div className="mock-written-wrap">
                  <div className="mock-written-hint">
                    💡 <strong>Concise Explanation:</strong> Provide a clear, focused answer in 2 to 4 sentences highlighting key mechanisms and definitions.
                  </div>
                  <textarea
                    className="mock-textarea short"
                    rows={6}
                    placeholder="Type your short answer here..."
                    value={examAnswers[currentQId] || ""}
                    onChange={(e) => handleAnswerChange(currentQId, e.target.value)}
                  />
                  <div className="mock-word-count">
                    Word count: {((examAnswers[currentQId] || "").trim().match(/\S+/g) || []).length} words
                  </div>
                </div>
              )}

              {/* LONG ANSWER TEXTAREA */}
              {activeQuestion.type === "long" && (
                <div className="mock-written-wrap">
                  <div className="mock-written-hint">
                    📖 <strong>Structured Response:</strong> Address all aspects of the prompt. Break down your reasoning with structured paragraphs, clear arguments, and relevant examples.
                  </div>
                  <textarea
                    className="mock-textarea long"
                    rows={12}
                    placeholder="Type your comprehensive response here..."
                    value={examAnswers[currentQId] || ""}
                    onChange={(e) => handleAnswerChange(currentQId, e.target.value)}
                  />
                  <div className="mock-word-count">
                    Word count: {((examAnswers[currentQId] || "").trim().match(/\S+/g) || []).length} words
                  </div>
                </div>
              )}
            </div>

            {/* BOTTOM QUESTION NAVIGATION */}
            <footer className="mock-q-footer">
              <button
                type="button"
                className="secondary-btn"
                disabled={currentQuestionIndex === 0}
                onClick={() => setCurrentQuestionIndex((prev) => Math.max(0, prev - 1))}
              >
                ← Previous
              </button>

              <div className="mock-q-footer-middle">
                <span>
                  Question {currentQuestionIndex + 1} of {totalExamQuestions}
                </span>
              </div>

              {currentQuestionIndex < totalExamQuestions - 1 ? (
                <button
                  type="button"
                  className="primary-btn"
                  onClick={() =>
                    setCurrentQuestionIndex((prev) =>
                      Math.min(totalExamQuestions - 1, prev + 1)
                    )
                  }
                >
                  Next Question →
                </button>
              ) : (
                <button
                  type="button"
                  className="primary-btn submit-accent"
                  onClick={() => setShowSubmitConfirmModal(true)}
                >
                  Review & Submit Test ↗
                </button>
              )}
            </footer>
          </main>
        </div>

        {/* SUBMISSION CONFIRMATION MODAL */}
        {showSubmitConfirmModal && (
          <div className="modal-backdrop">
            <div className="modal-card">
              <div className="modal-header">
                <h3>Submit Your Examination?</h3>
                <button
                  type="button"
                  className="modal-close"
                  onClick={() => setShowSubmitConfirmModal(false)}
                >
                  ✕
                </button>
              </div>

              <div className="modal-body">
                <p>
                  You are about to submit your examination for scoring and AI evaluation. Once submitted, answers cannot be edited.
                </p>

                <div className="mock-summary-boxes">
                  <div className="summary-box">
                    <span className="summary-box-num">{answeredCount}</span>
                    <span className="summary-box-label">Answered</span>
                  </div>
                  <div className={`summary-box ${unansweredCount > 0 ? "warning-box" : ""}`}>
                    <span className="summary-box-num">{unansweredCount}</span>
                    <span className="summary-box-label">Unanswered</span>
                  </div>
                  <div className="summary-box">
                    <span className="summary-box-num">{markedForReview.length}</span>
                    <span className="summary-box-label">Marked for Review</span>
                  </div>
                </div>

                {unansweredCount > 0 && (
                  <div className="mock-submit-warning">
                    ⚠️ You have <strong>{unansweredCount} unanswered questions</strong>. Are you sure you want to proceed with submission?
                  </div>
                )}
              </div>

              <div className="modal-actions">
                <button
                  type="button"
                  className="secondary-btn"
                  onClick={() => setShowSubmitConfirmModal(false)}
                >
                  Keep Working
                </button>
                <button
                  type="button"
                  className="primary-btn submit-accent"
                  onClick={() => {
                    setShowSubmitConfirmModal(false);
                    executeSubmission(false);
                  }}
                >
                  Confirm & Submit Examination
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    );
  }

  // ============================================
  // RENDER: EVALUATION LOADING SCREEN
  // ============================================
  if (view === "evaluating") {
    return (
      <div className="mock-test-container">
        <div className="mock-eval-loading-card">
          <div className="eval-spinner-pulse" />
          <h2>Evaluating Your Examination</h2>
          <p className="mock-eval-subtitle">
            StudyFlow AI is analyzing your answers against model reference rubrics, awarding justified partial marks, and generating pedagogical feedback...
          </p>

          <div className="mock-eval-steps">
            <div className="eval-step completed">
              <span className="step-icon">✓</span>
              <span>Objective Multiple Choice Scoring</span>
            </div>
            <div className="eval-step in-progress">
              <span className="step-icon">⏳</span>
              <span>Evaluating Conceptual Depth & Written Accuracy</span>
            </div>
            <div className="eval-step pending">
              <span className="step-icon">○</span>
              <span>Compiling Performance Breakdown & Next Steps</span>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // ============================================
  // RENDER: RESULTS & DETAILED REVIEW
  // ============================================
  if (view === "results" && currentTest && currentAttempt) {
    const questions = currentTest.questions || [];
    const evaluations = currentAttempt.evaluations || {};
    const percentage = currentAttempt.percentage || 0;

    // Performance grade
    let gradeLabel = "Pass";
    let gradeBadgeClass = "grade-pass";
    if (percentage >= 90) {
      gradeLabel = "High Distinction (A+)";
      gradeBadgeClass = "grade-hd";
    } else if (percentage >= 75) {
      gradeLabel = "Distinction (A)";
      gradeBadgeClass = "grade-dist";
    } else if (percentage >= 60) {
      gradeLabel = "Credit (B)";
      gradeBadgeClass = "grade-credit";
    } else if (percentage < 50) {
      gradeLabel = "Needs Revision";
      gradeBadgeClass = "grade-fail";
    }

    const mistakeReport = analyzeSingleMockTestAttempt(currentTest, currentAttempt) || {
      confirmedErrors: [],
      misconceptions: [],
      incompleteExplanations: [],
      formulaMethodIssues: [],
      recurringMistakes: [],
      weakTopics: [],
      strengths: [],
      totalErrors: 0,
    };

    let displayedDiagIssues;
    if (diagnosticFilter === "misconception") {
      displayedDiagIssues = mistakeReport.misconceptions;
    } else if (diagnosticFilter === "incomplete") {
      displayedDiagIssues = mistakeReport.incompleteExplanations;
    } else if (diagnosticFilter === "confirmed") {
      displayedDiagIssues = mistakeReport.confirmedErrors;
    } else if (diagnosticFilter === "formula") {
      displayedDiagIssues = mistakeReport.formulaMethodIssues;
    } else if (diagnosticFilter === "recurring") {
      displayedDiagIssues = mistakeReport.recurringMistakes;
    } else {
      displayedDiagIssues = [
        ...mistakeReport.recurringMistakes.map((r) => ({ ...r, isRecurringForced: true })),
        ...mistakeReport.misconceptions,
        ...mistakeReport.incompleteExplanations,
        ...mistakeReport.formulaMethodIssues,
        ...mistakeReport.confirmedErrors.filter((c) => !mistakeReport.recurringMistakes.some((r) => r.questionId === c.questionId)),
      ];
    }
    const uniqueDiagIssues = [];
    const seenIssueKeys = new Set();
    displayedDiagIssues.forEach((it) => {
      if (!seenIssueKeys.has(it.questionId)) {
        seenIssueKeys.add(it.questionId);
        uniqueDiagIssues.push(it);
      }
    });

    // Filter questions for detailed breakdown
    const filteredQuestions = questions.filter((q) => {
      const ev = evaluations[q.id] || {};
      const maxMarks = q.marks || 1;
      const marksWon = Number(ev.marksAwarded) || 0;
      const isMarked = (currentAttempt.markedForReview || []).includes(q.id);

      if (resultsFilter === "correct") {
        return marksWon >= maxMarks * 0.8;
      }
      if (resultsFilter === "needs_work") {
        return marksWon < maxMarks * 0.8;
      }
      if (resultsFilter === "marked") {
        return isMarked;
      }
      return true;
    });

    return (
      <div className="mock-test-container">
        {/* RESULTS HEADER ROW */}
        <div className="mock-results-header">
          <button
            type="button"
            className="mock-back-link"
            onClick={() => setView("dashboard")}
          >
            ← Back to Mock Tests
          </button>

          <div className="mock-results-actions">
            <button
              type="button"
              className="primary-btn pulse-glow"
              onClick={() => handleRetakeTest(currentTest)}
            >
              Retake This Examination ↻
            </button>
          </div>
        </div>

        {/* PERFORMANCE HERO CARD */}
        <div className="mock-score-hero-card">
          <div className="score-hero-left">
            <div className={`score-circle-badge ${gradeBadgeClass}`}>
              <span className="score-percent-digits">{percentage}%</span>
              <span className="score-grade-text">{gradeLabel}</span>
            </div>

            <div className="score-hero-copy">
              <span className="score-hero-tag">EXAMINATION RESULT</span>
              <h2>{currentTest.title}</h2>
              <p className="score-hero-subtitle">
                Completed on {new Date(currentAttempt.createdAt || currentAttempt.submittedAt).toLocaleDateString()} · Time taken: {Math.floor((currentAttempt.timeTakenSeconds || 0) / 60)}m {(currentAttempt.timeTakenSeconds || 0) % 60}s
              </p>
            </div>
          </div>

          <div className="score-hero-stats">
            <div className="score-stat-cell">
              <span className="stat-label">Total Marks</span>
              <strong className="stat-val">
                {currentAttempt.score} <span className="stat-max">/ {currentAttempt.totalMarks}</span>
              </strong>
            </div>

            {currentAttempt.mcqTotal > 0 && (
              <div className="score-stat-cell">
                <span className="stat-label">MCQ Score</span>
                <strong className="stat-val">
                  {currentAttempt.mcqScore} <span className="stat-max">/ {currentAttempt.mcqTotal}</span>
                </strong>
                <span className="stat-sub">
                  {Math.round((currentAttempt.mcqScore / currentAttempt.mcqTotal) * 100)}% accuracy
                </span>
              </div>
            )}

            {currentAttempt.writtenTotal > 0 && (
              <div className="score-stat-cell">
                <span className="stat-label">Written Answers</span>
                <strong className="stat-val">
                  {currentAttempt.writtenScore} <span className="stat-max">/ {currentAttempt.writtenTotal}</span>
                </strong>
                <span className="stat-sub">
                  {Math.round((currentAttempt.writtenScore / currentAttempt.writtenTotal) * 100)}% awarded
                </span>
              </div>
            )}
          </div>
        </div>

        {/* AI EVALUATION PENDING BANNER OR RETRY */}
        {currentAttempt.evaluationStatus === "pending" && (
          <div className="mock-pending-banner">
            <div>
              <strong>⚠️ Written Answers Pending AI Evaluation</strong>
              <p>
                Due to temporary AI service busy status, your written responses were preserved safely but have not been evaluated yet.
              </p>
            </div>
            <button
              type="button"
              className="primary-btn"
              disabled={isEvaluating}
              onClick={handleRetryEvaluation}
            >
              {isEvaluating ? "Evaluating..." : "Retry AI Evaluation ↻"}
            </button>
          </div>
        )}

        {evaluationError && (
          <div className="mock-error-alert">
            <span>⚠️ {evaluationError}</span>
          </div>
        )}

        {/* AI GRADING TRANSPARENCY NOTICE */}
        <div className="mock-ai-notice">
          <span className="notice-icon">ℹ️</span>
          <span>
            <strong>AI Evaluation Notice:</strong> Written responses are assessed by AI against model reference rubrics and conceptual completeness. Evaluator feedback should be reviewed critically.
          </span>
        </div>

        {/* AI MISTAKE DIAGNOSTICS & ROOT-CAUSE ANALYSIS */}
        <div className="mock-diagnostics-section">
          <div className="diagnostics-header-card">
            <div className="diag-header-top">
              <div>
                <span className="diag-eyebrow">🔍 AI PEDAGOGICAL DIAGNOSTICS</span>
                <h3>Targeted Mistake Analysis & Root Causes</h3>
                <p>
                  Diagnostic review separating confirmed errors, underlying conceptual misconceptions, and incomplete explanations.
                </p>
              </div>

              {mistakeReport.weakTopics.length > 0 && (
                <button
                  type="button"
                  className="primary-btn pulse-glow diag-plan-cta"
                  onClick={() => {
                    if (onOpenStudyPlanner) {
                      onOpenStudyPlanner({
                        courseId: currentTest.courseId,
                        courseName: currentTest.sourceName || currentTest.title,
                        subject: currentTest.sourceName || currentTest.title,
                        topics: mistakeReport.weakTopics.slice(0, 5),
                        durationDays: 7,
                        dailyMinutes: 45,
                      });
                    } else {
                      setActivePage("Study Planner");
                    }
                  }}
                  title="Generate a personalized study plan targeting these exact mistakes"
                >
                  ⚡ Create 7-Day Remediation Plan ↗
                </button>
              )}
            </div>

            {/* ERROR CATEGORY FILTER PILLS */}
            <div className="diag-metrics-row">
              <button
                type="button"
                className={`diag-stat-pill ${diagnosticFilter === "all" ? "active" : ""}`}
                onClick={() => setDiagnosticFilter("all")}
              >
                <span className="pill-count">{mistakeReport.totalErrors}</span>
                <span className="pill-label">Total Gaps</span>
              </button>

              <button
                type="button"
                className={`diag-stat-pill misconception ${diagnosticFilter === "misconception" ? "active" : ""}`}
                onClick={() => setDiagnosticFilter("misconception")}
              >
                <span className="pill-count">{mistakeReport.misconceptions.length}</span>
                <span className="pill-label">Misconceptions</span>
              </button>

              <button
                type="button"
                className={`diag-stat-pill incomplete ${diagnosticFilter === "incomplete" ? "active" : ""}`}
                onClick={() => setDiagnosticFilter("incomplete")}
              >
                <span className="pill-count">{mistakeReport.incompleteExplanations.length}</span>
                <span className="pill-label">Incomplete Answers</span>
              </button>

              <button
                type="button"
                className={`diag-stat-pill confirmed ${diagnosticFilter === "confirmed" ? "active" : ""}`}
                onClick={() => setDiagnosticFilter("confirmed")}
              >
                <span className="pill-count">{mistakeReport.confirmedErrors.length}</span>
                <span className="pill-label">Confirmed Errors</span>
              </button>

              {mistakeReport.formulaMethodIssues.length > 0 && (
                <button
                  type="button"
                  className={`diag-stat-pill formula ${diagnosticFilter === "formula" ? "active" : ""}`}
                  onClick={() => setDiagnosticFilter("formula")}
                >
                  <span className="pill-count">{mistakeReport.formulaMethodIssues.length}</span>
                  <span className="pill-label">Method / Formula Steps</span>
                </button>
              )}

              {mistakeReport.recurringMistakes.length > 0 && (
                <button
                  type="button"
                  className={`diag-stat-pill recurring ${diagnosticFilter === "recurring" ? "active" : ""}`}
                  onClick={() => setDiagnosticFilter("recurring")}
                >
                  <span className="pill-count">{mistakeReport.recurringMistakes.length}</span>
                  <span className="pill-label">🔁 Recurring Mistakes</span>
                </button>
              )}
            </div>
          </div>

          {/* DIAGNOSTIC ISSUE CARDS LIST */}
          {mistakeReport.totalErrors === 0 ? (
            <div className="diag-mastery-banner">
              <span className="star-icon">🌟</span>
              <div>
                <strong>Flawless Conceptual Mastery!</strong>
                <p>
                  No conceptual errors, misconceptions, or incomplete explanations detected in this examination.
                </p>
              </div>
            </div>
          ) : (
            <div className="diag-cards-list">
              {uniqueDiagIssues.map((issue) => {
                const categoryClass =
                  issue.category === "underlying_misconception"
                    ? "misconception"
                    : issue.category === "incomplete_explanation"
                    ? "incomplete"
                    : issue.category === "formula_method_issue"
                    ? "formula"
                    : "confirmed";

                const categoryLabel =
                  issue.category === "underlying_misconception"
                    ? "🟠 Underlying Misconception"
                    : issue.category === "incomplete_explanation"
                    ? "🟡 Incomplete Written Explanation"
                    : issue.category === "formula_method_issue"
                    ? "🟣 Formula / Method Discrepancy"
                    : "🔴 Confirmed Objective Error";

                return (
                  <div key={issue.questionId} className={`diag-issue-card ${categoryClass}`}>
                    <div className="diag-card-header">
                      <div className="diag-tags-group">
                        <span className={`diag-cat-tag ${categoryClass}`}>
                          {categoryLabel}
                        </span>
                        <span className="diag-topic-tag">{issue.topic}</span>
                        {issue.isRecurring && (
                          <span className="diag-recurring-tag">
                            🔁 Recurring Issue ({issue.previousOccurrences + 1} attempts)
                          </span>
                        )}
                      </div>

                      <div className="diag-marks-lost">
                        Lost: -{issue.lostMarks} / {issue.maxMarks} Marks
                      </div>
                    </div>

                    <h4 className="diag-q-title">{issue.question}</h4>

                    {/* COMPARISON BOX */}
                    <div className="diag-comparison-grid">
                      <div className="comparison-col student-side">
                        <span className="col-label">Your Submitted Answer:</span>
                        <div className="col-box">
                          {issue.studentAnswer && issue.studentAnswer.trim() ? (
                            <p>{issue.studentAnswer}</p>
                          ) : (
                            <em className="text-muted">No response submitted.</em>
                          )}
                        </div>
                      </div>

                      <div className="comparison-col expected-side">
                        <span className="col-label">Reference Model Answer:</span>
                        <div className="col-box">
                          <p>{issue.referenceAnswer || "Review curriculum standard."}</p>
                        </div>
                      </div>
                    </div>

                    {/* EXAMINER DIAGNOSIS & REASONS */}
                    <div className="diag-feedback-box">
                      <span className="diag-box-label">Examiner Evaluation & Root Cause:</span>
                      <p className="diag-main-feedback">{issue.feedback}</p>

                      {issue.mistakes && issue.mistakes.length > 0 && (
                        <div className="diag-points-block misconceptions">
                          <span className="points-label">Identified Misconceptions in Reasoning:</span>
                          <ul>
                            {issue.mistakes.map((m, mIdx) => (
                              <li key={mIdx}>{m}</li>
                            ))}
                          </ul>
                        </div>
                      )}

                      {issue.missingConcepts && issue.missingConcepts.length > 0 && (
                        <div className="diag-points-block missing">
                          <span className="points-label">Missing Prerequisite Points / Steps:</span>
                          <ul>
                            {issue.missingConcepts.map((mc, mcIdx) => (
                              <li key={mcIdx}>{mc}</li>
                            ))}
                          </ul>
                        </div>
                      )}
                    </div>

                    {/* ACTIONABLE RECOMMENDATION */}
                    <div className="diag-recommendation-bar">
                      <span className="rec-icon">💡</span>
                      <div className="rec-copy">
                        <strong>Actionable Next Step:</strong>
                        <p>{issue.recommendation}</p>
                      </div>
                    </div>

                    {/* ACTIONS */}
                    <div className="diag-card-actions">
                      <button
                        type="button"
                        className="q-action-btn tutor-btn"
                        onClick={() =>
                          handleAskAITutor(
                            { question: issue.question },
                            issue.studentAnswer,
                            issue.referenceAnswer,
                            issue.feedback
                          )
                        }
                      >
                        💬 Ask AI Tutor to Clarify This Error
                      </button>

                      <button
                        type="button"
                        className="q-action-btn notes-btn"
                        onClick={() =>
                          handleSaveQuestionToNotes(
                            { id: issue.questionId, question: issue.question, marks: issue.maxMarks },
                            issue.studentAnswer,
                            issue.referenceAnswer,
                            issue.feedback
                          )
                        }
                      >
                        {savedNoteQuestionId === issue.questionId ? "Saved to Notes ✓" : "💾 Save to Notes"}
                      </button>

                      {onOpenStudyPlanner && (
                        <button
                          type="button"
                          className="q-action-btn planner-btn"
                          onClick={() => {
                            onOpenStudyPlanner({
                              subject: issue.topic,
                              topics: [issue.topic],
                              durationDays: 7,
                              dailyMinutes: 30,
                            });
                          }}
                        >
                          ◫ Plan Study for "{issue.topic}"
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* QUESTION-BY-QUESTION REVIEW SECTION */}
        <div className="mock-review-section">
          <div className="mock-review-header-bar">
            <h3>Question-by-Question Detailed Review</h3>

            <div className="mock-filter-tabs">
              <button
                type="button"
                className={`filter-tab ${resultsFilter === "all" ? "active" : ""}`}
                onClick={() => setResultsFilter("all")}
              >
                All ({questions.length})
              </button>
              <button
                type="button"
                className={`filter-tab ${resultsFilter === "correct" ? "active" : ""}`}
                onClick={() => setResultsFilter("correct")}
              >
                High Scores
              </button>
              <button
                type="button"
                className={`filter-tab ${resultsFilter === "needs_work" ? "active" : ""}`}
                onClick={() => setResultsFilter("needs_work")}
              >
                Needs Work
              </button>
              {currentAttempt.markedForReview?.length > 0 && (
                <button
                  type="button"
                  className={`filter-tab ${resultsFilter === "marked" ? "active" : ""}`}
                  onClick={() => setResultsFilter("marked")}
                >
                  Marked for Review ({currentAttempt.markedForReview.length})
                </button>
              )}
            </div>
          </div>

          <div className="mock-questions-review-list">
            {filteredQuestions.map((q, idx) => {
              const ev = evaluations[q.id] || {};
              const studentAnswer = currentAttempt.userAnswers?.[q.id] || "";
              const marksAwarded = Number(ev.marksAwarded) || 0;
              const maxMarks = q.marks || 1;
              const isFullMarks = marksAwarded === maxMarks;
              const isPartialMarks = marksAwarded > 0 && marksAwarded < maxMarks;
              const isZeroMarks = marksAwarded === 0;

              return (
                <div key={q.id} className="mock-review-card">
                  {/* CARD HEADER */}
                  <div className="review-card-top">
                    <div className="review-q-meta">
                      <span className="review-q-num">Question {idx + 1}</span>
                      <span className={`mock-q-type-badge ${q.type}`}>
                        {q.type === "mcq" ? "MCQ" : q.type === "short" ? "Short Answer" : "Long Answer"}
                      </span>
                    </div>

                    <div className="review-marks-tag">
                      <strong className={`marks-won ${isFullMarks ? "full" : isPartialMarks ? "partial" : isZeroMarks ? "zero" : ""}`}>
                        {marksAwarded} / {maxMarks} Marks
                      </strong>
                    </div>
                  </div>

                  {/* QUESTION TEXT */}
                  <h4 className="review-question-text">{q.question}</h4>

                  {/* MCQ OPTIONS REVIEW */}
                  {q.type === "mcq" && (
                    <div className="review-mcq-options">
                      {(q.options || []).map((opt) => {
                        const isStudentChoice = studentAnswer === opt.label;
                        const isCorrectOption = q.correctOption === opt.label;

                        let optClass = "review-opt";
                        if (isCorrectOption) optClass += " correct-opt";
                        if (isStudentChoice && !isCorrectOption) optClass += " wrong-choice";
                        if (isStudentChoice && isCorrectOption) optClass += " correct-choice";

                        return (
                          <div key={opt.label} className={optClass}>
                            <span className="opt-letter">{opt.label}.</span>
                            <span className="opt-text">{opt.text}</span>
                            {isCorrectOption && <span className="opt-status-tag correct">✓ Correct Option</span>}
                            {isStudentChoice && !isCorrectOption && (
                              <span className="opt-status-tag wrong">✕ Your Selection</span>
                            )}
                          </div>
                        );
                      })}

                      {q.explanation && (
                        <div className="review-explanation-box">
                          <strong>Explanation:</strong>
                          <p>{q.explanation}</p>
                        </div>
                      )}
                    </div>
                  )}

                  {/* WRITTEN RESPONSES REVIEW */}
                  {(q.type === "short" || q.type === "long") && (
                    <div className="review-written-blocks">
                      {/* Student's answer */}
                      <div className="review-block student-answer-block">
                        <span className="block-title">Your Submitted Answer:</span>
                        <div className="block-content">
                          {studentAnswer && studentAnswer.trim() ? (
                            <p>{studentAnswer}</p>
                          ) : (
                            <em className="text-muted">No response submitted for this question.</em>
                          )}
                        </div>
                      </div>

                      {/* Reference Model Answer */}
                      <div className="review-block reference-answer-block">
                        <span className="block-title">Reference Model Answer:</span>
                        <div className="block-content">
                          <p>{q.referenceAnswer || "See study material for complete mechanism."}</p>
                        </div>
                      </div>

                      {/* AI Examiner Evaluation & Feedback */}
                      <div className="review-eval-feedback-block">
                        <span className="block-title">Examiner Evaluation:</span>

                        {ev.feedback && (
                          <p className="eval-main-feedback">{ev.feedback}</p>
                        )}

                        <div className="eval-criteria-grid">
                          {ev.strengths && ev.strengths.length > 0 && (
                            <div className="eval-pill-list strengths">
                              <span className="pill-header">✓ Key Strengths:</span>
                              <ul>
                                {ev.strengths.map((s, i) => (
                                  <li key={i}>{s}</li>
                                ))}
                              </ul>
                            </div>
                          )}

                          {ev.missingConcepts && ev.missingConcepts.length > 0 && (
                            <div className="eval-pill-list missing">
                              <span className="pill-header">⚠️ Missing Concepts:</span>
                              <ul>
                                {ev.missingConcepts.map((m, i) => (
                                  <li key={i}>{m}</li>
                                ))}
                              </ul>
                            </div>
                          )}

                          {ev.mistakes && ev.mistakes.length > 0 && (
                            <div className="eval-pill-list mistakes">
                              <span className="pill-header">✕ Identified Misconceptions:</span>
                              <ul>
                                {ev.mistakes.map((mis, i) => (
                                  <li key={i}>{mis}</li>
                                ))}
                              </ul>
                            </div>
                          )}
                        </div>
                      </div>
                    </div>
                  )}

                  {/* ACTION BUTTONS ON QUESTION */}
                  <div className="review-card-actions">
                    <button
                      type="button"
                      className="q-action-btn tutor-btn"
                      onClick={() =>
                        handleAskAITutor(
                          q,
                          studentAnswer,
                          q.referenceAnswer || q.explanation,
                          ev.feedback || ""
                        )
                      }
                      title="Ask personal AI Tutor to break down this question"
                    >
                      💬 Ask AI Tutor
                    </button>

                    <button
                      type="button"
                      className="q-action-btn notes-btn"
                      onClick={() =>
                        handleSaveQuestionToNotes(
                          q,
                          studentAnswer,
                          q.referenceAnswer || q.explanation,
                          ev.feedback || ""
                        )
                      }
                      title="Save this question and model answer to My Notes"
                    >
                      {savedNoteQuestionId === q.id ? "Saved to Notes ✓" : "💾 Save to Notes"}
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    );
  }

  // ============================================
  // RENDER: CREATE MOCK TEST SCREEN
  // ============================================
  if (view === "create") {
    return (
      <div className="mock-test-container">
        <div className="mock-create-card">
          <div className="mock-create-header">
            <button
              type="button"
              className="mock-back-link"
              onClick={() => setView("dashboard")}
            >
              ← Back to Mock Tests
            </button>
            <h2>Configure Mock Examination</h2>
            <p className="welcome-subtitle">
              Design a customized, rigorous assessment grounded in your notes or subject curriculum.
            </p>
          </div>

          {generationError && (
            <div className="mock-error-alert">
              <span>⚠️ {generationError}</span>
            </div>
          )}

          {/* STEP 1: SOURCE MATERIAL */}
          <div className="config-section">
            <label className="config-label">1. Select Source Material</label>
            <div className="config-pills-row">
              <button
                type="button"
                className={`config-pill ${config.sourceType === "notes" ? "active" : ""}`}
                onClick={() => setConfig((p) => ({ ...p, sourceType: "notes" }))}
              >
                📄 Uploaded PDF / Notes
              </button>
              <button
                type="button"
                className={`config-pill ${config.sourceType === "course" ? "active" : ""}`}
                onClick={() => setConfig((p) => ({ ...p, sourceType: "course" }))}
              >
                📚 Course Material
              </button>
              <button
                type="button"
                className={`config-pill ${config.sourceType === "topic" ? "active" : ""}`}
                onClick={() => setConfig((p) => ({ ...p, sourceType: "topic" }))}
              >
                💡 Custom Topic
              </button>
            </div>

            {/* Note selector */}
            {config.sourceType === "notes" && (
              <div className="config-input-wrap">
                {savedNotes.length > 0 ? (
                  <select
                    className="config-select"
                    value={config.selectedNoteId}
                    onChange={(e) =>
                      setConfig((p) => ({ ...p, selectedNoteId: e.target.value }))
                    }
                  >
                    <option value="">-- Choose a study note --</option>
                    {savedNotes.map((note) => (
                      <option key={note.id} value={note.id}>
                        {note.title || note.fileName} ({Math.round((note.text || "").length / 6)} words)
                      </option>
                    ))}
                  </select>
                ) : (
                  <div className="config-empty-hint">
                    No notes uploaded yet. You can upload notes in <strong>My Notes</strong> or configure by <strong>Custom Topic</strong>.
                  </div>
                )}
              </div>
            )}

            {/* Course selector */}
            {config.sourceType === "course" && (
              <div className="config-input-wrap">
                <select
                  className="config-select"
                  value={config.selectedCourseId}
                  onChange={(e) =>
                    setConfig((p) => ({ ...p, selectedCourseId: e.target.value }))
                  }
                >
                  <option value="">-- Choose a course --</option>
                  {courses.map((course) => (
                    <option key={course.id} value={course.id}>
                      {course.icon} {course.name} ({course.category})
                    </option>
                  ))}
                </select>
              </div>
            )}

            {/* Topic input */}
            {config.sourceType === "topic" && (
              <div className="config-input-wrap">
                <input
                  type="text"
                  className="config-text-input"
                  placeholder="e.g. Binary Search Trees & Graph Traversals"
                  value={config.topic}
                  onChange={(e) => setConfig((p) => ({ ...p, topic: e.target.value }))}
                />
                <textarea
                  className="config-sub-textarea"
                  rows={3}
                  placeholder="Optional: Paste specific syllabus topics, lecture snippets, or formula references..."
                  value={config.referenceNotes}
                  onChange={(e) =>
                    setConfig((p) => ({ ...p, referenceNotes: e.target.value }))
                  }
                />
              </div>
            )}
          </div>

          {/* STEP 2: DIFFICULTY */}
          <div className="config-section">
            <label className="config-label">2. Examination Difficulty</label>
            <div className="config-pills-row">
              {["Easy", "Medium", "Hard", "Mixed"].map((diff) => (
                <button
                  key={diff}
                  type="button"
                  className={`config-pill ${config.difficulty === diff ? "active" : ""}`}
                  onClick={() => setConfig((p) => ({ ...p, difficulty: diff }))}
                >
                  {diff}
                </button>
              ))}
            </div>
          </div>

          {/* STEP 3: DURATION */}
          <div className="config-section">
            <label className="config-label">3. Time Allotted</label>
            <div className="config-pills-row">
              {[15, 30, 45, 60].map((dur) => (
                <button
                  key={dur}
                  type="button"
                  className={`config-pill ${config.durationMinutes === dur ? "active" : ""}`}
                  onClick={() => setConfig((p) => ({ ...p, durationMinutes: dur }))}
                >
                  ⏱ {dur} Minutes
                </button>
              ))}
            </div>
          </div>

          {/* STEP 4: QUESTION COUNT */}
          <div className="config-section">
            <label className="config-label">4. Number of Questions</label>
            <div className="config-pills-row">
              {[5, 10, 15, 20].map((cnt) => (
                <button
                  key={cnt}
                  type="button"
                  className={`config-pill ${config.questionCount === cnt ? "active" : ""}`}
                  onClick={() => handleQuestionCountChange(cnt)}
                >
                  {cnt} Questions
                </button>
              ))}
            </div>
          </div>

          {/* STEP 5: QUESTION FORMAT */}
          <div className="config-section">
            <label className="config-label">5. Question Format</label>
            <div className="config-pills-row">
              {[
                { id: "mcq", label: "MCQs Only" },
                { id: "short", label: "Short Answers Only" },
                { id: "long", label: "Long Answers Only" },
                { id: "mixed", label: "Mixed Questions" },
              ].map((fmt) => (
                <button
                  key={fmt.id}
                  type="button"
                  className={`config-pill ${config.format === fmt.id ? "active" : ""}`}
                  onClick={() => setConfig((p) => ({ ...p, format: fmt.id }))}
                >
                  {fmt.label}
                </button>
              ))}
            </div>

            {/* Custom distribution controls for mixed tests */}
            {config.format === "mixed" && (
              <div className="config-distribution-box">
                <span className="dist-title">Mixed Distribution (Total: {config.questionCount} Questions):</span>
                <div className="dist-inputs-row">
                  <div className="dist-cell">
                    <label>MCQs:</label>
                    <input
                      type="number"
                      min={0}
                      max={config.questionCount}
                      value={config.distribution.mcq}
                      onChange={(e) => {
                        const mcq = parseInt(e.target.value, 10) || 0;
                        setConfig((p) => ({
                          ...p,
                          distribution: { ...p.distribution, mcq },
                        }));
                      }}
                    />
                  </div>
                  <div className="dist-cell">
                    <label>Short Answer:</label>
                    <input
                      type="number"
                      min={0}
                      max={config.questionCount}
                      value={config.distribution.short}
                      onChange={(e) => {
                        const short = parseInt(e.target.value, 10) || 0;
                        setConfig((p) => ({
                          ...p,
                          distribution: { ...p.distribution, short },
                        }));
                      }}
                    />
                  </div>
                  <div className="dist-cell">
                    <label>Long Answer:</label>
                    <input
                      type="number"
                      min={0}
                      max={config.questionCount}
                      value={config.distribution.long}
                      onChange={(e) => {
                        const long = parseInt(e.target.value, 10) || 0;
                        setConfig((p) => ({
                          ...p,
                          distribution: { ...p.distribution, long },
                        }));
                      }}
                    />
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* STEP 6: MARKS CONFIGURATION */}
          <div className="config-section">
            <div className="marks-toggle-row">
              <label className="config-label">6. Marks Allocation</label>
              <button
                type="button"
                className="text-toggle-btn"
                onClick={() =>
                  setConfig((p) => ({ ...p, useDefaultMarks: !p.useDefaultMarks }))
                }
              >
                {config.useDefaultMarks ? "Customize Marks" : "Use Default Marks"}
              </button>
            </div>

            {!config.useDefaultMarks ? (
              <div className="custom-marks-row">
                <div className="marks-field">
                  <label>MCQ (marks each):</label>
                  <input
                    type="number"
                    min={1}
                    max={10}
                    value={config.customMarks.mcq}
                    onChange={(e) =>
                      setConfig((p) => ({
                        ...p,
                        customMarks: {
                          ...p.customMarks,
                          mcq: parseInt(e.target.value, 10) || 2,
                        },
                      }))
                    }
                  />
                </div>
                <div className="marks-field">
                  <label>Short Answer:</label>
                  <input
                    type="number"
                    min={1}
                    max={20}
                    value={config.customMarks.short}
                    onChange={(e) =>
                      setConfig((p) => ({
                        ...p,
                        customMarks: {
                          ...p.customMarks,
                          short: parseInt(e.target.value, 10) || 4,
                        },
                      }))
                    }
                  />
                </div>
                <div className="marks-field">
                  <label>Long Answer:</label>
                  <input
                    type="number"
                    min={1}
                    max={50}
                    value={config.customMarks.long}
                    onChange={(e) =>
                      setConfig((p) => ({
                        ...p,
                        customMarks: {
                          ...p.customMarks,
                          long: parseInt(e.target.value, 10) || 8,
                        },
                      }))
                    }
                  />
                </div>
              </div>
            ) : (
              <div className="default-marks-info">
                Default: MCQ = 2 Marks · Short Answer = 4 Marks · Long Answer = 8 Marks
              </div>
            )}

            {/* Total marks callout */}
            <div className="total-marks-preview-banner">
              <span>Total Possible Marks:</span>
              <strong>{calculatedTotalMarks} Marks</strong>
            </div>
          </div>

          {/* ACTIONS */}
          <div className="mock-create-actions">
            <button
              type="button"
              className="secondary-btn"
              onClick={() => setView("dashboard")}
            >
              Cancel
            </button>
            <button
              type="button"
              className="primary-btn pulse-glow"
              disabled={isGenerating}
              onClick={handleGenerateTest}
            >
              {isGenerating ? "Generating Mock Test..." : "Generate Mock Examination ⚡"}
            </button>
          </div>
        </div>
      </div>
    );
  }

  // ============================================
  // RENDER: DASHBOARD VIEW
  // ============================================
  return (
    <div className="mock-test-container">
      {/* HEADER SECTION */}
      <section className="welcome-section">
        <div>
          <div className="eyebrow">
            <span className="live-dot" /> REALISTIC ASSESSMENT & EXAM PREPARATION
          </div>
          <h1>
            Mock Tests<span>.</span>
          </h1>
          <p className="welcome-subtitle">
            Simulate actual examination conditions with timed tests, objective MCQ scoring, and pedagogical AI evaluation for written answers.
          </p>
        </div>

        <button
          type="button"
          className="primary-button"
          onClick={() => {
            setGenerationError("");
            setView("create");
          }}
        >
          <span>✎</span> Create Mock Test <span>↗</span>
        </button>
      </section>

      {/* ACTIVE / IN-PROGRESS TEST BANNER */}
      {activeExamState && (
        <div className="mock-inprogress-alert">
          <div className="inprogress-info">
            <span className="inprogress-pulse" />
            <div>
              <strong>In-Progress Examination Detected:</strong>
              <p>
                You have an active examination session. Your answers and elapsed timer are safely preserved.
              </p>
            </div>
          </div>
          <div className="inprogress-actions">
            <button
              type="button"
              className="secondary-btn small-btn"
              onClick={handleDiscardActiveExam}
            >
              Discard
            </button>
            <button
              type="button"
              className="primary-btn small-btn pulse-glow"
              onClick={handleResumeExam}
            >
              Resume Test ↗
            </button>
          </div>
        </div>
      )}

      {/* REAL METRICS CARDS */}
      <div className="mock-stats-grid">
        <div className="mock-stat-card">
          <span className="stat-card-label">Total Tests Taken</span>
          <strong className="stat-card-val">{metrics.totalAttempts}</strong>
          <span className="stat-card-sub">Completed attempts</span>
        </div>

        <div className="mock-stat-card">
          <span className="stat-card-label">Average Score</span>
          <strong className="stat-card-val">
            {metrics.avgScorePercentage !== null ? `${metrics.avgScorePercentage}%` : "—"}
          </strong>
          <span className="stat-card-sub">Across all attempts</span>
        </div>

        <div className="mock-stat-card">
          <span className="stat-card-label">Best Score</span>
          <strong className="stat-card-val highlight-purple">
            {metrics.bestScorePercentage !== null ? `${metrics.bestScorePercentage}%` : "—"}
          </strong>
          <span className="stat-card-sub">Peak achievement</span>
        </div>

        <div className="mock-stat-card">
          <span className="stat-card-label">Marks Earned</span>
          <strong className="stat-card-val">
            {metrics.totalMarksEarned}{" "}
            <span className="stat-max">/ {metrics.totalPossibleMarks || 0}</span>
          </strong>
          <span className="stat-card-sub">
            MCQ: {metrics.mcqAccuracy ?? "—"}% · Written: {metrics.writtenAccuracy ?? "—"}%
          </span>
        </div>
      </div>

      {/* AI WEAKNESS RADAR & DIAGNOSTIC PATTERNS */}
      {(() => {
        const overallWeaknesses = extractAssessmentWeaknesses(preselectedCourseId || null);
        if (!overallWeaknesses.hasHistory || overallWeaknesses.weakTopics.length === 0) return null;

        return (
          <div className="mock-weakness-radar-panel">
            <div className="radar-header">
              <div>
                <span className="radar-badge">⚡ AI DIAGNOSTIC RADAR</span>
                <h3>Identified Assessment Weaknesses & Mistake Patterns</h3>
                <p>
                  Aggregated from {overallWeaknesses.totalAttemptsAnalyzed} completed assessment attempt(s) across your learning journey.
                </p>
              </div>

              {onOpenStudyPlanner && (
                <button
                  type="button"
                  className="primary-btn pulse-glow radar-plan-btn"
                  onClick={() => {
                    onOpenStudyPlanner({
                      topics: overallWeaknesses.weakTopics.slice(0, 5),
                      durationDays: 14,
                      dailyMinutes: 60,
                    });
                  }}
                  title="Generate a personalized study plan targeting your identified test weaknesses"
                >
                  ⚡ Generate Study Plan for Weak Areas ↗
                </button>
              )}
            </div>

            <div className="radar-topics-row">
              <span className="radar-label">Topics Needing Reinforcement:</span>
              <div className="radar-pills">
                {overallWeaknesses.weakTopics.slice(0, 6).map((topic, idx) => (
                  <span key={idx} className="radar-topic-pill">
                    {topic}
                  </span>
                ))}
              </div>
            </div>

            <div className="radar-stats-summary">
              <div className="radar-stat-box confirmed">
                <strong>{overallWeaknesses.confirmedErrors.length}</strong>
                <span>Confirmed Errors</span>
              </div>
              <div className="radar-stat-box misconception">
                <strong>{overallWeaknesses.misconceptions.length}</strong>
                <span>Misconceptions Detected</span>
              </div>
              <div className="radar-stat-box incomplete">
                <strong>{overallWeaknesses.incompleteExpl.length}</strong>
                <span>Incomplete Answers</span>
              </div>
              <div className="radar-stat-box recurring">
                <strong>{overallWeaknesses.recurringMistakes.length}</strong>
                <span>🔁 Recurring Mistakes</span>
              </div>
            </div>
          </div>
        );
      })()}

      {/* SAVED TESTS LIST & PREVIOUS ATTEMPTS */}
      <div className="mock-tests-list-section">
        <div className="section-header-row">
          <h3>Your Mock Examinations</h3>
          <span className="section-counter">{mockTests.length} Tests Available</span>
        </div>

        {mockTests.length === 0 ? (
          <div className="mock-empty-card">
            <div className="empty-sparkle">📝</div>
            <h3>No Mock Tests Yet</h3>
            <p>
              Generate your first mock test from an uploaded study note, course material, or any topic to identify knowledge gaps and practice under timed conditions.
            </p>
            <button
              type="button"
              className="primary-btn"
              onClick={() => {
                setGenerationError("");
                setView("create");
              }}
            >
              Create Your First Mock Test ↗
            </button>
          </div>
        ) : (
          <div className="mock-cards-grid">
            {mockTests.map((test) => {
              const attempts = test.attempts || [];

              return (
                <div key={test.id} className="mock-card">
                  <div className="mock-card-header">
                    <div className="mock-card-source-tag">
                      {test.sourceType === "course"
                        ? "📚 Course Exam"
                        : test.sourceType === "notes"
                        ? "📄 Notes Exam"
                        : "💡 Topic Exam"}
                    </div>
                    <span className={`mock-diff-tag ${test.difficulty.toLowerCase()}`}>
                      {test.difficulty}
                    </span>
                  </div>

                  <h4 className="mock-card-title">{test.title}</h4>
                  <p className="mock-card-source-name">
                    Source:{" "}
                    {test.courseId && onOpenCourse ? (
                      <button
                        type="button"
                        className="text-button"
                        style={{ padding: 0, fontSize: "inherit", textDecoration: "underline", color: "inherit" }}
                        onClick={() => onOpenCourse(test.courseId)}
                        title="Open source course"
                      >
                        {test.sourceName} ↗
                      </button>
                    ) : test.noteId && onOpenNote ? (
                      <button
                        type="button"
                        className="text-button"
                        style={{ padding: 0, fontSize: "inherit", textDecoration: "underline", color: "inherit" }}
                        onClick={() => {
                          const note = savedNotes.find((n) => n.id === test.noteId);
                          if (note) onOpenNote(note);
                        }}
                        title="Open source note"
                      >
                        {test.sourceName} ↗
                      </button>
                    ) : (
                      test.sourceName
                    )}
                  </p>

                  <div className="mock-card-chips">
                    <span className="chip">⏱ {test.durationMinutes}m</span>
                    <span className="chip">{test.questionCount} Questions</span>
                    <span className="chip">{test.totalMarks} Marks</span>
                  </div>

                  {/* Previous attempts preview */}
                  {attempts.length > 0 && (
                    <div className="mock-attempts-history">
                      <div className="history-label">Previous Attempts ({attempts.length}):</div>
                      <div className="history-list">
                        {attempts.slice(0, 3).map((att) => (
                          <div key={att.id} className="history-item">
                            <span className="att-date">
                              {new Date(att.createdAt || att.submittedAt).toLocaleDateString()}
                            </span>
                            <span className={`att-score-badge ${att.percentage >= 75 ? "good" : att.percentage >= 50 ? "avg" : "low"}`}>
                              {att.score}/{att.totalMarks} ({att.percentage}%)
                            </span>
                            <button
                              type="button"
                              className="att-review-btn"
                              onClick={() => {
                                setCurrentTest(test);
                                setCurrentAttempt(att);
                                setView("results");
                              }}
                            >
                              Review ↗
                            </button>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  <div className="mock-card-actions">
                    <button
                      type="button"
                      className="primary-btn small-btn"
                      onClick={() => handleStartExam(test)}
                    >
                      {attempts.length > 0 ? "Retake Test ↻" : "Start Test ⏱"}
                    </button>
                    <button
                      type="button"
                      className="danger-text-btn"
                      onClick={() => deleteMockTest(test.id)}
                      title="Delete this test"
                    >
                      Delete
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
