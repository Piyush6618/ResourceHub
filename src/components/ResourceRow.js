import { useCallback, useEffect, useRef, useState } from "react";
import { supabase } from "../supabaseClient";
import { normalizeSubjectName } from "../utils/fileValidation";

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

  const [showEditModal, setShowEditModal] = useState(false);
  const [editTitle, setEditTitle] = useState(item.title || "");
  const [editSubject, setEditSubject] = useState(item.subject || "");
  const [editDescription, setEditDescription] = useState(
    item.description || ""
  );
  const [savingEdit, setSavingEdit] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [editError, setEditError] = useState("");

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

  useEffect(() => {
    if (!showPreview) return;

    function handleKeyDown(event) {
      if (event.key === "Escape") {
        closePreview();
      }
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [showPreview, closePreview]);

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

        // Sanitize any raw HTML tags that pptx-preview could have injected into text spans
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

  async function handleLikeClick() {
    if (liking || isSuspended) return;
    setLiking(true);
    try {
      await likeResource(item.id);
    } finally {
      setLiking(false);
    }
  }

  function openEditModal() {
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

  async function handleDeleteClick() {
    if (!onDeleteResource || deleting) return;

    setDeleting(true);
    try {
      await onDeleteResource(item);
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

  return (
    <>
      <article
        className="resource-row"
        onClick={previewFile}
        onKeyDown={handleRowKeyDown}
        tabIndex={0}
      >
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

        <div className="resource-info">
          <div className="resource-title-line">
            <h3 title={item.title}>{item.title}</h3>
            <span className="subject-pill">{item.subject}</span>
          </div>

          <p className="resource-meta">
            <span className="resource-uploader">
              Uploaded by{" "}
              <strong>
                {item.uploaderName || item.uploader || "ResourceHub user"}
              </strong>
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

        <div
          className="resource-actions"
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
                className="preview-button"
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
                className="preview-button"
                onClick={() => onOpenDiscussion(item, "suggestions")}
                aria-label={`Suggest improvement for ${item.title}`}
              >
                Suggest
              </button>
            </>
          )}

          <button
            type="button"
            className="preview-button"
            onClick={previewFile}
          >
            Preview
          </button>

          <button
            type="button"
            className="download-button"
            onClick={downloadFile}
            disabled={downloading}
          >
            {downloading ? "Saving..." : "Download"}
          </button>

          {canManageResource && (
            <>
              <button
                type="button"
                className="preview-button"
                onClick={openEditModal}
                aria-label={`Edit ${item.title}`}
              >
                Edit
              </button>

              <button
                type="button"
                className="preview-button danger-link"
                onClick={handleDeleteClick}
                disabled={deleting}
                aria-label={`Delete ${item.title}`}
              >
                {deleting ? "Deleting..." : "Delete"}
              </button>
            </>
          )}
        </div>
      </article>

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
                <div>
                  <h2>{item.title}</h2>
                  <span>{item.fileName || item.title}</span>
                </div>
              </div>

              <div className="preview-header-actions">
                {onOpenDiscussion && (
                  <button
                    type="button"
                    className="preview-button"
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
                        className="preview-button"
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
                <input
                  id={`edit-description-${item.id}`}
                  type="text"
                  value={editDescription}
                  onChange={(event) => setEditDescription(event.target.value)}
                  maxLength={1000}
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
    </>
  );
}

export default ResourceRow;
