import { useState, useEffect } from "react";
import "./App.css";
import Notes from "./components/Notes";
import MarkdownRenderer from "./components/MarkdownRenderer";
import { cleanMarkdown } from "./utils/aiFormatters";
import OverviewTab from "./components/OverviewTab";
import CoursesTab from "./components/CoursesTab";
import RevisionTab from "./components/RevisionTab";
import AnalyticsTab from "./components/AnalyticsTab";
import GoalsTab from "./components/GoalsTab";
import WorkspaceModal from "./components/WorkspaceModal";
import MockTestsTab from "./components/MockTestsTab";
import StudyPlannerTab from "./components/StudyPlannerTab";
import { getSavedNotes, logStudySession } from "./utils/storage";
import { apiFetch, getApiErrorMessage } from "./utils/api";

function App() {
  const DEFAULT_TUTOR_MESSAGES = [
    {
      role: "assistant",
      text: "Hey! 👋 I'm your StudyFlow AI Tutor. Ask me any study question, break down difficult lecture notes, or request a practice challenge.",
    },
  ];

  const [activePage, setActivePage] = useState("Overview");
  const [question, setQuestion] = useState("");
  const [document, setDocument] = useState(null);
  const [openedNoteId, setOpenedNoteId] = useState(null);
  const [openedCourseId, setOpenedCourseId] = useState(null);
  const [openedMockCourseId, setOpenedMockCourseId] = useState(null);
  const [openedPlannerConfig, setOpenedPlannerConfig] = useState(null);
  const [isLoading, setIsLoading] = useState(false);
  const [tutorError, setTutorError] = useState("");
  const [isWorkspaceModalOpen, setIsWorkspaceModalOpen] = useState(false);

  const [savedNotes, setSavedNotes] = useState(() => getSavedNotes());

  const [messages, setMessages] = useState(() => {
    try {
      const saved = localStorage.getItem("studyflow_tutor_messages_v1");
      if (saved) {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed) && parsed.length > 0) return parsed;
      }
    } catch {
      // ignore
    }
    return DEFAULT_TUTOR_MESSAGES;
  });

  useEffect(() => {
    const handleSync = () => setSavedNotes(getSavedNotes());
    window.addEventListener("studyflow_storage_sync", handleSync);
    return () => window.removeEventListener("studyflow_storage_sync", handleSync);
  }, []);

  function handleOpenNote(note) {
    setDocument(note);
    setOpenedNoteId(note.id);
    setActivePage("My Notes");
  }

  function handleOpenCourse(courseId = null) {
    setOpenedCourseId(courseId);
    setActivePage("My Courses");
  }

  function handleOpenMockTestForCourse(courseId = null) {
    setOpenedMockCourseId(courseId);
    setActivePage("Mock Tests");
  }

  function handleOpenStudyPlanner(config = null) {
    setOpenedPlannerConfig(config);
    setActivePage("Study Planner");
  }

  function handleSendToAITutor(questionText) {
    setQuestion(questionText);
    setActivePage("AI Tutor");
  }

  function clearChat() {
    setMessages(DEFAULT_TUTOR_MESSAGES);
    try {
      localStorage.setItem(
        "studyflow_tutor_messages_v1",
        JSON.stringify(DEFAULT_TUTOR_MESSAGES)
      );
    } catch {
      // ignore
    }
    setTutorError("");
  }

  async function askAssistant(event) {
    if (event) event.preventDefault();

    const trimmedQuestion = question.trim();
    if (!trimmedQuestion || isLoading) return;

    setTutorError("");
    setIsLoading(true);
    setQuestion("");

    // Append user question
    const updatedWithUser = [...messages, { role: "user", text: trimmedQuestion }];
    setMessages(updatedWithUser);
    try {
      localStorage.setItem("studyflow_tutor_messages_v1", JSON.stringify(updatedWithUser));
    } catch {
      // ignore
    }

    try {
      const recentHistory = messages
        .filter((m) => !m.isError && typeof m.text === "string" && m.text.trim())
        .slice(-4)
        .map((m) => ({
          role: m.role,
          text: m.text.slice(0, 300),
        }));

      const payload = {
        task: "ask",
        text: document?.text || "",
        question: trimmedQuestion,
        history: recentHistory,
      };

      const response = await apiFetch("/api/ai", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      const data = await response.json().catch(() => ({}));

      if (!response.ok) {
        throw new Error(data.error || "The AI request failed. Please try again.");
      }

      const answer = data.result?.trim();
      if (!answer) {
        throw new Error("The AI did not generate a response. Please try again.");
      }

      const updatedWithAnswer = [
        ...updatedWithUser,
        {
          role: "assistant",
          text: answer,
          source: document?.text ? "notes" : "general",
        },
      ];
      setMessages(updatedWithAnswer);
      try {
        localStorage.setItem("studyflow_tutor_messages_v1", JSON.stringify(updatedWithAnswer));
      } catch {
        // ignore
      }

      // Automatically log a study session (3 min) for asking tutor
      logStudySession({
        type: "tutor",
        durationMinutes: 3,
        noteId: document?.id || null,
        courseId: document?.courseId || null,
        title: `AI Tutor Question: ${trimmedQuestion.slice(0, 45)}...`,
      });
    } catch (err) {
      const friendlyMessage = getApiErrorMessage(err);

      setTutorError(friendlyMessage);
      const updatedWithError = [
        ...updatedWithUser,
        {
          role: "assistant",
          text: `⚠️ ${friendlyMessage}`,
          isError: true,
        },
      ];
      setMessages(updatedWithError);
      try {
        localStorage.setItem("studyflow_tutor_messages_v1", JSON.stringify(updatedWithError));
      } catch {
        // ignore
      }
    } finally {
      setIsLoading(false);
    }
  }

  const navigation = [
    {
      section: "LEARN",
      items: [
        { icon: "▦", label: "Overview" },
        { icon: "▤", label: "My Courses" },
        { icon: "◫", label: "Study Planner" },
        { icon: "✎", label: "Mock Tests" },
        { icon: "✧", label: "AI Tutor" },
        { icon: "▧", label: "My Notes" },
      ],
    },
    {
      section: "IMPROVE",
      items: [
        { icon: "◷", label: "Revision" },
        { icon: "▥", label: "Analytics" },
        { icon: "◎", label: "My Goals" },
      ],
    },
  ];

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand" onClick={() => setActivePage("Overview")} style={{ cursor: "pointer" }}>
          <div className="brand-icon">✳</div>
          <span>
            studyflow<span className="brand-ai">.ai</span>
          </span>
        </div>

        <div className="workspace-label">YOUR WORKSPACE</div>

        {navigation.map((group) => (
          <div className="nav-group" key={group.section}>
            <div className="nav-heading">{group.section}</div>

            {group.items.map((item) => (
              <button
                key={item.label}
                className={`nav-item ${activePage === item.label ? "active" : ""}`}
                onClick={() => setActivePage(item.label)}
              >
                <span className="nav-icon">{item.icon}</span>
                {item.label}

                {item.label === "Study Planner" && (
                  <span className="new-badge">AI</span>
                )}

                {item.label === "AI Tutor" && (
                  <span className="new-badge">AI</span>
                )}

                {item.label === "Mock Tests" && (
                  <span className="new-badge">NEW</span>
                )}
              </button>
            ))}
          </div>
        ))}

        <div className="sidebar-spacer" />

        <div className="upgrade-card">
          <div className="upgrade-sparkle">✦</div>
          <h3>Your next level awaits.</h3>
          <p>Set targets and track milestones to build daily progress.</p>
          <button onClick={() => setActivePage("My Goals")}>
            View my goals ↗
          </button>
        </div>

        {/* CLICKABLE PROFILE WORKSPACE ELEMENT */}
        <div
          className="profile clickable-profile"
          onClick={() => setIsWorkspaceModalOpen(true)}
          title="Open Workspace & Plan Overview"
          tabIndex={0}
          role="button"
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") setIsWorkspaceModalOpen(true);
          }}
        >
          <div className="avatar">K</div>
          <div className="profile-copy">
            <strong>My Workspace</strong>
            <span>Free plan · Preview ↗</span>
          </div>
          <span className="profile-menu">···</span>
        </div>
      </aside>

      <main className="main-content">
        <header className="topbar">
          <div className="breadcrumbs">
            Workspace <span>/</span> <strong>{activePage}</strong>
          </div>

          <div className="topbar-actions">
            <div className="date-chip">
              <span>◷</span> Your learning space
            </div>
            <button
              className="icon-button"
              aria-label="Workspace overview"
              onClick={() => setIsWorkspaceModalOpen(true)}
              title="Workspace details"
            >
              ♧
            </button>
            <div
              className="avatar small-avatar"
              onClick={() => setIsWorkspaceModalOpen(true)}
              style={{ cursor: "pointer" }}
              title="Profile"
            >
              K
            </div>
          </div>
        </header>

        <div className="page-content">
          {/* TAB 1: OVERVIEW */}
          {activePage === "Overview" && (
            <OverviewTab
              setActivePage={setActivePage}
              onOpenNote={handleOpenNote}
              onOpenCourse={handleOpenCourse}
              onOpenStudyPlanner={handleOpenStudyPlanner}
            />
          )}

          {/* TAB 2: MY COURSES */}
          {activePage === "My Courses" && (
            <CoursesTab
              onOpenNote={handleOpenNote}
              setActivePage={setActivePage}
              initialCourseId={openedCourseId}
              onOpenMockTestForCourse={handleOpenMockTestForCourse}
              onOpenStudyPlanner={handleOpenStudyPlanner}
            />
          )}

          {/* TAB 2.2: STUDY PLANNER */}
          {activePage === "Study Planner" && (
            <StudyPlannerTab
              setActivePage={setActivePage}
              onOpenNote={handleOpenNote}
              onSendToAITutor={handleSendToAITutor}
              initialPlanConfig={openedPlannerConfig}
            />
          )}

          {/* TAB 2.5: MOCK TESTS */}
          {activePage === "Mock Tests" && (
            <MockTestsTab
              setActivePage={setActivePage}
              onOpenNote={handleOpenNote}
              onOpenCourse={handleOpenCourse}
              preselectedCourseId={openedMockCourseId}
              onSendToAITutor={handleSendToAITutor}
              onOpenStudyPlanner={handleOpenStudyPlanner}
            />
          )}

          {/* TAB 3: AI TUTOR */}
          {activePage === "AI Tutor" && (
            <>
              <section className="welcome-section">
                <div>
                  <div className="eyebrow">
                    <span className="live-dot" /> YOUR PERSONAL AI TUTOR
                  </div>
                  <h1>AI Tutor<span>.</span></h1>
                  <p className="welcome-subtitle">
                    Ask questions, break down complex concepts, and explore ideas grounded in your uploaded materials.
                  </p>
                </div>

                <button
                  className="primary-button"
                  onClick={() => setActivePage("My Notes")}
                >
                  <span>▤</span> {document ? "View uploaded notes" : "Upload notes"} <span>↗</span>
                </button>
              </section>

              <TutorSection
                messages={messages}
                question={question}
                setQuestion={setQuestion}
                askAssistant={askAssistant}
                isLoading={isLoading}
                tutorError={tutorError}
                setTutorError={setTutorError}
                document={document}
                setDocument={setDocument}
                savedNotes={savedNotes}
                setActivePage={setActivePage}
                clearChat={clearChat}
              />
            </>
          )}

          {/* TAB 4: MY NOTES */}
          {activePage === "My Notes" && (
            <Notes
              document={document}
              setDocument={setDocument}
              initialNoteId={openedNoteId}
            />
          )}

          {/* TAB 5: REVISION */}
          {activePage === "Revision" && (
            <RevisionTab
              setActivePage={setActivePage}
              onOpenNote={handleOpenNote}
              onOpenStudyPlanner={handleOpenStudyPlanner}
            />
          )}

          {/* TAB 6: ANALYTICS */}
          {activePage === "Analytics" && (
            <AnalyticsTab
              setActivePage={setActivePage}
              onOpenStudyPlanner={handleOpenStudyPlanner}
            />
          )}

          {/* TAB 7: MY GOALS */}
          {activePage === "My Goals" && (
            <GoalsTab />
          )}

          <footer className="page-footer">
            <span>✳ studyflow.ai</span>
            <span>Built for curious minds, one topic at a time.</span>
          </footer>
        </div>
      </main>

      {/* WORKSPACE & PLAN OVERVIEW MODAL */}
      <WorkspaceModal
        isOpen={isWorkspaceModalOpen}
        onClose={() => setIsWorkspaceModalOpen(false)}
        setActivePage={setActivePage}
      />
    </div>
  );
}

