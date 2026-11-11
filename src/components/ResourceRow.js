import { useCallback, useEffect, useRef, useState } from "react";
import { supabase } from "../supabaseClient";
import { normalizeSubjectName } from "../utils/fileValidation";

function getUploaderInitials(name) {
  const parts = String(name || "U")
    .trim()
    .split(/[\s._@-]+/)
    .filter(Boolean);
  if (parts.length >= 2) {
    return (parts[0][0] + parts[1][0]).toUpperCase();
  }
  return parts[0] ? parts[0].slice(0, 2).toUpperCase() : "U";
}

function ResourceRow({
  item,
  likeResource,
  onEditResource,
  onDeleteResource,
  onOpenDiscussion,
  session,
  userRole,
  userStatus
}) {
  const [showPreview, setShowPreview] = useState(false);
  const [previewUrl, setPreviewUrl] = useState("");
  const [previewMode, setPreviewMode] = useState("none"); // "pdf" | "pptx" | "fallback"
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewError, setPreviewError] = useState("");
  const [downloading, setDownloading] = useState(false);
  const [liking, setLiking] = useState(false);

  // More actions menu state (for mobile / tablet)
  const [moreActionsOpen, setMoreActionsOpen] = useState(false);
  const moreActionsRef = useRef(null);
  const moreActionsTriggerRef = useRef(null);

  // Edit modal state
  const [showEditModal, setShowEditModal] = useState(false);
  const [editTitle, setEditTitle] = useState(item.title || "");
  const [editSubject, setEditSubject] = useState(item.subject || "");
  const [editDescription, setEditDescription] = useState(
    item.description || ""
  );
  const [savingEdit, setSavingEdit] = useState(false);
  const [editError, setEditError] = useState("");

  // Delete confirmation modal state
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const pptxContainerRef = useRef(null);
  const pptxBufferRef = useRef(null);

  const isSuspended = userStatus === "suspended";
  const canManageResource =
    !isSuspended &&
    ((item.ownerId && item.ownerId === session?.user?.id) ||
      userRole === "admin");

  const closePreview = useCallback(() => {
    setShowPreview(false);
    setPreviewError("");
    setPreviewMode("none");
    pptxBufferRef.current = null;
    if (previewUrl) {
      URL.revokeObjectURL(previewUrl);
      setPreviewUrl("");
    }
  }, [previewUrl]);

  useEffect(() => {
    return () => {
      if (previewUrl) {
        URL.revokeObjectURL(previewUrl);
      }
    };
  }, [previewUrl]);

  // Handle ESC key for preview, edit, and delete dialogs
  useEffect(() => {
    function handleKeyDown(event) {
      if (event.key === "Escape") {
        if (showPreview) closePreview();
        if (showEditModal) setShowEditModal(false);
        if (showDeleteConfirm) setShowDeleteConfirm(false);
        if (moreActionsOpen) setMoreActionsOpen(false);
      }
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [showPreview, showEditModal, showDeleteConfirm, moreActionsOpen, closePreview]);

  // Click outside for More Actions menu
  useEffect(() => {
    if (!moreActionsOpen) return;

    function handleClickOutside(event) {
      if (
        moreActionsRef.current &&
        !moreActionsRef.current.contains(event.target) &&
        moreActionsTriggerRef.current &&
        !moreActionsTriggerRef.current.contains(event.target)
      ) {
        setMoreActionsOpen(false);
      }
    }

    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [moreActionsOpen]);

  // PPTX Preview renderer
  useEffect(() => {
    if (!showPreview || previewMode !== "pptx" || !pptxBufferRef.current) {
      return;
    }

    let cancelled = false;

    async function renderPptxPreview() {
      const container = pptxContainerRef.current;
      if (!container) return;

      container.innerHTML = "";

      try {
        const pptxPreviewModule = await import("pptx-preview");
        const initFn =
          pptxPreviewModule?.init || pptxPreviewModule?.default?.init;

        if (typeof initFn !== "function") {
          throw new Error("Presentation previewer is unavailable.");
        }

        const previewer = initFn(container, {
          width: 840,
          height: 480
        });

        await previewer.preview(pptxBufferRef.current);

        if (cancelled) return;

        const scripts = container.querySelectorAll(
          "script, iframe, object, embed"
        );
        scripts.forEach((node) => node.remove());
      } catch (_err) {
        if (!cancelled) {
          setPreviewMode("fallback");
          setPreviewError(
            "Interactive slide preview could not render this presentation. You can download the original file directly below."
          );
        }
      }
    }

    renderPptxPreview();

    return () => {
      cancelled = true;
    };
  }, [showPreview, previewMode]);

  async function downloadFile() {
    if (!item.filePath) {
      alert("The file is not available in storage yet.");
      return;
    }

    setDownloading(true);

    try {
      const { data, error } = await supabase.storage
        .from("resources")
        .download(item.filePath);

      if (error) {
        alert("Could not download file: " + error.message);
        return;
      }

      const url = URL.createObjectURL(data);
      const link = document.createElement("a");

      link.href = url;
      link.download = item.fileName || item.title;
      document.body.appendChild(link);
      link.click();
      link.remove();

      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } finally {
      setDownloading(false);
    }
  }

  async function previewFile() {
    setShowPreview(true);
    setPreviewError("");
    setPreviewUrl("");
    setPreviewMode("none");
    pptxBufferRef.current = null;

    if (!item.filePath) {
      setPreviewMode("fallback");
      setPreviewError("This file is not available in storage yet.");
      return;
    }

    const normalized = String(item.type || "FILE").toUpperCase();

    if (normalized === "PPT") {
      setPreviewMode("fallback");
      setPreviewError(
        "Legacy .ppt presentations use a binary format that browsers cannot render directly. Download the presentation to view it in PowerPoint, Keynote, or LibreOffice."
      );
      return;
    }

    setPreviewLoading(true);

    try {
      const { data, error } = await supabase.storage
        .from("resources")
        .download(item.filePath);

      if (error) {
        throw new Error(error.message);
      }

      if (normalized === "PDF") {
        const pdfBlob =
          data instanceof Blob && data.type === "application/pdf"
            ? data
            : new Blob([data], { type: "application/pdf" });

        const url = URL.createObjectURL(pdfBlob);
        setPreviewUrl(url);
        setPreviewMode("pdf");
      } else if (normalized === "PPTX") {
        if (data && typeof data.arrayBuffer === "function") {
          const buffer = await data.arrayBuffer();
          pptxBufferRef.current = buffer;
          setPreviewMode("pptx");
        } else {
          setPreviewMode("fallback");
          setPreviewError(
            "Slide preview is not available in this browser environment. Please download the presentation directly."
          );
        }
      } else {
        setPreviewMode("fallback");
        setPreviewError(
          "In-browser preview is not supported for this file format. Please download the file directly."
        );
      }
    } catch (error) {
      setPreviewMode("fallback");
      setPreviewError(
        error.message ||
          "Could not load the preview. You can still download the file directly."
      );
    } finally {
      setPreviewLoading(false);
    }
  }

  async function handleLikeClick(event) {
    if (event) event.stopPropagation();
    if (liking || isSuspended) return;
    setLiking(true);
    try {
      await likeResource(item.id);
    } finally {
      setLiking(false);
    }
  }

  function openEditModal(event) {
    if (event) event.stopPropagation();
    setMoreActionsOpen(false);
    setEditTitle(item.title || "");
    setEditSubject(item.subject || "");
    setEditDescription(item.description || "");
    setEditError("");
    setShowEditModal(true);
  }

  async function handleSaveEdit(event) {
    event.preventDefault();
    if (!onEditResource) return;

    const cleanTitle = editTitle.trim();
    const cleanSubject = normalizeSubjectName(editSubject);
    const cleanDescription = editDescription.trim();

    if (!cleanTitle || !cleanSubject) {
      setEditError("Title and subject are required.");
      return;
    }

    setSavingEdit(true);
    setEditError("");

    const result = await onEditResource(item.id, {
      title: cleanTitle,
      subject: cleanSubject,
      description: cleanDescription
    });

    setSavingEdit(false);

    if (result?.error) {
      setEditError(result.error);
      return;
    }

    setShowEditModal(false);
  }

  function triggerDeletePrompt(event) {
    if (event) event.stopPropagation();
    setMoreActionsOpen(false);
    setShowDeleteConfirm(true);
  }

  async function handleConfirmDelete() {
    if (!onDeleteResource || deleting) return;

    setDeleting(true);
    try {
      await onDeleteResource(item);
      setShowDeleteConfirm(false);
    } finally {
      setDeleting(false);
    }
  }

  function handleRowKeyDown(event) {
    if (event.target !== event.currentTarget) return;
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      previewFile();
    }
  }

  const normalizedType = String(item.type || "FILE").toUpperCase();
  const badgeClass =
    normalizedType === "PDF"
      ? "file-icon file-icon-pdf"
      : normalizedType === "PPT" || normalizedType === "PPTX"
      ? "file-icon file-icon-ppt"
      : "file-icon";

  const uploaderName = item.uploaderName || item.uploader || "ResourceHub user";
  const uploaderInitials = getUploaderInitials(uploaderName);

  return (
    <>
      <article
        className="resource-row"
        onClick={previewFile}
        onKeyDown={handleRowKeyDown}
        tabIndex={0}
        aria-label={`${item.title}, ${normalizedType} file`}
      >
        {/* Mobile Top Header (Visible on mobile cards) */}
        <div className="mobile-card-topbar">
          <div className="mobile-card-badges">
            <span className={badgeClass} aria-label={`${normalizedType} file`}>
              <svg
                className="file-icon-glyph"
                width="11"
                height="11"
                viewBox="0 0 12 12"
                fill="none"
                aria-hidden="true"
              >
                <path
                  d="M2.5 1.5H7.5L9.5 3.5V10.5H2.5V1.5Z"
                  stroke="currentColor"
                  strokeWidth="1.2"
                  strokeLinejoin="round"
                />
              </svg>
              <span>{normalizedType}</span>
            </span>
            <span className="subject-pill">{item.subject}</span>
          </div>

          <div
            className="mobile-card-top-actions"
            onClick={(e) => e.stopPropagation()}
          >
            <button
              type="button"
              className={item.likedByMe ? "like-button liked" : "like-button"}
              onClick={handleLikeClick}
              disabled={liking || isSuspended}
              aria-label={item.likedByMe ? "Unlike resource" : "Like resource"}
            >
              <span aria-hidden="true">{item.likedByMe ? "♥" : "♡"}</span>
              <span className="like-count">{item.likes}</span>
            </button>

            {/* Mobile More Actions Trigger */}
            <div className="more-actions-container">
              <button
                ref={moreActionsTriggerRef}
                type="button"
                className="more-actions-button"
                onClick={() => setMoreActionsOpen(!moreActionsOpen)}
                aria-expanded={moreActionsOpen}
                aria-label={`More actions for ${item.title}`}
              >
                &middot;&middot;&middot;
              </button>

              {moreActionsOpen && (
                <div
                  ref={moreActionsRef}
                  className="more-actions-dropdown"
                  role="menu"
                >
                  {onOpenDiscussion && (
                    <>
                      <button
                        type="button"
                        role="menuitem"
                        className="dropdown-item"
                        onClick={() => {
                          setMoreActionsOpen(false);
                          onOpenDiscussion(item, "comments");
                        }}
                      >
                        Discuss
                        {typeof item.commentsCount === "number" &&
                        item.commentsCount > 0
                          ? ` (${item.commentsCount})`
                          : ""}
                      </button>

                      <button
                        type="button"
                        role="menuitem"
                        className="dropdown-item"
                        onClick={() => {
                          setMoreActionsOpen(false);
                          onOpenDiscussion(item, "suggestions");
                        }}
                      >
                        Suggest improvement
                      </button>

                      <button
                        type="button"
                        role="menuitem"
                        className="dropdown-item"
                        onClick={() => {
                          setMoreActionsOpen(false);
                          onOpenDiscussion(item, "report");
                        }}
                      >
                        Report issue
                      </button>
                    </>
                  )}

                  {canManageResource && (
                    <>
                      <div className="dropdown-divider" />
                      <button
                        type="button"
                        role="menuitem"
                        className="dropdown-item"
                        onClick={openEditModal}
                      >
                        Edit resource
                      </button>
                      <button
                        type="button"
                        role="menuitem"
                        className="dropdown-item dropdown-item-danger"
                        onClick={triggerDeletePrompt}
                      >
                        Delete resource
                      </button>
                    </>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Desktop File Icon Badge (Hidden on mobile cards) */}
        <span
          className={`desktop-badge ${badgeClass}`}
          aria-label={`${normalizedType} file`}
        >
          <svg
            className="file-icon-glyph"
            width="11"
            height="11"
            viewBox="0 0 12 12"
            fill="none"
            aria-hidden="true"
          >
            <path
              d="M2.5 1.5H7.5L9.5 3.5V10.5H2.5V1.5Z"
              stroke="currentColor"
              strokeWidth="1.2"
              strokeLinejoin="round"
            />
          </svg>
          <span>{normalizedType}</span>
        </span>

        {/* Resource Body / Meta */}
        <div className="resource-info">
          <div className="resource-title-line">
            <h3 title={item.title}>{item.title}</h3>
            <span className="desktop-subject-pill subject-pill">
              {item.subject}
            </span>
          </div>

          {item.description ? (
            <p className="resource-description-snippet">{item.description}</p>
          ) : null}

          <p className="resource-meta">
            <span className="uploader-avatar-chip" aria-hidden="true">
              {uploaderInitials}
            </span>
            <span className="resource-uploader">
              Uploaded by <strong>{uploaderName}</strong>
              {item.designation ? (
                <span className="uploader-designation">
                  {" "}
                  &middot; {item.designation}
                </span>
              ) : null}
            </span>
            <span className="meta-dot" aria-hidden="true">
              &middot;
            </span>
            <span className="resource-date">{item.date}</span>
          </p>
        </div>

        {/* Desktop / Tablet Resource Actions */}
        <div
          className="resource-actions desktop-actions"
          onClick={(event) => event.stopPropagation()}
        >
          <button
            type="button"
            className={item.likedByMe ? "like-button liked" : "like-button"}
            onClick={handleLikeClick}
            disabled={liking || isSuspended}
            aria-label={item.likedByMe ? "Unlike resource" : "Like resource"}
          >
            <span aria-hidden="true">{item.likedByMe ? "♥" : "♡"}</span>
            <span className="like-count">{item.likes}</span>
          </button>

          {onOpenDiscussion && (
            <>
              <button
                type="button"
                className="action-button"
                onClick={() => onOpenDiscussion(item, "comments")}
                aria-label={`Discuss ${item.title}`}
              >
                Discuss
                {typeof item.commentsCount === "number" &&
                item.commentsCount > 0
                  ? ` (${item.commentsCount})`
                  : ""}
              </button>

              <button
                type="button"
                className="action-button"
                onClick={() => onOpenDiscussion(item, "suggestions")}
                aria-label={`Suggest improvement for ${item.title}`}
              >
                Suggest
              </button>
            </>
          )}

          <button
            type="button"
            className="action-button"
            onClick={previewFile}
          >
            Preview
          </button>

          <button
            type="button"
            className="action-button action-button-primary"
            onClick={downloadFile}
            disabled={downloading}
          >
            {downloading ? "Saving..." : "Download"}
          </button>

          {canManageResource && (
            <>
              <button
                type="button"
                className="action-button"
                onClick={openEditModal}
                aria-label={`Edit ${item.title}`}
              >
                Edit
              </button>

              <button
                type="button"
                className="action-button danger-link"
                onClick={triggerDeletePrompt}
                disabled={deleting}
                aria-label={`Delete ${item.title}`}
              >
                {deleting ? "Deleting..." : "Delete"}
              </button>
            </>
          )}
        </div>

        {/* Mobile Bottom Action Bar (1-click touch targets) */}
        <div
          className="mobile-card-bottombar"
          onClick={(e) => e.stopPropagation()}
        >
          <button
            type="button"
            className="mobile-card-btn preview-card-btn"
            onClick={previewFile}
          >
            <svg
              width="14"
              height="14"
              viewBox="0 0 16 16"
              fill="none"
              aria-hidden="true"
            >
              <path
                d="M8 3C4.5 3 1.5 8 1.5 8C1.5 8 4.5 13 8 13C11.5 13 14.5 8 14.5 8C14.5 8 11.5 3 8 3Z"
                stroke="currentColor"
                strokeWidth="1.3"
              />
              <circle
                cx="8"
                cy="8"
                r="2.5"
                stroke="currentColor"
                strokeWidth="1.3"
              />
            </svg>
            Preview
          </button>

          <button
            type="button"
            className="mobile-card-btn download-card-btn"
            onClick={downloadFile}
            disabled={downloading}
          >
            <svg
              width="14"
              height="14"
              viewBox="0 0 16 16"
              fill="none"
              aria-hidden="true"
            >
              <path
                d="M8 2.5V10.5M8 10.5L5 7.5M8 10.5L11 7.5M2.5 13.5H13.5"
                stroke="currentColor"
                strokeWidth="1.3"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
            {downloading ? "Saving..." : "Download"}
          </button>
        </div>
      </article>

      {/* Preview Modal */}
      {showPreview && (
        <div className="preview-overlay" onClick={closePreview}>
          <section
            className="preview-modal"
            role="dialog"
            aria-modal="true"
            aria-label={"Preview: " + item.title}
            onClick={(event) => event.stopPropagation()}
          >
            <header className="preview-header">
              <div className="preview-header-meta">
                <span className={badgeClass}>{normalizedType}</span>
                <div className="preview-header-titles">
                  <h2>{item.title}</h2>
                  <span>{item.fileName || item.title}</span>
                </div>
              </div>

              <div className="preview-header-actions">
                {onOpenDiscussion && (
                  <button
                    type="button"
                    className="action-button desktop-only-btn"
                    onClick={() => {
                      closePreview();
                      onOpenDiscussion(item, "report");
                    }}
                  >
                    Report issue
                  </button>
                )}
                <button
                  type="button"
                  className="download-button"
                  onClick={downloadFile}
                  disabled={downloading}
                >
                  {downloading ? "Saving..." : "Download"}
                </button>
                <button
                  type="button"
                  className="preview-close"
                  onClick={closePreview}
                  aria-label="Close preview"
                >
                  &times;
                </button>
              </div>
            </header>

            <div className="preview-content">
              {previewLoading ? (
                <div className="preview-loading-state">
                  <span className="btn-spinner" aria-hidden="true" />
                  <p className="status-text">Preparing preview...</p>
                </div>
              ) : previewMode === "pdf" && previewUrl ? (
                <iframe
                  src={previewUrl}
                  title={"Preview of " + item.title}
                  className="preview-frame"
                />
              ) : previewMode === "pptx" ? (
                <div
                  ref={pptxContainerRef}
                  className="pptx-preview-container"
                  data-testid="pptx-preview-container"
                />
              ) : (
                <div className="preview-message">
                  <div className="fallback-card-icon" aria-hidden="true">
                    📄
                  </div>
                  <h3>Direct download available</h3>
                  <p>
                    {previewError ||
                      "This file cannot be previewed directly in the browser."}
                  </p>
                  <div className="preview-fallback-actions">
                    <button
                      type="button"
                      className="download-button"
                      onClick={downloadFile}
                      disabled={downloading}
                    >
                      {downloading ? "Saving..." : "Download file"}
                    </button>
                    {onOpenDiscussion && (
                      <button
                        type="button"
                        className="secondary-button"
                        onClick={() => {
                          closePreview();
                          onOpenDiscussion(item, "report");
                        }}
                      >
                        Report corrupt file
                      </button>
                    )}
                  </div>
                </div>
              )}
            </div>
          </section>
        </div>
      )}

      {/* Edit Modal */}
      {showEditModal && (
        <div
          className="preview-overlay"
          onClick={() => setShowEditModal(false)}
        >
          <section
            className="dialog-modal"
            role="dialog"
            aria-modal="true"
            aria-label={`Edit resource: ${item.title}`}
            onClick={(event) => event.stopPropagation()}
          >
            <header className="preview-header">
              <div>
                <h2>Edit Resource</h2>
                <span>Update title, subject, or description</span>
              </div>
              <button
                type="button"
                className="preview-close"
                onClick={() => setShowEditModal(false)}
                aria-label="Close edit resource modal"
              >
                &times;
              </button>
            </header>

            <form className="dialog-body" onSubmit={handleSaveEdit}>
              <div className="upload-field">
                <label className="field-label" htmlFor={`edit-title-${item.id}`}>
                  Title
                </label>
                <input
                  id={`edit-title-${item.id}`}
                  type="text"
                  value={editTitle}
                  onChange={(event) => setEditTitle(event.target.value)}
                  maxLength={200}
                  required
                />
              </div>

              <div className="upload-field">
                <label
                  className="field-label"
                  htmlFor={`edit-subject-${item.id}`}
                >
                  Subject
                </label>
                <input
                  id={`edit-subject-${item.id}`}
                  type="text"
                  value={editSubject}
                  onChange={(event) => setEditSubject(event.target.value)}
                  maxLength={80}
                  required
                />
              </div>

              <div className="upload-field">
                <label
                  className="field-label"
                  htmlFor={`edit-description-${item.id}`}
                >
                  Description (optional)
                </label>
                <textarea
                  id={`edit-description-${item.id}`}
                  value={editDescription}
                  onChange={(event) => setEditDescription(event.target.value)}
                  maxLength={1000}
                  rows={3}
                />
              </div>

              {editError && (
                <p className="upload-feedback upload-feedback-error" role="alert">
                  {editError}
                </p>
              )}

              <div className="dialog-footer">
                <button
                  type="button"
                  className="secondary-button"
                  onClick={() => setShowEditModal(false)}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="upload-submit-button"
                  disabled={savingEdit}
                >
                  {savingEdit ? "Saving..." : "Save changes"}
                </button>
              </div>
            </form>
          </section>
        </div>
      )}

      {/* Delete Confirmation Modal */}
      {showDeleteConfirm && (
        <div
          className="preview-overlay"
          onClick={() => setShowDeleteConfirm(false)}
        >
          <section
            className="dialog-modal dialog-modal-compact"
            role="dialog"
            aria-modal="true"
            aria-label={`Confirm delete: ${item.title}`}
            onClick={(event) => event.stopPropagation()}
          >
            <header className="preview-header">
              <div>
                <h2>Delete Resource</h2>
                <span>Permanent file and database removal</span>
              </div>
              <button
                type="button"
                className="preview-close"
                onClick={() => setShowDeleteConfirm(false)}
                aria-label="Close delete confirmation"
              >
                &times;
              </button>
            </header>

            <div className="dialog-body">
              <p className="confirmation-warning-text">
                Are you sure you want to delete <strong>{item.title}</strong>?
                This action is permanent and will remove the file from storage
                as well as all associated comments and suggestions.
              </p>

              <div className="dialog-footer">
                <button
                  type="button"
                  className="secondary-button"
                  onClick={() => setShowDeleteConfirm(false)}
                  disabled={deleting}
                >
                  Cancel
                </button>
                <button
                  type="button"
                  className="upload-submit-button danger-button"
                  onClick={handleConfirmDelete}
                  disabled={deleting}
                  aria-label={`Confirm delete ${item.title}`}
                >
                  {deleting ? "Deleting..." : "Confirm delete"}
                </button>
              </div>
            </div>
          </section>
        </div>
      )}
    </>
  );
}

export default ResourceRow;
