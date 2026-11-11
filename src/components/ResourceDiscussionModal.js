import { useState, useEffect, useCallback } from "react";
import { supabase } from "../supabaseClient";

const REPORT_REASONS = [
  { value: "broken_file", label: "Corrupt or unreadable file" },
  { value: "inaccurate", label: "Inaccurate academic content" },
  { value: "copyright", label: "Copyright violation" },
  { value: "spam", label: "Spam or irrelevant material" },
  { value: "inappropriate", label: "Inappropriate content" },
  { value: "harassment", label: "Harassment or abusive language" },
  { value: "other", label: "Other issue" }
];

function ResourceDiscussionModal({
  item,
  initialTab = "comments",
  session,
  userRole,
  userStatus = "active",
  onCommentCountChange,
  onClose
}) {
  const [activeTab, setActiveTab] = useState(initialTab);

  // Comments state
  const [comments, setComments] = useState([]);
  const [loadingComments, setLoadingComments] = useState(false);
  const [commentBody, setCommentBody] = useState("");
  const [replyingTo, setReplyingTo] = useState(null); // { id, authorName }
  const [editingCommentId, setEditingCommentId] = useState(null);
  const [editingCommentBody, setEditingCommentBody] = useState("");
  const [submittingComment, setSubmittingComment] = useState(false);

  // Suggestions state
  const [suggestions, setSuggestions] = useState([]);
  const [loadingSuggestions, setLoadingSuggestions] = useState(false);
  const [suggestionTitle, setSuggestionTitle] = useState("");
  const [suggestionDetails, setSuggestionDetails] = useState("");
  const [editingSuggestionId, setEditingSuggestionId] = useState(null);
  const [editingSuggestionTitle, setEditingSuggestionTitle] = useState("");
  const [editingSuggestionDetails, setEditingSuggestionDetails] = useState("");
  const [reviewNoteById, setReviewNoteById] = useState({});
  const [submittingSuggestion, setSubmittingSuggestion] = useState(false);

  // Report state
  const [reportTargetComment, setReportTargetComment] = useState(null);
  const [reportReason, setReportReason] = useState("broken_file");
  const [reportDetails, setReportDetails] = useState("");
  const [submittingReport, setSubmittingReport] = useState(false);

  const [feedback, setFeedback] = useState({ type: "", text: "" });

  const currentUserId = session?.user?.id;
  const isResourceOwner = Boolean(currentUserId && item.ownerId === currentUserId);
  const isAdmin = userRole === "admin";
  const isActiveUser = userStatus !== "suspended";

  const loadComments = useCallback(async () => {
    setLoadingComments(true);
    const { data, error } = await supabase
      .from("resource_comments")
      .select(
        "id, resource_id, user_id, parent_id, depth, body, created_at, updated_at, author:profiles(id, display_name, designation, role)"
      )
      .eq("resource_id", item.id)
      .order("created_at", { ascending: true });

    setLoadingComments(false);

    if (error) {
      // Graceful message if table migration hasn't been executed yet
      if (error.code === "42P01" || /resource_comments/i.test(error.message)) {
        setComments([]);
        return;
      }
      setFeedback({ type: "error", text: "Could not load comments: " + error.message });
      return;
    }

    const list = Array.isArray(data) ? data : [];
    setComments(list);
    if (onCommentCountChange) {
      onCommentCountChange(item.id, list.length);
    }
  }, [item.id, onCommentCountChange]);

  const loadSuggestions = useCallback(async () => {
    setLoadingSuggestions(true);
    const { data, error } = await supabase
      .from("resource_suggestions")
      .select(
        "id, resource_id, user_id, title, details, status, reviewed_by, review_note, reviewed_at, created_at, updated_at, author:profiles!resource_suggestions_user_id_fkey(id, display_name, designation)"
      )
      .eq("resource_id", item.id)
      .order("created_at", { ascending: false });

    setLoadingSuggestions(false);

    if (error) {
      if (error.code === "42P01" || /resource_suggestions/i.test(error.message)) {
        setSuggestions([]);
        return;
      }
      setFeedback({ type: "error", text: "Could not load suggestions: " + error.message });
      return;
    }

    setSuggestions(Array.isArray(data) ? data : []);
  }, [item.id]);

  useEffect(() => {
    setFeedback({ type: "", text: "" });
    if (activeTab === "comments") {
      loadComments();
    } else if (activeTab === "suggestions") {
      loadSuggestions();
    }
  }, [activeTab, loadComments, loadSuggestions]);

  async function handleAddComment(event) {
    event.preventDefault();
    setFeedback({ type: "", text: "" });

    if (!isActiveUser) {
      setFeedback({ type: "error", text: "Suspended accounts cannot post comments." });
      return;
    }

    const cleanBody = commentBody.trim();
    if (!cleanBody || cleanBody.length > 2000) {
      setFeedback({ type: "error", text: "Comment must be between 1 and 2000 characters." });
      return;
    }

    setSubmittingComment(true);
    const payload = {
      resource_id: item.id,
      user_id: currentUserId,
      parent_id: replyingTo ? replyingTo.id : null,
      depth: replyingTo ? 1 : 0,
      body: cleanBody
    };

    const { error } = await supabase
      .from("resource_comments")
      .insert(payload);

    setSubmittingComment(false);

    if (error) {
      setFeedback({ type: "error", text: error.message });
      return;
    }

    setCommentBody("");
    setReplyingTo(null);
    await loadComments();
  }

  async function handleSaveCommentEdit(commentId) {
    setFeedback({ type: "", text: "" });
    const cleanBody = editingCommentBody.trim();
    if (!cleanBody) return;

    const { error } = await supabase
      .from("resource_comments")
      .update({ body: cleanBody })
      .eq("id", commentId)
      .eq("user_id", currentUserId);

    if (error) {
      setFeedback({ type: "error", text: error.message });
      return;
    }

    setEditingCommentId(null);
    setEditingCommentBody("");
    await loadComments();
  }

  async function handleDeleteComment(commentId) {
    setFeedback({ type: "", text: "" });
    const { error } = await supabase
      .from("resource_comments")
      .delete()
      .eq("id", commentId);

    if (error) {
      setFeedback({ type: "error", text: error.message });
      return;
    }

    await loadComments();
  }

  async function handleAddSuggestion(event) {
    event.preventDefault();
    setFeedback({ type: "", text: "" });

    if (!isActiveUser) {
      setFeedback({ type: "error", text: "Suspended accounts cannot submit suggestions." });
      return;
    }

    const cleanTitle = suggestionTitle.trim();
    const cleanDetails = suggestionDetails.trim();

    if (!cleanTitle || !cleanDetails) {
      setFeedback({
        type: "error",
        text: "Please enter both a short summary title and detailed suggestion."
      });
      return;
    }

    setSubmittingSuggestion(true);
    const { error } = await supabase.from("resource_suggestions").insert({
      resource_id: item.id,
      user_id: currentUserId,
      title: cleanTitle,
      details: cleanDetails,
      status: "pending"
    });
    setSubmittingSuggestion(false);

    if (error) {
      setFeedback({ type: "error", text: error.message });
      return;
    }

    setSuggestionTitle("");
    setSuggestionDetails("");
    setFeedback({ type: "success", text: "Improvement suggestion submitted." });
    await loadSuggestions();
  }

  async function handleSaveSuggestionEdit(suggestionId) {
    setFeedback({ type: "", text: "" });
    const cleanTitle = editingSuggestionTitle.trim();
    const cleanDetails = editingSuggestionDetails.trim();
    if (!cleanTitle || !cleanDetails) return;

    const { error } = await supabase
      .from("resource_suggestions")
      .update({ title: cleanTitle, details: cleanDetails })
      .eq("id", suggestionId)
      .eq("user_id", currentUserId);

    if (error) {
      setFeedback({ type: "error", text: error.message });
      return;
    }

    setEditingSuggestionId(null);
    await loadSuggestions();
  }

  async function handleReviewSuggestion(suggestionId, newStatus) {
    setFeedback({ type: "", text: "" });
    const note = (reviewNoteById[suggestionId] || "").trim() || null;

    const { error } = await supabase
      .from("resource_suggestions")
      .update({
        status: newStatus,
        review_note: note
      })
      .eq("id", suggestionId);

    if (error) {
      setFeedback({ type: "error", text: error.message });
      return;
    }

    setFeedback({
      type: "success",
      text: `Suggestion marked as ${newStatus}.`
    });
    await loadSuggestions();
  }

  async function handleDeleteSuggestion(suggestionId) {
    setFeedback({ type: "", text: "" });
    const { error } = await supabase
      .from("resource_suggestions")
      .delete()
      .eq("id", suggestionId);

    if (error) {
      setFeedback({ type: "error", text: error.message });
      return;
    }

    await loadSuggestions();
  }

  async function handleSubmitReport(event) {
    event.preventDefault();
    setFeedback({ type: "", text: "" });

    if (!isActiveUser) {
      setFeedback({ type: "error", text: "Suspended accounts cannot submit reports." });
      return;
    }

    setSubmittingReport(true);
    const payload = {
      target_type: reportTargetComment ? "comment" : "resource",
      resource_id: item.id,
      comment_id: reportTargetComment ? reportTargetComment.id : null,
      reporter_id: currentUserId,
      reason: reportReason,
      details: reportDetails.trim() || null,
      status: "open"
    };

    const { error } = await supabase.from("content_reports").insert(payload);
    setSubmittingReport(false);

    if (error) {
      if (error.code === "23505") {
        setFeedback({
          type: "error",
          text: "You already have an open report for this item under review."
        });
      } else {
        setFeedback({ type: "error", text: error.message });
      }
      return;
    }

    setReportDetails("");
    setReportTargetComment(null);
    setFeedback({
      type: "success",
      text: "Report submitted to platform moderators."
    });
  }

  const rootComments = comments.filter((c) => !c.parent_id);
  const repliesByParent = comments.reduce((acc, c) => {
    if (c.parent_id) {
      acc[c.parent_id] = acc[c.parent_id] || [];
      acc[c.parent_id].push(c);
    }
    return acc;
  }, {});

  return (
    <div className="preview-overlay" onClick={onClose}>
      <section
        className="dialog-modal dialog-modal-wide"
        role="dialog"
        aria-modal="true"
        aria-label={`Community discussion for ${item.title}`}
        onClick={(event) => event.stopPropagation()}
      >
        <header className="preview-header">
          <div>
            <h2>{item.title}</h2>
            <span>
              {item.subject} &middot; Shared by {item.uploaderName}
            </span>
          </div>
          <button
            type="button"
            className="preview-close"
            onClick={onClose}
            aria-label="Close community modal"
          >
            &times;
          </button>
        </header>

        <div className="modal-tabs" role="tablist">
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === "comments"}
            className={activeTab === "comments" ? "modal-tab active" : "modal-tab"}
            onClick={() => setActiveTab("comments")}
          >
            Comments ({comments.length})
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === "suggestions"}
            className={activeTab === "suggestions" ? "modal-tab active" : "modal-tab"}
            onClick={() => setActiveTab("suggestions")}
          >
            Suggestions ({suggestions.length})
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === "report"}
            className={activeTab === "report" ? "modal-tab active" : "modal-tab"}
            onClick={() => {
              setReportTargetComment(null);
              setActiveTab("report");
            }}
          >
            Report issue
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

          {activeTab === "comments" && (
            <div className="discussion-section">
              {isActiveUser && (
                <form className="comment-composer" onSubmit={handleAddComment}>
                  {replyingTo && (
                    <div className="reply-banner">
                      <span>
                        Replying to <strong>{replyingTo.authorName}</strong> (Thread level 1)
                      </span>
                      <button
                        type="button"
                        className="reset-inline-button"
                        onClick={() => setReplyingTo(null)}
                      >
                        Cancel reply
                      </button>
                    </div>
                  )}
                  <textarea
                    rows={3}
                    placeholder={
                      replyingTo
                        ? "Write a reply..."
                        : "Ask a question or share study notes about this resource..."
                    }
                    maxLength={2000}
                    value={commentBody}
                    onChange={(event) => setCommentBody(event.target.value)}
                    required
                  />
                  <div className="composer-actions">
                    <button
                      type="submit"
                      className="upload-submit-button"
                      disabled={submittingComment}
                    >
                      {submittingComment
                        ? "Posting..."
                        : replyingTo
                        ? "Post reply"
                        : "Post comment"}
                    </button>
                  </div>
                </form>
              )}

              {loadingComments ? (
                <p className="status-text">Loading comments...</p>
              ) : rootComments.length === 0 ? (
                <div className="empty-state-compact">
                  <p>No comments yet. Start the discussion above.</p>
                </div>
              ) : (
                <div className="comment-thread-list">
                  {rootComments.map((root) => {
                    const authorName =
                      root.author?.display_name || "ResourceHub member";
                    const canEditRoot = root.user_id === currentUserId;
                    const canDeleteRoot =
                      canEditRoot || isResourceOwner || isAdmin;
                    const replies = repliesByParent[root.id] || [];

                    return (
                      <div key={root.id} className="comment-thread">
                        <div className="comment-card">
                          <div className="comment-meta">
                            <strong>{authorName}</strong>
                            {root.author?.designation && (
                              <span>&middot; {root.author.designation}</span>
                            )}
                            <span>
                              &middot;{" "}
                              {new Date(root.created_at).toLocaleDateString("en-GB", {
                                day: "2-digit",
                                month: "short",
                                year: "numeric"
                              })}
                            </span>
                          </div>

                          {editingCommentId === root.id ? (
                            <div className="inline-edit-box">
                              <textarea
                                rows={2}
                                value={editingCommentBody}
                                onChange={(e) => setEditingCommentBody(e.target.value)}
                              />
                              <div className="inline-edit-actions">
                                <button
                                  type="button"
                                  className="upload-submit-button"
                                  onClick={() => handleSaveCommentEdit(root.id)}
                                >
                                  Save
                                </button>
                                <button
                                  type="button"
                                  className="secondary-button"
                                  onClick={() => setEditingCommentId(null)}
                                >
                                  Cancel
                                </button>
                              </div>
                            </div>
                          ) : (
                            <p className="comment-body">{root.body}</p>
                          )}

                          <div className="comment-actions">
                            {isActiveUser && (
                              <button
                                type="button"
                                className="text-action-button"
                                onClick={() =>
                                  setReplyingTo({ id: root.id, authorName })
                                }
                              >
                                Reply
                              </button>
                            )}
                            {canEditRoot && editingCommentId !== root.id && (
                              <button
                                type="button"
                                className="text-action-button"
                                onClick={() => {
                                  setEditingCommentId(root.id);
                                  setEditingCommentBody(root.body);
                                }}
                              >
                                Edit
                              </button>
                            )}
                            {canDeleteRoot && (
                              <button
                                type="button"
                                className="text-action-button danger-link"
                                onClick={() => handleDeleteComment(root.id)}
                              >
                                Delete
                              </button>
                            )}
                            {isActiveUser && !canEditRoot && (
                              <button
                                type="button"
                                className="text-action-button"
                                onClick={() => {
                                  setReportTargetComment({
                                    id: root.id,
                                    authorName,
                                    body: root.body
                                  });
                                  setReportReason("harassment");
                                  setActiveTab("report");
                                }}
                              >
                                Report
                              </button>
                            )}
                          </div>
                        </div>

                        {replies.length > 0 && (
                          <div className="comment-replies">
                            {replies.map((reply) => {
                              const replyAuthor =
                                reply.author?.display_name || "ResourceHub member";
                              const canEditReply = reply.user_id === currentUserId;
                              const canDeleteReply =
                                canEditReply || isResourceOwner || isAdmin;

                              return (
                                <div key={reply.id} className="comment-card comment-reply-card">
                                  <div className="comment-meta">
                                    <strong>{replyAuthor}</strong>
                                    {reply.author?.designation && (
                                      <span>&middot; {reply.author.designation}</span>
                                    )}
                                    <span>
                                      &middot;{" "}
                                      {new Date(reply.created_at).toLocaleDateString(
                                        "en-GB",
                                        {
                                          day: "2-digit",
                                          month: "short",
                                          year: "numeric"
                                        }
                                      )}
                                    </span>
                                  </div>

                                  {editingCommentId === reply.id ? (
                                    <div className="inline-edit-box">
                                      <textarea
                                        rows={2}
                                        value={editingCommentBody}
                                        onChange={(e) =>
                                          setEditingCommentBody(e.target.value)
                                        }
                                      />
                                      <div className="inline-edit-actions">
                                        <button
                                          type="button"
                                          className="upload-submit-button"
                                          onClick={() => handleSaveCommentEdit(reply.id)}
                                        >
                                          Save
                                        </button>
                                        <button
                                          type="button"
                                          className="secondary-button"
                                          onClick={() => setEditingCommentId(null)}
                                        >
                                          Cancel
                                        </button>
                                      </div>
                                    </div>
                                  ) : (
                                    <p className="comment-body">{reply.body}</p>
                                  )}

                                  <div className="comment-actions">
                                    {isActiveUser && (
                                      <button
                                        type="button"
                                        className="text-action-button"
                                        onClick={() => {
                                          // Safe 2-level reply depth policy: target the root comment
                                          setReplyingTo({
                                            id: root.id,
                                            authorName: replyAuthor
                                          });
                                          if (!commentBody.startsWith(`@${replyAuthor} `)) {
                                            setCommentBody(`@${replyAuthor} `);
                                          }
                                        }}
                                      >
                                        Reply
                                      </button>
                                    )}
                                    {canEditReply && editingCommentId !== reply.id && (
                                      <button
                                        type="button"
                                        className="text-action-button"
                                        onClick={() => {
                                          setEditingCommentId(reply.id);
                                          setEditingCommentBody(reply.body);
                                        }}
                                      >
                                        Edit
                                      </button>
                                    )}
                                    {canDeleteReply && (
                                      <button
                                        type="button"
                                        className="text-action-button danger-link"
                                        onClick={() => handleDeleteComment(reply.id)}
                                      >
                                        Delete
                                      </button>
                                    )}
                                    {isActiveUser && !canEditReply && (
                                      <button
                                        type="button"
                                        className="text-action-button"
                                        onClick={() => {
                                          setReportTargetComment({
                                            id: reply.id,
                                            authorName: replyAuthor,
                                            body: reply.body
                                          });
                                          setReportReason("harassment");
                                          setActiveTab("report");
                                        }}
                                      >
                                        Report
                                      </button>
                                    )}
                                  </div>
                                </div>
                              );
                            })}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}

          {activeTab === "suggestions" && (
            <div className="discussion-section">
              {isActiveUser && (
                <form className="comment-composer" onSubmit={handleAddSuggestion}>
                  <input
                    type="text"
                    placeholder="Short suggestion title (e.g., Add worked examples for Chapter 3)"
                    maxLength={150}
                    value={suggestionTitle}
                    onChange={(event) => setSuggestionTitle(event.target.value)}
                    required
                  />
                  <textarea
                    rows={3}
                    placeholder="Describe the suggested improvement or errata in detail..."
                    maxLength={2000}
                    value={suggestionDetails}
                    onChange={(event) => setSuggestionDetails(event.target.value)}
                    required
                  />
                  <div className="composer-actions">
                    <button
                      type="submit"
                      className="upload-submit-button"
                      disabled={submittingSuggestion}
                    >
                      {submittingSuggestion ? "Submitting..." : "Submit suggestion"}
                    </button>
                  </div>
                </form>
              )}

              {loadingSuggestions ? (
                <p className="status-text">Loading suggestions...</p>
              ) : suggestions.length === 0 ? (
                <div className="empty-state-compact">
                  <p>No improvement suggestions submitted for this resource yet.</p>
                </div>
              ) : (
                <div className="comment-thread-list">
                  {suggestions.map((sug) => {
                    const isSubmitter = sug.user_id === currentUserId;
                    const canEditPending = isSubmitter && sug.status === "pending";
                    const canDeleteSuggestion =
                      canEditPending || isResourceOwner || isAdmin;
                    const canReview =
                      (isResourceOwner && sug.status === "pending") || isAdmin;

                    return (
                      <div key={sug.id} className="comment-card">
                        <div className="suggestion-header">
                          <strong>{sug.title}</strong>
                          <span className={`status-pill status-pill-${sug.status}`}>
                            {sug.status.toUpperCase()}
                          </span>
                        </div>

                        <div className="comment-meta">
                          <span>
                            Suggested by{" "}
                            <strong>
                              {sug.author?.display_name || "ResourceHub member"}
                            </strong>
                          </span>
                          <span>
                            &middot;{" "}
                            {new Date(sug.created_at).toLocaleDateString("en-GB", {
                              day: "2-digit",
                              month: "short",
                              year: "numeric"
                            })}
                          </span>
                        </div>

                        {editingSuggestionId === sug.id ? (
                          <div className="inline-edit-box">
                            <input
                              type="text"
                              value={editingSuggestionTitle}
                              onChange={(e) =>
                                setEditingSuggestionTitle(e.target.value)
                              }
                            />
                            <textarea
                              rows={3}
                              value={editingSuggestionDetails}
                              onChange={(e) =>
                                setEditingSuggestionDetails(e.target.value)
                              }
                            />
                            <div className="inline-edit-actions">
                              <button
                                type="button"
                                className="upload-submit-button"
                                onClick={() => handleSaveSuggestionEdit(sug.id)}
                              >
                                Save
                              </button>
                              <button
                                type="button"
                                className="secondary-button"
                                onClick={() => setEditingSuggestionId(null)}
                              >
                                Cancel
                              </button>
                            </div>
                          </div>
                        ) : (
                          <p className="comment-body">{sug.details}</p>
                        )}

                        {sug.review_note && (
                          <p className="review-note-box">
                            <strong>Reviewer note:</strong> {sug.review_note}
                          </p>
                        )}

                        <div className="comment-actions">
                          {canEditPending && editingSuggestionId !== sug.id && (
                            <button
                              type="button"
                              className="text-action-button"
                              onClick={() => {
                                setEditingSuggestionId(sug.id);
                                setEditingSuggestionTitle(sug.title);
                                setEditingSuggestionDetails(sug.details);
                              }}
                            >
                              Edit
                            </button>
                          )}
                          {canDeleteSuggestion && (
                            <button
                              type="button"
                              className="text-action-button danger-link"
                              onClick={() => handleDeleteSuggestion(sug.id)}
                            >
                              Delete
                            </button>
                          )}
                        </div>

                        {canReview && (
                          <div className="moderator-review-bar">
                            <input
                              type="text"
                              placeholder="Optional review note..."
                              value={reviewNoteById[sug.id] || ""}
                              onChange={(e) =>
                                setReviewNoteById((prev) => ({
                                  ...prev,
                                  [sug.id]: e.target.value
                                }))
                              }
                            />
                            {sug.status !== "accepted" && (
                              <button
                                type="button"
                                className="secondary-button"
                                onClick={() =>
                                  handleReviewSuggestion(sug.id, "accepted")
                                }
                              >
                                Accept
                              </button>
                            )}
                            {sug.status !== "rejected" && (
                              <button
                                type="button"
                                className="secondary-button danger-link"
                                onClick={() =>
                                  handleReviewSuggestion(sug.id, "rejected")
                                }
                              >
                                Reject
                              </button>
                            )}
                            {isAdmin && sug.status !== "pending" && (
                              <button
                                type="button"
                                className="secondary-button"
                                onClick={() =>
                                  handleReviewSuggestion(sug.id, "pending")
                                }
                              >
                                Reopen
                              </button>
                            )}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}

          {activeTab === "report" && (
            <form className="discussion-section" onSubmit={handleSubmitReport}>
              {reportTargetComment ? (
                <div className="reply-banner">
                  <span>
                    Reporting comment by{" "}
                    <strong>{reportTargetComment.authorName}</strong>:{" "}
                    <em>&ldquo;{reportTargetComment.body.slice(0, 80)}&rdquo;</em>
                  </span>
                  <button
                    type="button"
                    className="reset-inline-button"
                    onClick={() => setReportTargetComment(null)}
                  >
                    Report resource instead
                  </button>
                </div>
              ) : (
                <p className="description">
                  Flag this resource for moderator review if it is corrupt, inaccurate, or violates community guidelines.
                </p>
              )}

              <div className="upload-field">
                <label className="field-label" htmlFor="report-reason-select">
                  Reason for report
                </label>
                <select
                  id="report-reason-select"
                  value={reportReason}
                  onChange={(e) => setReportReason(e.target.value)}
                >
                  {REPORT_REASONS.map((r) => (
                    <option key={r.value} value={r.value}>
                      {r.label}
                    </option>
                  ))}
                </select>
              </div>

              <div className="upload-field">
                <label className="field-label" htmlFor="report-details-input">
                  Additional details (optional)
                </label>
                <textarea
                  id="report-details-input"
                  rows={3}
                  maxLength={1000}
                  placeholder="Provide specific slide numbers, page numbers, or context..."
                  value={reportDetails}
                  onChange={(e) => setReportDetails(e.target.value)}
                />
              </div>

              <div className="dialog-footer">
                <button
                  type="submit"
                  className="upload-submit-button"
                  disabled={submittingReport}
                >
                  {submittingReport ? "Submitting report..." : "Submit report"}
                </button>
              </div>
            </form>
          )}
        </div>
      </section>
    </div>
  );
}

export default ResourceDiscussionModal;
