import { useState } from "react";

function formatFileSize(bytes) {
  if (typeof bytes !== "number" || Number.isNaN(bytes)) return "";
  if (bytes < 1024) return `${bytes} B`;
  const kb = bytes / 1024;
  if (kb < 1024) return `${kb.toFixed(1)} KB`;
  const mb = kb / 1024;
  return `${mb.toFixed(2)} MB`;
}

function UploadForm({ addResource }) {
  const [title, setTitle] = useState("");
  const [subject, setSubject] = useState("");
  const [file, setFile] = useState(null);
  const [uploading, setUploading] = useState(false);
  const [collapsed, setCollapsed] = useState(false);
  const [dragActive, setDragActive] = useState(false);
  const [feedback, setFeedback] = useState({ type: "", text: "" });

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

  async function handleSubmit(event) {
    event.preventDefault();
    setFeedback({ type: "", text: "" });

    if (!title.trim() || !subject.trim() || !file) {
      setFeedback({
        type: "error",
        text: "Please enter the title, subject, and select a file."
      });
      return;
    }

    const extension = file.name.split(".").pop().toUpperCase();

    if (!["PDF", "PPT", "PPTX"].includes(extension)) {
      setFeedback({
        type: "error",
        text: "Please select a PDF, PPT, or PPTX file."
      });
      return;
    }

    if (file.size > 20 * 1024 * 1024) {
      setFeedback({
        type: "error",
        text: "Please select a file smaller than 20 MB."
      });
      return;
    }

    setUploading(true);

    try {
      const success = await addResource({
        title: title.trim(),
        subject: subject.trim(),
        type: extension,
        file: file
      });

      if (success) {
        setTitle("");
        setSubject("");
        setFile(null);
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

  return (
    <form className="upload-form" onSubmit={handleSubmit}>
      <div className="upload-form-header">
        <div>
          <h2>Add a resource</h2>
          <p className="upload-spec">
            Supported formats: PDF, PPT, PPTX &middot; Maximum size: 20 MB
          </p>
        </div>

        <button
          type="button"
          className="upload-collapse-button"
          onClick={() => setCollapsed(!collapsed)}
          aria-expanded={!collapsed}
        >
          {collapsed ? "Expand" : "Collapse"}
        </button>
      </div>

      {!collapsed && (
        <>
          <div className="upload-form-grid">
            <div className="upload-field">
              <label className="field-label" htmlFor="resource-title-input">
                Title
              </label>
              <input
                id="resource-title-input"
                type="text"
                placeholder="Resource title"
                value={title}
                onChange={(event) => setTitle(event.target.value)}
                required
              />
            </div>

            <div className="upload-field">
              <label className="field-label" htmlFor="resource-subject-input">
                Subject
              </label>
              <input
                id="resource-subject-input"
                type="text"
                placeholder="Subject name"
                value={subject}
                onChange={(event) => setSubject(event.target.value)}
                required
              />
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
                File
              </label>
              <input
                id="resource-file-input"
                type="file"
                accept=".pdf,.ppt,.pptx"
                onChange={(event) =>
                  handleFileChange(event.target.files[0] || null)
                }
                required={!file}
              />
            </div>

            <div className="upload-submit-cell">
              <button
                type="submit"
                className="upload-submit-button"
                disabled={uploading}
              >
                {uploading ? "Uploading..." : "Add resource"}
              </button>
            </div>
          </div>

          {file && (
            <div className="selected-file-bar">
              <span className="selected-file-name">{file.name}</span>
              <span className="selected-file-size">
                {formatFileSize(file.size)}
              </span>
            </div>
          )}

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
        </>
      )}
    </form>
  );
}

export default UploadForm;
