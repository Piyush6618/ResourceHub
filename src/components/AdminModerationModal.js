import { useState, useEffect, useCallback } from "react";
import { supabase } from "../supabaseClient";

function AdminModerationModal({
  onDeleteResourceById,
  onSweepStorageQueue,
  onClose
}) {
  const [activeTab, setActiveTab] = useState("reports");
  const [reports, setReports] = useState([]);
  const [users, setUsers] = useState([]);
  const [queueItems, setQueueItems] = useState([]);
  const [loading, setLoading] = useState(false);
  const [feedback, setFeedback] = useState({ type: "", text: "" });

  const loadReports = useCallback(async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from("content_reports")
      .select(
        "id, target_type, resource_id, comment_id, reporter_id, reason, details, status, resolution_note, created_at, resource:resources(id, title, file_path), reporter:profiles!content_reports_reporter_id_fkey(display_name)"
      )
      .order("created_at", { ascending: false });

    setLoading(false);

    if (error) {
      if (error.code === "42P01" || /content_reports/i.test(error.message)) {
        setReports([]);
        return;
      }
      setFeedback({ type: "error", text: error.message });
      return;
    }

    setReports(Array.isArray(data) ? data : []);
  }, []);

  const loadUsers = useCallback(async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from("profiles")
      .select("id, display_name, designation, role, status, suspended_reason")
      .order("display_name", { ascending: true });

    setLoading(false);

    if (error) {
      setFeedback({ type: "error", text: error.message });
      return;
    }

    setUsers(Array.isArray(data) ? data : []);
  }, []);

  const loadCleanupQueue = useCallback(async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from("storage_cleanup_queue")
      .select("id, file_path, reason, attempts, last_error, created_at, processed_at")
      .is("processed_at", null)
      .order("created_at", { ascending: true });

    setLoading(false);

    if (error) {
      if (error.code === "42P01" || /storage_cleanup_queue/i.test(error.message)) {
        setQueueItems([]);
        return;
      }
      setFeedback({ type: "error", text: error.message });
      return;
    }

    setQueueItems(Array.isArray(data) ? data : []);
  }, []);

  useEffect(() => {
    setFeedback({ type: "", text: "" });
    if (activeTab === "reports") {
      loadReports();
    } else if (activeTab === "users") {
      loadUsers();
    } else if (activeTab === "storage") {
      loadCleanupQueue();
    }
  }, [activeTab, loadReports, loadUsers, loadCleanupQueue]);

  async function handleUpdateReportStatus(reportId, newStatus) {
    setFeedback({ type: "", text: "" });
    const { error } = await supabase
      .from("content_reports")
      .update({ status: newStatus })
      .eq("id", reportId);

    if (error) {
      setFeedback({ type: "error", text: error.message });
      return;
    }

    setFeedback({ type: "success", text: `Report marked as ${newStatus}.` });
    await loadReports();
  }

  async function handleToggleUserStatus(user) {
    setFeedback({ type: "", text: "" });
    const nextStatus = user.status === "suspended" ? "active" : "suspended";

    const { error } = await supabase.rpc("admin_set_user_status", {
      p_target_user_id: user.id,
      p_new_status: nextStatus,
      p_reason:
        nextStatus === "suspended"
          ? "Suspended by administrator via moderation console"
          : null
    });

    if (error) {
      setFeedback({ type: "error", text: error.message });
      return;
    }

    setFeedback({
      type: "success",
      text: `Account status changed to ${nextStatus}.`
    });
    await loadUsers();
  }

  async function handleRunStorageSweep() {
    setFeedback({ type: "", text: "" });
    if (onSweepStorageQueue) {
      const cleaned = await onSweepStorageQueue(queueItems);
      setFeedback({
        type: "success",
        text: `Processed ${cleaned} queued storage file(s).`
      });
      await loadCleanupQueue();
    }
  }

  return (
    <div className="preview-overlay" onClick={onClose}>
      <section
        className="dialog-modal dialog-modal-wide"
        role="dialog"
        aria-modal="true"
        aria-label="Administrator moderation panel"
        onClick={(event) => event.stopPropagation()}
      >
        <header className="preview-header">
          <div>
            <h2>Platform Moderation</h2>
            <span>Review community reports, manage user status, and audit storage cleanup.</span>
          </div>
          <button
            type="button"
            className="preview-close"
            onClick={onClose}
            aria-label="Close moderation panel"
          >
            &times;
          </button>
        </header>

        <div className="modal-tabs" role="tablist">
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === "reports"}
            className={activeTab === "reports" ? "modal-tab active" : "modal-tab"}
            onClick={() => setActiveTab("reports")}
          >
            Reports ({reports.length})
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === "users"}
            className={activeTab === "users" ? "modal-tab active" : "modal-tab"}
            onClick={() => setActiveTab("users")}
          >
            Accounts ({users.length})
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === "storage"}
            className={activeTab === "storage" ? "modal-tab active" : "modal-tab"}
            onClick={() => setActiveTab("storage")}
          >
            Storage Queue ({queueItems.length})
          </button>
        </div>

        <div className="dialog-body">
          {feedback.text && (
            <p
              className={
                feedback.type === "success"
                  ? "upload-feedback upload-feedback-success"
                  : "upload-feedback upload-feedback-error"
              }
            >
              {feedback.text}
            </p>
          )}

          {loading ? (
            <p className="status-text">Loading moderation data...</p>
          ) : activeTab === "reports" ? (
            reports.length === 0 ? (
              <div className="empty-state-compact">
                <p>No content reports in queue.</p>
              </div>
            ) : (
              <div className="comment-thread-list">
                {reports.map((rep) => (
                  <div key={rep.id} className="comment-card">
                    <div className="suggestion-header">
                      <strong>
                        [{rep.target_type.toUpperCase()}] {rep.reason} —{" "}
                        {rep.resource?.title || rep.resource_id}
                      </strong>
                      <span className={`status-pill status-pill-${rep.status}`}>
                        {rep.status.toUpperCase()}
                      </span>
                    </div>
                    {rep.details && <p className="comment-body">{rep.details}</p>}
                    <div className="comment-actions">
                      {rep.status !== "resolved" && (
                        <button
                          type="button"
                          className="text-action-button"
                          onClick={() =>
                            handleUpdateReportStatus(rep.id, "resolved")
                          }
                        >
                          Mark resolved
                        </button>
                      )}
                      {rep.status !== "dismissed" && (
                        <button
                          type="button"
                          className="text-action-button"
                          onClick={() =>
                            handleUpdateReportStatus(rep.id, "dismissed")
                          }
                        >
                          Dismiss
                        </button>
                      )}
                      {rep.resource_id && onDeleteResourceById && (
                        <button
                          type="button"
                          className="text-action-button danger-link"
                          onClick={async () => {
                            await onDeleteResourceById(rep.resource_id);
                            await loadReports();
                          }}
                        >
                          Delete resource
                        </button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )
          ) : activeTab === "users" ? (
            <div className="comment-thread-list">
              {users.map((u) => {
                const status = u.status || "active";
                const isAdminRow = u.role === "admin";
                return (
                  <div key={u.id} className="comment-card user-admin-row">
                    <div>
                      <strong>{u.display_name || "ResourceHub user"}</strong>{" "}
                      <span className="subject-pill">{u.role}</span>{" "}
                      <span className={`status-pill status-pill-${status}`}>
                        {status.toUpperCase()}
                      </span>
                      {u.designation && (
                        <p className="comment-meta">{u.designation}</p>
                      )}
                    </div>
                    {!isAdminRow && (
                      <button
                        type="button"
                        className="secondary-button"
                        onClick={() => handleToggleUserStatus(u)}
                      >
                        {status === "suspended"
                          ? "Restore account"
                          : "Suspend account"}
                      </button>
                    )}
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="discussion-section">
              <div className="composer-actions">
                <button
                  type="button"
                  className="upload-submit-button"
                  disabled={queueItems.length === 0}
                  onClick={handleRunStorageSweep}
                >
                  Process pending storage deletions ({queueItems.length})
                </button>
              </div>
              {queueItems.length === 0 ? (
                <div className="empty-state-compact">
                  <p>All deleted resource files have been purged from Storage.</p>
                </div>
              ) : (
                <div className="comment-thread-list">
                  {queueItems.map((q) => (
                    <div key={q.id} className="comment-card">
                      <strong>{q.file_path}</strong>
                      <p className="comment-meta">
                        Reason: {q.reason} &middot; Attempts: {q.attempts}
                        {q.last_error ? ` · Last error: ${q.last_error}` : ""}
                      </p>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      </section>
    </div>
  );
}

export default AdminModerationModal;
