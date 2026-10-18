
import { useEffect, useState } from "react";
import { supabase } from "../supabaseClient";

function ResourceRow({ item, likeResource, session }) {
  const [showPreview, setShowPreview] = useState(false);
  const [previewUrl, setPreviewUrl] = useState("");
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewError, setPreviewError] = useState("");

  useEffect(() => {
    return () => {
      if (previewUrl) {
        URL.revokeObjectURL(previewUrl);
      }
    };
  }, [previewUrl]);

  async function downloadFile() {
    if (!item.filePath) {
      alert("The file is not available in storage yet.");
      return;
    }

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

  return (
    <>
      <article className="resource-row">
        <div className="file-icon">{item.type}</div>

        <div className="resource-info">
          <h3>{item.title}</h3>

          <p>
            {item.subject} · Uploaded by{" "}
            {item.uploaderName || item.uploader || "ResourceHub user"}
          </p>

          {item.designation && <p>{item.designation}</p>}

          <span>{item.date}</span>
        </div>

        <button
          className="like-button"
          onClick={() => likeResource(item.id)}
          aria-label={item.likedByMe ? "Unlike resource" : "Like resource"}
        >
          {item.likedByMe ? "♥" : "♡"} {item.likes}
        </button>

        <button
          className="preview-button"
          onClick={previewFile}
        >
          Preview
        </button>

        <button
          className="download-button"
          onClick={downloadFile}
        >
          Download
        </button>
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
            <div className="preview-header">
              <div>
                <h2>{item.title}</h2>
                <span>{item.fileName || item.title}</span>
              </div>

              <button
                className="preview-close"
                onClick={closePreview}
                aria-label="Close preview"
              >
                ×
              </button>
            </div>

            <div className="preview-content">
              {previewLoading ? (
                <p>Preparing preview...</p>
              ) : previewError ? (
                <div className="preview-message">
                  <p>{previewError}</p>
                  <button
                    className="download-button"
                    onClick={downloadFile}
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
