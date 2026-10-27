import { getPlatformMetrics } from "../utils/storage";

export default function WorkspaceModal({ isOpen, onClose, setActivePage }) {
  if (!isOpen) return null;

  const metrics = getPlatformMetrics();

  function handleNavigate(page) {
    onClose();
    setActivePage(page);
  }

  function handleResetStorage() {
    if (
      window.confirm(
        "Are you sure you want to reset your local study data? This will clear courses, notes, and quiz history."
      )
    ) {
      localStorage.clear();
      window.dispatchEvent(new Event("studyflow_storage_sync"));
      onClose();
      window.location.reload();
    }
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-content workspace-modal-box" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <div className="ws-header-title">
            <span className="ws-badge">✦ YOUR LEARNING WORKSPACE</span>
            <h3>Workspace Overview</h3>
          </div>
          <button type="button" className="modal-close-btn" onClick={onClose}>
            ✕
          </button>
        </div>

        <div className="ws-modal-body">
          {/* PROFILE & PLAN STRIP */}
          <div className="ws-plan-card">
            <div className="ws-avatar">K</div>
            <div className="ws-plan-info">
              <strong>Krishika&apos;s StudyFlow Workspace</strong>
              <div className="ws-plan-meta">
                <span className="plan-pill-free">Free Plan · Preview</span>
                <span>Active local session</span>
              </div>
            </div>
          </div>

          {/* ACTIVE CAPABILITIES */}
          <div className="ws-section">
            <span className="ws-section-title">PLATFORM CAPABILITIES</span>
            <div className="ws-features-list">
              <div className="ws-feature-item">
                <span className="check-icon">✓</span>
                <div>
                  <strong>Text-based PDF Extraction</strong>
                  <p>In-browser parsing using PDF.js worker.</p>
                </div>
              </div>

              <div className="ws-feature-item">
                <span className="check-icon">✓</span>
                <div>
                  <strong>Groq AI Engine with Rate Safeguards</strong>
                  <p>High-yield summaries, topic analysis, and revision notes.</p>
                </div>
              </div>

              <div className="ws-feature-item">
                <span className="check-icon">✓</span>
                <div>
                  <strong>Configurable MCQs & Flashcards</strong>
                  <p>5 to 20 practice questions and spaced repetition cards.</p>
                </div>
              </div>

              <div className="ws-feature-item">
                <span className="check-icon">✓</span>
                <div>
                  <strong>Persistent Local Storage</strong>
                  <p>Saved courses, notes, quiz scores, and goals remain across page refreshes.</p>
                </div>
              </div>
            </div>
          </div>

          {/* USAGE METRICS */}
          <div className="ws-section">
            <span className="ws-section-title">CURRENT STORAGE & USAGE</span>
            <div className="ws-stats-grid">
              <div className="ws-stat-cell">
                <strong>{metrics.coursesCount}</strong>
                <span>Courses</span>
              </div>
              <div className="ws-stat-cell">
                <strong>{metrics.notesCount}</strong>
                <span>Saved Notes</span>
              </div>
              <div className="ws-stat-cell">
                <strong>{metrics.quizzesCount}</strong>
                <span>Quiz Attempts</span>
              </div>
              <div className="ws-stat-cell">
                <strong>{metrics.totalHours}h</strong>
                <span>Study Logged</span>
              </div>
            </div>
          </div>

          {/* SHORTCUTS */}
          <div className="ws-section">
            <span className="ws-section-title">QUICK SHORTCUTS</span>
            <div className="ws-shortcuts-row">
              <button
                type="button"
                className="ws-shortcut-btn"
                onClick={() => handleNavigate("My Courses")}
              >
                ⌘ Manage Courses
              </button>
              <button
                type="button"
                className="ws-shortcut-btn"
                onClick={() => handleNavigate("My Notes")}
              >
                📄 Upload Notes
              </button>
              <button
                type="button"
                className="ws-shortcut-btn"
                onClick={() => handleNavigate("Revision")}
              >
                🗂 Flashcard Hub
              </button>
              <button
                type="button"
                className="ws-shortcut-btn"
                onClick={() => handleNavigate("Mock Tests")}
              >
                ✎ Mock Tests
              </button>
              <button
                type="button"
                className="ws-shortcut-btn"
                onClick={() => handleNavigate("Analytics")}
              >
                ◎ View Analytics
              </button>
            </div>
          </div>

          {/* DANGER ZONE / STORAGE MANAGEMENT */}
          <div className="ws-danger-row">
            <div>
              <strong>Reset Workspace</strong>
              <small>Clear saved courses, notes, and quiz history</small>
            </div>
            <button
              type="button"
              className="btn-danger-small"
              onClick={handleResetStorage}
            >
              Reset Data
            </button>
          </div>
        </div>

        <div className="modal-actions" style={{ padding: "16px 24px", background: "#faf9fd" }}>
          <button
            type="button"
            className="primary-button"
            style={{ width: "100%", justifyContent: "center" }}
            onClick={onClose}
          >
            Close Overview
          </button>
        </div>
      </div>
    </div>
  );
}
