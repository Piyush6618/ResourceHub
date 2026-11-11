import { useEffect, useState } from "react";
import { supabase } from "../supabaseClient";

function ResourceRow({ item, likeResource, session }) {
  const [showPreview, setShowPreview] = useState(false);
  const [previewUrl, setPreviewUrl] = useState("");
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewError, setPreviewError] = useState("");
  const [downloading, setDownloading] = useState(false);

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
        setShowPreview(false);
        setPreviewError("");
        setPreviewUrl("");
      }
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [showPreview]);

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
    setPreviewLoading(true);

    if (!item.filePath) {
      setPreviewLoading(false);
      setPreviewError("This file is not available in storage yet.");
      return;
    }

    try {
      let fileBlob;

      if (item.type === "PDF") {
        const { data, error } = await supabase.storage
          .from("resources")
          .download(item.filePath);

        if (error) {
          throw new Error(error.message);
        }

        fileBlob = data;
      } else if (item.type === "PPT" || item.type === "PPTX") {
        if (!session || !session.access_token) {
          throw new Error("Please sign in again to preview this presentation.");
        }

        const response = await fetch(
          `/api/google/preview?id=${encodeURIComponent(item.id)}`,
          {
            headers: {
              Authorization: `Bearer ${session.access_token}`
            }
          }
        );

        if (!response.ok) {
          const message = await response.text();
          throw new Error(message || "Could not convert this presentation.");
        }

        fileBlob = await response.blob();
      } else {
        throw new Error("Preview is not supported for this file type.");
      }

      if (fileBlob.type && fileBlob.type !== "application/pdf") {
        throw new Error("The server did not return a PDF preview.");
      }

      const url = URL.createObjectURL(fileBlob);
      setPreviewUrl(url);
    } catch (error) {
      setPreviewError(error.message || "Could not load the preview.");
    } finally {
      setPreviewLoading(false);
    }
  }

  function closePreview() {
    setShowPreview(false);
    setPreviewError("");
    setPreviewUrl("");
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
            onClick={() => likeResource(item.id)}
            aria-label={item.likedByMe ? "Unlike resource" : "Like resource"}
          >
            <span aria-hidden="true">{item.likedByMe ? "♥" : "♡"}</span>
            <span className="like-count">{item.likes}</span>
          </button>

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
              ) : previewError ? (
                <div className="preview-message">
                  <p>{previewError}</p>
                  <button
                    type="button"
                    className="download-button"
                    onClick={downloadFile}
                    disabled={downloading}
                  >
                    Download file
                  </button>
                </div>
              ) : previewUrl ? (
                <iframe
                  src={previewUrl}
                  title={"Preview of " + item.title}
                  className="preview-frame"
                />
              ) : null}
            </div>
          </section>
        </div>
      )}
    </>
  );
}

export default ResourceRow;
