import { useRef, useState, useEffect } from "react";
import { extractTextFromPDF } from "../utils/pdfReader";
import MarkdownRenderer from "./MarkdownRenderer";
import { cleanMarkdown, parseFlashcards } from "../utils/aiFormatters";
import MCQViewer from "./MCQViewer";
import TopicCards from "./TopicCards";
import {
  getSavedNotes,
  saveStudyNote,
  deleteStudyNote,
  getCourses,
  saveFlashcardDeck,
} from "../utils/storage";
import { apiFetch, getApiErrorMessage } from "../utils/api";

const AI_TASKS = [
  {
    id: "summarize",
    icon: "✦",
    title: "AI Summary",
    description: "Understand the main ideas quickly.",
  },
  {
    id: "topics",
    icon: "🧠",
    title: "Analyze Topics",
    description: "Discover topics and their difficulty.",
  },
  {
    id: "mcqs",
    icon: "✎",
    title: "Generate MCQs",
    description: "Practice with custom question counts.",
  },
  {
    id: "revision",
    icon: "▤",
    title: "Revision Notes",
    description: "Create concise exam revision notes.",
  },
];

const MCQ_COUNT_OPTIONS = [5, 10, 15, 20];

export default function Notes({
  document: propDocument,
  setDocument: propSetDocument,
  initialNoteId = null,
} = {}) {
  const fileInputRef = useRef(null);

  const initialNote = initialNoteId ? getSavedNotes().find((n) => n.id === initialNoteId) : null;

  const [localDocument, setLocalDocument] = useState(() => initialNote || null);
  const document = propDocument !== undefined ? propDocument : localDocument;
  const setDocument = propSetDocument || setLocalDocument;

  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState("");
  const [copied, setCopied] = useState(false);

  // AI Task state
  const [aiTask, setAiTask] = useState("");
  const [lastCompletedTask, setLastCompletedTask] = useState(() => {
    if (initialNote?.summary) return "summarize";
    if (initialNote?.mcqs) return "mcqs";
    if (initialNote?.topics) return "topics";
    if (initialNote?.revision) return "revision";
    return "";
  });
  const [aiResult, setAiResult] = useState(() => {
    if (initialNote) {
      return (
        initialNote.summary ||
        initialNote.mcqs ||
        initialNote.topics ||
        initialNote.revision ||
        ""
      );
    }
    return "";
  });
  const [aiError, setAiError] = useState("");
  const [question, setQuestion] = useState("");
  const [mcqCount, setMcqCount] = useState(() => initialNote?.mcqCount || 5);
  const [materialSaved, setMaterialSaved] = useState(false);
  const [flashcardsSaved, setFlashcardsSaved] = useState(false);

  // Persistent Library state
  const [savedNotes, setSavedNotes] = useState(() => getSavedNotes());
  const [courses, setCourses] = useState(() => getCourses());
  const [selectedCourseId, setSelectedCourseId] = useState(() => initialNote?.courseId || "");
  const [noteSearchQuery, setNoteSearchQuery] = useState("");

  // Document action menu state for Saved Documents
  const [openMenuNoteId, setOpenMenuNoteId] = useState(null);

  // Document deletion confirmation dialog state
  const [documentPendingDelete, setDocumentPendingDelete] = useState(null);
  const [isDeleting, setIsDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState("");

  useEffect(() => {
    function handleGlobalClick(e) {
      if (openMenuNoteId) {
        if (e.target.closest && e.target.closest(".notes-item-actions-wrapper")) {
          return;
        }
        setOpenMenuNoteId(null);
      }
    }

    function handleKeyDown(e) {
      if (e.key === "Escape") {
        if (documentPendingDelete && !isDeleting) {
          setDocumentPendingDelete(null);
          setDeleteError("");
        } else if (openMenuNoteId) {
          setOpenMenuNoteId(null);
        }
      }
    }

    window.addEventListener("mousedown", handleGlobalClick);
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("mousedown", handleGlobalClick);
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [openMenuNoteId, documentPendingDelete, isDeleting]);

  function refreshLibrary() {
    setSavedNotes(getSavedNotes());
    setCourses(getCourses());
  }

  useEffect(() => {
    const handleSync = () => refreshLibrary();
    window.addEventListener("studyflow_storage_sync", handleSync);
    return () => window.removeEventListener("studyflow_storage_sync", handleSync);
  }, []);

  // If opened with a different initialNoteId later
  const prevInitialNoteIdRef = useRef(initialNoteId);
  useEffect(() => {
    if (initialNoteId && initialNoteId !== prevInitialNoteIdRef.current) {
      prevInitialNoteIdRef.current = initialNoteId;
      const note = getSavedNotes().find((n) => n.id === initialNoteId);
      if (note) {
        queueMicrotask(() => {
          setDocument(note);
          setSelectedCourseId(note.courseId || "");
          if (note.mcqCount) setMcqCount(note.mcqCount);
          if (note.summary) {
            setAiResult(note.summary);
            setLastCompletedTask("summarize");
          } else if (note.mcqs) {
            setAiResult(note.mcqs);
            setLastCompletedTask("mcqs");
          } else if (note.topics) {
            setAiResult(note.topics);
            setLastCompletedTask("topics");
          } else if (note.revision) {
            setAiResult(note.revision);
            setLastCompletedTask("revision");
          }
        });
      }
    }
  }, [initialNoteId, setDocument]);

  async function handleFileChange(event) {
    const file = event.target.files?.[0];
    if (!file) return;

    setError("");
    setAiError("");
    setAiResult("");
    setAiTask("");
    setLastCompletedTask("");
    setDocument(null);
    setCopied(false);
    setIsLoading(true);

    try {
      const result = await extractTextFromPDF(file);
      // Automatically save new document into persistent library
      const saved = saveStudyNote({
        title: result.fileName,
        fileName: result.fileName,
        pageCount: result.pageCount,
        text: result.text,
        courseId: selectedCourseId || null,
      });

      setDocument(saved);
      refreshLibrary();
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Unable to read this PDF."
      );
    } finally {
      setIsLoading(false);
      event.target.value = "";
    }
  }

  function handleSelectSavedNote(note) {
    setOpenMenuNoteId(null);
    setDocument(note);
    setSelectedCourseId(note.courseId || "");
    if (note.mcqCount) setMcqCount(note.mcqCount);
    setError("");
    setAiError("");

    // Restore previously saved AI outputs if available
    if (note.summary) {
      setAiResult(note.summary);
      setLastCompletedTask("summarize");
    } else if (note.mcqs) {
      setAiResult(note.mcqs);
      setLastCompletedTask("mcqs");
    } else if (note.topics) {
      setAiResult(note.topics);
      setLastCompletedTask("topics");
    } else if (note.revision) {
      setAiResult(note.revision);
      setLastCompletedTask("revision");
    } else {
      setAiResult("");
      setLastCompletedTask("");
    }
  }

  function handleDeleteSavedNote(id, title, e) {
    if (e) e.stopPropagation();
    setOpenMenuNoteId(null);
    setDeleteError("");
    const target = savedNotes.find((n) => n.id === id) || { id, title };
    setDocumentPendingDelete(target);
  }

  async function handleConfirmDelete() {
    if (!documentPendingDelete || isDeleting) return;
    setIsDeleting(true);
    setDeleteError("");
    try {
      const idToDelete = documentPendingDelete.id;
      deleteStudyNote(idToDelete);
      if (document?.id === idToDelete) {
        setDocument(null);
        setAiResult("");
      }
      refreshLibrary();
      setDocumentPendingDelete(null);
    } catch (err) {
      setDeleteError(err?.message || "Failed to delete document. Please try again.");
    } finally {
      setIsDeleting(false);
    }
  }

  function handleCancelDelete() {
    if (isDeleting) return;
    setDocumentPendingDelete(null);
    setDeleteError("");
  }

  function handleCourseChange(courseId) {
    setSelectedCourseId(courseId);
    if (document?.id) {
      saveStudyNote({
        ...document,
        courseId: courseId || null,
      });
      refreshLibrary();
    }
  }

  async function copyText() {
    if (!document?.text) return;
    try {
      await navigator.clipboard.writeText(document.text);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      setError("Unable to copy text. Please select and copy it manually.");
    }
  }

  async function copyAIResult() {
    if (!aiResult) return;
    try {
      const cleanText = cleanMarkdown(aiResult);
      await navigator.clipboard.writeText(cleanText);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      setAiError("Unable to copy the AI response. Please copy it manually.");
    }
  }

  async function runAITask(task, customQuestion = "", countOverride = null, append = false) {
    if (!document?.text) {
      setAiError("Please upload or select a note first.");
      return;
    }

    if (aiTask) return; // Prevent duplicate submissions

    setAiTask(task);
    setAiError("");
    if (!append) {
      setAiResult("");
      setMaterialSaved(false);
    }

    const effectiveCount = countOverride || (task === "mcqs" ? mcqCount : undefined);

    try {
      const payload = {
        task,
        text: document.text,
        question: customQuestion,
        count: effectiveCount,
      };

      const response = await apiFetch("/api/ai", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
      });

      const data = await response.json().catch(() => ({}));

      if (!response.ok) {
        throw new Error(
          data.error || "The AI request failed. Please try again."
        );
      }

      let generated = data.result || "The AI did not return a response.";
      if (append && aiResult) {
        generated = `${aiResult}\n\n---\n\n${generated}`;
      }

      setAiResult(generated);
      setLastCompletedTask(task);

      // Automatically persist the generated material to this note
      if (document?.id) {
        const updatePayload = {
          ...document,
          courseId: selectedCourseId || document.courseId,
        };
        if (task === "summarize") updatePayload.summary = generated;
        if (task === "topics") updatePayload.topics = generated;
        if (task === "mcqs") {
          updatePayload.mcqs = generated;
          updatePayload.mcqCount = mcqCount;
        }
        if (task === "revision") updatePayload.revision = generated;

        saveStudyNote(updatePayload);
        refreshLibrary();
      }
    } catch (err) {
      setAiError(getApiErrorMessage(err));
    } finally {
      setAiTask("");
    }
  }

  function handleSaveMaterialManually() {
    if (!document?.id || !aiResult) return;

    const updatePayload = {
      ...document,
      courseId: selectedCourseId || document.courseId,
    };
    if (lastCompletedTask === "summarize") updatePayload.summary = aiResult;
    if (lastCompletedTask === "topics") updatePayload.topics = aiResult;
    if (lastCompletedTask === "mcqs") updatePayload.mcqs = aiResult;
    if (lastCompletedTask === "revision") updatePayload.revision = aiResult;

    saveStudyNote(updatePayload);
    refreshLibrary();
    setMaterialSaved(true);
    setTimeout(() => setMaterialSaved(false), 2500);
  }

  async function handleGenerateFlashcards() {
    if (!document?.text || aiTask) return;

    setAiTask("flashcards");
    setAiError("");

    try {
      const response = await apiFetch("/api/ai", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          task: "flashcards",
          text: document.text,
        }),
      });

      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Failed to generate flashcards.");

      const cards = parseFlashcards(data.result);
      if (cards.length > 0) {
        saveFlashcardDeck({
          title: `${document.fileName || "Note"} Flashcards`,
          courseId: selectedCourseId || document.courseId,
          noteId: document.id,
          cards,
        });
        setFlashcardsSaved(true);
        setTimeout(() => setFlashcardsSaved(false), 3000);
      }
    } catch (err) {
      setAiError(getApiErrorMessage(err));
    } finally {
      setAiTask("");
    }
  }

  function handleAskAI(event) {
    event.preventDefault();
    const trimmedQuestion = question.trim();
    if (!trimmedQuestion) {
      setAiError("Please type a question first.");
      return;
    }
    runAITask("ask", trimmedQuestion);
  }

  // Filtered notes in library
  const filteredNotes = savedNotes.filter((n) =>
    (n.title || n.fileName || "").toLowerCase().includes(noteSearchQuery.toLowerCase())
  );

  return (
    <section className="notes-page">
      <div className="notes-heading">
        <div>
          <div className="notes-eyebrow">YOUR KNOWLEDGE LIBRARY</div>
          <h1>
            My Notes<span>.</span>
          </h1>
          <p>
            Upload lecture PDFs, organize materials by course, and generate AI-powered study materials.
          </p>
        </div>

        <div className="notes-heading-icon">▤</div>
      </div>

      {/* TOP ACTION BAR: UPLOAD CARD & SAVED NOTES QUICK BAR */}
      <div className="notes-top-split">
        <div className="notes-upload-card">
          <div className="notes-upload-icon">↑</div>
          <h2>Bring your learning materials</h2>
          <p>Choose a text-based PDF of lecture notes or textbook chapters.</p>

          <input
            ref={fileInputRef}
            type="file"
            accept=".pdf,application/pdf"
            onChange={handleFileChange}
            hidden
          />

          <button
            className="notes-upload-button"
            onClick={() => fileInputRef.current?.click()}
            disabled={isLoading || Boolean(aiTask)}
          >
            {isLoading ? "Reading your PDF..." : "Choose a PDF"}
            {!isLoading && <span> ↗</span>}
          </button>

          <div className="notes-file-hint">
            Extracts searchable text · Saves to your library
          </div>
        </div>

        {/* SAVED NOTES SIDE PANEL */}
        <div className="notes-library-panel">
          <div className="notes-library-header">
            <h3>Saved Documents ({savedNotes.length})</h3>
            {savedNotes.length > 2 && (
              <input
                type="text"
                className="notes-search-input"
                placeholder="Search notes..."
                value={noteSearchQuery}
                onChange={(e) => setNoteSearchQuery(e.target.value)}
              />
            )}
          </div>

          {savedNotes.length === 0 ? (
            <div className="notes-library-empty">
              <span>✦</span>
              <p>No saved notes yet. Upload your first PDF to begin.</p>
            </div>
          ) : (
            <div className="notes-saved-list">
              {filteredNotes.map((note) => {
                const isCurrent = document?.id === note.id;
                const course = courses.find((c) => c.id === note.courseId);
                const isMenuOpen = openMenuNoteId === note.id;

                return (
                  <div
                    key={note.id}
                    className={`notes-saved-item ${isCurrent ? "is-active" : ""}`}
                    onClick={() => handleSelectSavedNote(note)}
                  >
                    <div className="notes-saved-item-icon">📄</div>
                    <div className="notes-saved-item-info">
                      <strong>{note.title || note.fileName}</strong>
                      <div className="notes-saved-meta">
                        <span>{note.pageCount} {note.pageCount === 1 ? "page" : "pages"}</span>
                        {course && (
                          <span className="notes-course-tag" style={{ "--c-color": course.color }}>
                            {course.icon} {course.name}
                          </span>
                        )}
                        {(note.summary || note.mcqs || note.revision) && (
                          <span className="notes-has-ai-tag">✦ AI Ready</span>
                        )}
                      </div>
                    </div>

                    <div
                      className="notes-item-actions-wrapper"
                      onClick={(e) => e.stopPropagation()}
                    >
                      <button
                        type="button"
                        className="notes-item-action-trigger"
                        onClick={(e) => {
                          e.stopPropagation();
                          setOpenMenuNoteId((prev) => (prev === note.id ? null : note.id));
                        }}
                        aria-label={`Actions for ${note.title || note.fileName}`}
                        aria-haspopup="true"
                        aria-expanded={isMenuOpen}
                        title="Document actions"
                      >
                        ⋮
                      </button>

                      {isMenuOpen && (
                        <div
                          className="notes-item-menu-dropdown"
                          role="menu"
                          onClick={(e) => e.stopPropagation()}
                        >
                          <button
                            type="button"
                            className="notes-item-menu-delete"
                            role="menuitem"
                            onClick={(e) => {
                              e.stopPropagation();
                              handleDeleteSavedNote(note.id, note.title || note.fileName, e);
                            }}
                          >
                            <span className="menu-btn-icon" aria-hidden="true">🗑</span>
                            <span>Delete</span>
                          </button>
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {error && (
        <div className="notes-error" role="alert">
          <strong>Something went wrong</strong>
          <p>{error}</p>
        </div>
      )}

      {isLoading && (
        <div className="notes-status" role="status">
          <div className="notes-spinner"></div>
          <div>
            <strong>Reading your notes...</strong>
            <p>
              Extracting text from your PDF. Larger documents may take longer.
            </p>
          </div>
        </div>
      )}

      {/* ACTIVE DOCUMENT WORKSPACE */}
      {document && !isLoading && (
        <>
          <div className="notes-document-card">
            <div className="notes-document-header">
              <div className="notes-pdf-icon">PDF</div>

              <div className="notes-document-info">
                <h2>{document.title || document.fileName}</h2>
                <p>
                  {document.pageCount}{" "}
                  {document.pageCount === 1 ? "page" : "pages"} · Text
                  extracted successfully
                </p>
              </div>

              {/* Course Association Selector */}
              <div className="notes-course-select-wrap">
                <label htmlFor="course-select">Course:</label>
                <select
                  id="course-select"
                  value={selectedCourseId}
                  onChange={(e) => handleCourseChange(e.target.value)}
                  className="notes-course-select"
                >
                  <option value="">No Course Assigned</option>
                  {courses.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
              </div>

              <button className="notes-copy-button" onClick={copyText}>
                {copied ? "Copied ✓" : "Copy text"}
              </button>
            </div>

            <div className="notes-extracted-label">
              <span>EXTRACTED CONTENT</span>
              <span>{document.text.length.toLocaleString()} characters</span>
            </div>

            <pre className="notes-extracted-text">{document.text}</pre>
          </div>

          {/* AI ACTIONS SECTION */}
          <div className="notes-ai-section">
            <div className="notes-ai-heading">
              <div>
                <div className="notes-eyebrow">
                  YOUR PERSONAL STUDY ASSISTANT
                </div>
                <h2>
                  Learn smarter with AI<span>.</span>
                </h2>
                <p>
                  Select a tool below to transform your notes into summaries, custom practice questions, or flashcards.
                </p>
              </div>

              <div className="notes-ai-badge">✦ Groq AI Active</div>
            </div>

            {/* MCQ QUESTION COUNT CONFIGURATOR */}
            <div className="notes-mcq-config-bar">
              <span className="mcq-config-label">
                ✎ Practice Quiz Question Count:
              </span>
              <div className="mcq-count-chips">
                {MCQ_COUNT_OPTIONS.map((count) => (
                  <button
                    key={count}
                    type="button"
                    className={`mcq-count-chip ${mcqCount === count ? "active" : ""}`}
                    onClick={() => setMcqCount(count)}
                    disabled={Boolean(aiTask)}
                  >
                    {count} Questions
                  </button>
                ))}
              </div>
            </div>

            <div className="notes-ai-grid">
              {AI_TASKS.map((task) => (
                <button
                  key={task.id}
                  className={`notes-ai-tool ${
                    aiTask === task.id ? "is-active" : ""
                  }`}
                  onClick={() => runAITask(task.id)}
                  disabled={Boolean(aiTask)}
                >
                  <span className="notes-ai-tool-icon">{task.icon}</span>
                  <strong>{task.title}</strong>
                  <span className="notes-ai-tool-description">
                    {task.id === "mcqs"
                      ? `Generate ${mcqCount} high-yield practice questions.`
                      : task.description}
                  </span>
                  <span className="notes-ai-tool-action">
                    {aiTask === task.id ? "Generating..." : "Generate →"}
                  </span>
                </button>
              ))}
            </div>

            {/* FAST FLASHCARD GENERATOR SHORTCUT */}
            <div className="notes-flashcard-banner">
              <div className="notes-fc-info">
                <span>🗂</span>
                <div>
                  <strong>Turn this document into Revision Flashcards</strong>
                  <p>Creates 8-10 interactive cards with spaced repetition scheduling.</p>
                </div>
              </div>
              <button
                type="button"
                className="notes-fc-btn"
                onClick={handleGenerateFlashcards}
                disabled={Boolean(aiTask)}
              >
                {aiTask === "flashcards"
                  ? "Creating Deck..."
                  : flashcardsSaved
                  ? "Saved to Revision ✓"
                  : "Generate Flashcards ↗"}
              </button>
            </div>

            {/* ASK QUESTION FORM */}
            <form className="notes-ask-form" onSubmit={handleAskAI}>
              <div className="notes-ask-icon">✧</div>

              <div className="notes-ask-content">
                <h3>Ask a question about your notes</h3>
                <p>Get an explanation grounded in {document.fileName || "your notes"}.</p>

                <textarea
                  className="notes-question-input"
                  value={question}
                  onChange={(event) => setQuestion(event.target.value)}
                  placeholder="For example: Explain the most important concept in these notes step by step..."
                  rows={3}
                  disabled={Boolean(aiTask)}
                />

                <button
                  type="submit"
                  className="notes-ask-button"
                  disabled={Boolean(aiTask) || !question.trim()}
                >
                  {aiTask === "ask" ? "Thinking..." : "Ask Groq ↗"}
                </button>
              </div>
            </form>

            {aiError && (
              <div className="notes-error" role="alert">
                <div className="notes-error-content">
                  <strong>Notice</strong>
                  <p>{aiError}</p>
                </div>
                <button
                  type="button"
                  className="notes-error-close"
                  onClick={() => setAiError("")}
                  aria-label="Dismiss error"
                >
                  ✕
                </button>
              </div>
            )}

            {aiTask && (
              <div className="notes-status" role="status">
                <div className="notes-spinner"></div>
                <div>
                  <strong>
                    {aiTask === "mcqs"
                      ? `Generating ${mcqCount} practice questions...`
                      : aiTask === "flashcards"
                      ? "Creating flashcard deck..."
                      : "Your AI study material is being prepared..."}
                  </strong>
                  <p>
                    Groq is processing your notes with rate-limit protections.
                    This usually takes a few seconds.
                  </p>
                </div>
              </div>
            )}

            {/* ARTIFACT SWITCHER BAR FOR ACTIVE DOCUMENT */}
            {document && (document.summary || document.topics || document.mcqs || document.revision) && (
              <div className="notes-artifact-nav">
                <span className="artifact-nav-label">📑 Generated Content:</span>
                <div className="artifact-nav-buttons">
                  {document.summary && (
                    <button
                      type="button"
                      className={`artifact-nav-chip ${lastCompletedTask === "summarize" ? "active" : ""}`}
                      onClick={() => {
                        setAiResult(document.summary);
                        setLastCompletedTask("summarize");
                      }}
                    >
                      ✦ Summary
                    </button>
                  )}
                  {document.topics && (
                    <button
                      type="button"
                      className={`artifact-nav-chip ${lastCompletedTask === "topics" ? "active" : ""}`}
                      onClick={() => {
                        setAiResult(document.topics);
                        setLastCompletedTask("topics");
                      }}
                    >
                      🧠 Topics
                    </button>
                  )}
                  {document.mcqs && (
                    <button
                      type="button"
                      className={`artifact-nav-chip ${lastCompletedTask === "mcqs" ? "active" : ""}`}
                      onClick={() => {
                        setAiResult(document.mcqs);
                        setLastCompletedTask("mcqs");
                        if (document.mcqCount) setMcqCount(document.mcqCount);
                      }}
                    >
                      ✎ Practice Quiz ({document.mcqCount || mcqCount}Q)
                    </button>
                  )}
                  {document.revision && (
                    <button
                      type="button"
                      className={`artifact-nav-chip ${lastCompletedTask === "revision" ? "active" : ""}`}
                      onClick={() => {
                        setAiResult(document.revision);
                        setLastCompletedTask("revision");
                      }}
                    >
                      ▤ Revision Notes
                    </button>
                  )}
                </div>
              </div>
            )}

            {aiResult && !aiTask && (
              <div className="notes-ai-result">
                <div className="notes-ai-result-header">
                  <div className="notes-ai-result-title-group">
                    <div className="notes-result-task-icon">
                      {AI_TASKS.find((t) => t.id === lastCompletedTask)?.icon ||
                        (lastCompletedTask === "ask" ? "✧" : "✦")}
                    </div>
                    <div>
                      <span className="notes-eyebrow">
                        YOUR GENERATED CONTENT
                      </span>
                      <h3>
                        {AI_TASKS.find((t) => t.id === lastCompletedTask)?.title ||
                          (lastCompletedTask === "ask"
                            ? "AI Tutor Explanation"
                            : "AI Study Material")}
                      </h3>
                    </div>
                  </div>

                  <div className="notes-ai-result-actions">
                    <button
                      className="notes-save-material-btn"
                      onClick={handleSaveMaterialManually}
                      type="button"
                    >
                      {materialSaved ? "Saved to Note ✓" : "💾 Save to Note"}
                    </button>
                    <button
                      className="notes-copy-button"
                      onClick={copyAIResult}
                      type="button"
                    >
                      {copied ? "Copied ✓" : "Copy response"}
                    </button>
                  </div>
                </div>

                <div className="notes-ai-result-content">
                  {lastCompletedTask === "mcqs" ? (
                    <MCQViewer
                      content={aiResult}
                      requestedCount={document?.mcqCount || mcqCount}
                      quizTitle={`${document.title || document.fileName} Quiz`}
                      courseId={selectedCourseId || document.courseId}
                      noteId={document.id}
                      onAttemptSaved={refreshLibrary}
                      onRegenerate={() => runAITask("mcqs")}
                      onGenerateMore={(missing) => runAITask("mcqs", "", missing, true)}
                    />
                  ) : lastCompletedTask === "topics" ? (
                    <TopicCards content={aiResult} />
                  ) : (
                    <MarkdownRenderer content={aiResult} />
                  )}
                </div>

                <div className="notes-ai-result-footer">
                  <span>
                    ✦ Grounded in <strong>{document.fileName || document.title}</strong>
                  </span>
                  <span>
                    {document.pageCount}{" "}
                    {document.pageCount === 1 ? "page" : "pages"}
                  </span>
                </div>
              </div>
            )}
          </div>
        </>
      )}

      {!document && !isLoading && !error && (
        <div className="notes-empty-state">
          <div className="notes-empty-icon">✧</div>
          <h3>Your learning library starts here</h3>
          <p>
            Upload your lecture notes or choose a saved note from the right to begin building your study workflows.
          </p>
        </div>
      )}

      {/* DOCUMENT DELETION CONFIRMATION DIALOG */}
      {documentPendingDelete && (
        <div
          className="modal-overlay"
          style={{ zIndex: 3000 }}
          onClick={handleCancelDelete}
        >
          <div
            className="modal-content notes-delete-modal"
            style={{ maxWidth: "440px" }}
            onClick={(e) => e.stopPropagation()}
            role="dialog"
            aria-modal="true"
            aria-labelledby="delete-dialog-title"
          >
            <div className="modal-header">
              <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
                <span style={{ fontSize: "20px" }}>🗑</span>
                <h3 id="delete-dialog-title" style={{ margin: 0, color: "#1c1a2e" }}>
                  Delete Document?
                </h3>
              </div>
              <button
                type="button"
                className="modal-close-btn"
                onClick={handleCancelDelete}
                disabled={isDeleting}
                aria-label="Close dialog"
              >
                ✕
              </button>
            </div>

            <div style={{ padding: "16px 0 20px" }}>
              <p style={{ margin: "0 0 10px", fontSize: "14px", color: "#39354f", lineHeight: 1.6 }}>
                Are you sure you want to delete{" "}
                <strong>
                  "{documentPendingDelete.title || documentPendingDelete.fileName}"
                </strong>
                ?
              </p>
              <p style={{ margin: 0, fontSize: "12.5px", color: "#67637e" }}>
                This action cannot be undone. Any AI summaries and study materials associated with this note will be removed.
              </p>
              {deleteError && (
                <div style={{ marginTop: "12px", color: "#dc2626", fontSize: "13px", fontWeight: 600 }}>
                  ⚠️ {deleteError}
                </div>
              )}
            </div>

            <div className="modal-actions" style={{ justifyContent: "flex-end", gap: "10px" }}>
              <button
                type="button"
                className="btn-secondary"
                onClick={handleCancelDelete}
                disabled={isDeleting}
              >
                Cancel
              </button>
              <button
                type="button"
                className="btn-danger-small"
                style={{ padding: "9px 18px", fontSize: "13.5px" }}
                disabled={isDeleting}
                onClick={handleConfirmDelete}
              >
                {isDeleting ? "Deleting..." : "Confirm Delete"}
              </button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