function MessageCopyButton({ text }) {
  const [copied, setCopied] = useState(false);

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(cleanMarkdown(text));
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // ignore
    }
  }

  return (
    <button
      type="button"
      className="message-copy-btn"
      onClick={handleCopy}
      title="Copy answer to clipboard"
    >
      {copied ? "Copied ✓" : "Copy"}
    </button>
  );
}

const LEARNING_MODES = [
  { label: "💡 Explain simply", prompt: "Explain this concept in plain, beginner-friendly terms with an analogy: " },
  { label: "🪜 Step-by-step", prompt: "Break down the exact step-by-step process of how this works: " },
  { label: "🔍 Practical example", prompt: "Give me 2 clear real-world examples illustrating how this applies: " },
  { label: "⚖️ Compare concepts", prompt: "Compare and contrast these two concepts, highlighting key distinctions: " },
  { label: "✎ Practice challenge", prompt: "Give me a practice challenge question to test my understanding of: " },
  { label: "🛠 Explain my mistake", prompt: "I got this question wrong and thought the answer was X. Help me understand why: " },
];

function TutorSection({
  messages,
  question,
  setQuestion,
  askAssistant,
  isLoading,
  tutorError,
  setTutorError,
  document,
  setDocument,
  savedNotes = [],
  setActivePage,
  clearChat,
}) {
  function handleSelectMode(promptPrefix) {
    setQuestion(promptPrefix);
    const input = window.document.getElementById("tutor-chat-input");
    if (input) input.focus();
  }

  function handleDocumentSwitch(e) {
    const selectedId = e.target.value;
    if (!selectedId) {
      setDocument(null);
    } else {
      const match = savedNotes.find((n) => n.id === selectedId);
      if (match) setDocument(match);
    }
  }

  return (
    <section className="panel tutor-panel">
      <div className="tutor-header-row">
        <div className="tutor-heading">
          <div className="tutor-icon">✧</div>
          <div>
            <div className="eyebrow">YOUR AI STUDY COMPANION</div>
            <h2>What are we figuring out today?</h2>
            <p>
              Ask a question, explore a concept, or break down difficult notes into simple steps.
            </p>
          </div>
        </div>

        {messages.length > 1 && (
          <button
            type="button"
            className="chat-clear-button"
            onClick={clearChat}
            disabled={isLoading}
            title="Reset conversation"
          >
            Clear chat
          </button>
        )}
      </div>

      {/* CONTEXT BANNER & DOCUMENT SELECTOR */}
      <div
        className={`tutor-context-banner ${document?.fileName ? "has-notes" : "general"
          }`}
      >
        <div className="tutor-context-info">
          <span className="tutor-context-badge">
            {document?.fileName ? "📄 Notes Grounded" : "🌐 General Knowledge"}
          </span>
          <span>
            {document?.fileName ? (
              <>
                Using notes from <strong>{document.fileName}</strong> ({document.pageCount}{" "}
                {document.pageCount === 1 ? "page" : "pages"})
              </>
            ) : (
              "No notes selected · General study explanations mode"
            )}
          </span>
        </div>

        {/* Note Switcher Dropdown */}
        <div className="tutor-note-switcher">
          <select
            value={document?.id || ""}
            onChange={handleDocumentSwitch}
            className="tutor-select-doc"
          >
            <option value="">🌐 General Knowledge (No Notes)</option>
            {savedNotes.map((n) => (
              <option key={n.id} value={n.id}>
                📄 {n.title || n.fileName}
              </option>
            ))}
          </select>
          <button
            type="button"
            className="tutor-context-action"
            onClick={() => setActivePage("My Notes")}
          >
            Upload new ↗
          </button>
        </div>
      </div>

      {tutorError && (
        <div className="tutor-error-banner" role="alert">
          <span>{tutorError}</span>
          <button
            type="button"
            className="tutor-error-close"
            onClick={() => setTutorError("")}
            aria-label="Dismiss error"
          >
            ✕
          </button>
        </div>
      )}

      {/* CHAT MESSAGES */}
      <div className="chat-messages">
        {messages.map((message, index) => (
          <div
            className={`chat-message ${message.role} ${message.isError ? "is-error" : ""
              }`}
            key={index}
          >
            <span className="message-avatar">
              {message.role === "assistant" ? "✧" : "K"}
            </span>
            <div className="chat-message-body">
              {message.role === "assistant" && !message.isError ? (
                <>
                  <MarkdownRenderer content={message.text} />
                  <div className="message-footer-row">
                    {message.source && (
                      <span className={`message-source-tag ${message.source}`}>
                        {message.source === "notes"
                          ? "📄 Grounded in your notes"
                          : "🌐 General knowledge"}
                      </span>
                    )}
                    <MessageCopyButton text={message.text} />
                  </div>
                </>
              ) : (
                <p>{message.text}</p>
              )}
            </div>
          </div>
        ))}

        {isLoading && (
          <div className="chat-message assistant">
            <span className="message-avatar">✧</span>
            <div className="chat-loading-bubble">
              <span className="chat-loading-spinner" />
              <span>StudyFlow AI is thinking...</span>
            </div>
          </div>
        )}
      </div>

      {/* LEARNING MODE SHORTCUT CHIPS */}
      <div className="tutor-modes-bar">
        <span className="tutor-modes-label">Learning Modes:</span>
        <div className="tutor-modes-chips">
          {LEARNING_MODES.map((mode, i) => (
            <button
              key={i}
              type="button"
              className="tutor-mode-chip"
              onClick={() => handleSelectMode(mode.prompt)}
              disabled={isLoading}
            >
              {mode.label}
            </button>
          ))}
        </div>
      </div>

      {/* CHAT INPUT FORM */}
      <form className="chat-form" onSubmit={askAssistant}>
        <input
          id="tutor-chat-input"
          value={question}
          onChange={(event) => setQuestion(event.target.value)}
          placeholder={
            document?.fileName
              ? `Ask a question about ${document.fileName}...`
              : "e.g. Explain recursion like I'm a beginner..."
          }
          aria-label="Ask the study assistant"
          disabled={isLoading}
        />
        <button type="submit" disabled={isLoading || !question.trim()}>
          {isLoading ? (
            <>
              <span className="btn-spinner" />
              Thinking...
            </>
          ) : (
            <>
              Ask AI <span>↗</span>
            </>
          )}
        </button>
      </form>

      <div className="demo-note">
        {document?.fileName
          ? `✦ Grounded in ${document.fileName}. Answers distinguish notes content from general explanations.`
          : "✦ Live AI active. Tip: Upload notes or select from the dropdown for personalized answers."}
      </div>
    </section>
  );
}

export default App;