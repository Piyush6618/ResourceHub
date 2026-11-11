import { useState, useRef } from "react";
import {
  normalizeSubjectName,
  validateUploadFile
} from "../utils/fileValidation";

function formatFileSize(bytes) {
  if (typeof bytes !== "number" || Number.isNaN(bytes)) return "";
  if (bytes < 1024) return `${bytes} B`;
  const kb = bytes / 1024;
  if (kb < 1024) return `${kb.toFixed(1)} KB`;
  const mb = kb / 1024;
  return `${mb.toFixed(2)} MB`;
}

function UploadForm({ addResource, existingSubjects = [] }) {
  const [title, setTitle] = useState("");
  const [subject, setSubject] = useState("");
  const [file, setFile] = useState(null);
  const [uploading, setUploading] = useState(false);
  const [collapsed, setCollapsed] = useState(false);
  const [dragActive, setDragActive] = useState(false);
  const [feedback, setFeedback] = useState({ type: "", text: "" });

  const fileInputRef = useRef(null);

  function handleFileChange(selectedFile) {
    setFeedback({ type: "", text: "" });
    setFile(selectedFile || null);
  }

  function handleDragOver(event) {
    event.preventDefault();
    setDragActive(true);
  }

  function handleDragLeave(event) {
    event.preventDefault();
    setDragActive(false);
  }

  function handleDrop(event) {
    event.preventDefault();
    setDragActive(false);
    const droppedFile = event.dataTransfer?.files?.[0];
    if (droppedFile) {
      handleFileChange(droppedFile);
    }
  }

  function handleRemoveFile() {
    setFile(null);
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
  }

  async function handleSubmit(event) {
    event.preventDefault();
    setFeedback({ type: "", text: "" });

    const cleanTitle = title.trim();
    const cleanSubject = normalizeSubjectName(subject);

    if (!cleanTitle || !cleanSubject || !file) {
      setFeedback({
        type: "error",
        text: "Please enter the title, subject, and select a file."
      });
      return;
    }

    const validation = await validateUploadFile(file);
    if (!validation.valid) {
      setFeedback({
        type: "error",
        text: validation.error
      });
      return;
    }

    setUploading(true);

    try {
      const success = await addResource({
        title: cleanTitle,
        subject: cleanSubject,
        type: validation.extension,
        mimeType: validation.mimeType,
        file: file
      });

      if (success) {
        setTitle("");
        setSubject("");
        setFile(null);
        if (fileInputRef.current) {
          fileInputRef.current.value = "";
        }
        event.target.reset();
        setFeedback({
          type: "success",
          text: "Resource uploaded successfully."
        });
      }
    } catch (error) {
      setFeedback({
        type: "error",
        text: "Upload failed: " + error.message
      });
    }

    setUploading(false);
  }

  const canonicalSubjectOptions = existingSubjects.filter(
    (s) => s && s !== "All Subjects"
  );

  return (
    <section className="upload-form-card" aria-labelledby="upload-form-heading">
      <div className="upload-form-header">
        <div className="upload-header-copy">
          <div className="upload-title-row">
            <h2 id="upload-form-heading">Add a resource</h2>
            <span className="upload-pill-tag">Community Upload</span>
          </div>
          <p className="upload-spec">
            Supported formats: PDF, PPT, PPTX &middot; Maximum size: 20 MB
          </p>
        </div>

        <button
          type="button"
          className="upload-collapse-button"
          onClick={() => setCollapsed(!collapsed)}
          aria-expanded={!collapsed}
          aria-label={collapsed ? "Expand upload form" : "Collapse upload form"}
        >
          {collapsed ? "Expand Form" : "Collapse"}
        </button>
      </div>

      {!collapsed && (
        <form className="upload-form-body" onSubmit={handleSubmit}>
          <div className="upload-form-grid">
            <div className="upload-field title-field">
              <label className="field-label" htmlFor="resource-title-input">
                Resource Title
              </label>
              <input
                id="resource-title-input"
                type="text"
                placeholder="Resource title"
                maxLength={200}
                value={title}
                onChange={(event) => setTitle(event.target.value)}
                required
              />
            </div>

            <div className="upload-field subject-field">
              <label className="field-label" htmlFor="resource-subject-input">
                Subject
              </label>
              <input
                id="resource-subject-input"
                type="text"
                list="resource-subject-suggestions"
                placeholder="Subject name"
                maxLength={80}
                value={subject}
                onChange={(event) => setSubject(event.target.value)}
                required
              />
              {canonicalSubjectOptions.length > 0 && (
                <datalist id="resource-subject-suggestions">
                  {canonicalSubjectOptions.map((item) => (
                    <option key={item} value={item} />
                  ))}
                </datalist>
              )}
            </div>

            <div
              className={
                dragActive
                  ? "upload-field upload-file-zone drag-active"
                  : "upload-field upload-file-zone"
              }
              onDragOver={handleDragOver}
              onDragLeave={handleDragLeave}
              onDrop={handleDrop}
            >
              <label className="field-label" htmlFor="resource-file-input">
                File Attachment
              </label>
              <div className="file-input-wrapper">
                <input
                  ref={fileInputRef}
                  id="resource-file-input"
                  type="file"
                  accept=".pdf,.ppt,.pptx"
                  onChange={(event) =>
                    handleFileChange(event.target.files[0] || null)
                  }
                  required={!file}
                />
              </div>
            </div>
          </div>

          {file && (
            <div className="selected-file-card" role="status">
              <div className="selected-file-info">
                <svg
                  className="selected-file-icon"
                  width="16"
                  height="16"
                  viewBox="0 0 16 16"
                  fill="none"
                  aria-hidden="true"
                >
                  <path
                    d="M3 2.5C3 1.95 3.45 1.5 4 1.5H9.5L13 5V13.5C13 14.05 12.55 14.5 12 14.5H4C3.45 14.5 3 14.05 3 13.5V2.5Z"
                    stroke="currentColor"
                    strokeWidth="1.3"
                  />
                  <path
                    d="M9.5 1.5V5H13"
                    stroke="currentColor"
                    strokeWidth="1.3"
                  />
                </svg>
                <div className="selected-file-meta">
                  <span className="selected-file-name">{file.name}</span>
                  <span className="selected-file-size">
                    {formatFileSize(file.size)}
                  </span>
                </div>
              </div>

              <button
                type="button"
                className="remove-file-button"
                onClick={handleRemoveFile}
                aria-label="Remove selected file"
              >
                &times;
              </button>
            </div>
          )}

          {feedback.text && (
            <div
              className={
                feedback.type === "success"
                  ? "upload-feedback upload-feedback-success"
                  : "upload-feedback upload-feedback-error"
              }
              role={feedback.type === "error" ? "alert" : "status"}
            >
              {feedback.text}
            </div>
          )}

          <div className="upload-actions-bar">
            <button
              type="submit"
              className="upload-submit-button"
              disabled={uploading}
            >
              {uploading ? (
                <span className="spinner-label">
                  <span className="btn-spinner" aria-hidden="true" />
                  Uploading...
                </span>
              ) : (
                "Add resource"
              )}
            </button>
          </div>
        </form>
      )}
    </section>
  );
}

export default UploadForm;
