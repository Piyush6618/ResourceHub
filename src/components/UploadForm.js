
import { useState } from "react";

function UploadForm({ addResource }) {
  const [title, setTitle] = useState("");
  const [subject, setSubject] = useState("");
  const [file, setFile] = useState(null);
  const [uploading, setUploading] = useState(false);

  async function handleSubmit(event) {
    event.preventDefault();

    if (!title.trim() || !subject.trim() || !file) {
      alert("Please enter the title, subject, and select a file.");
      return;
    }

    const extension = file.name.split(".").pop().toUpperCase();

    if (!["PDF", "PPT", "PPTX"].includes(extension)) {
      alert("Please select a PDF, PPT, or PPTX file.");
      return;
    }

    if (file.size > 20 * 1024 * 1024) {
      alert("Please select a file smaller than 20 MB.");
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
      }
    } catch (error) {
      alert("Upload failed: " + error.message);
    }

    setUploading(false);
  }

  return (
    <form className="upload-form" onSubmit={handleSubmit}>
      <h2>Add a resource</h2>

      <input
        type="text"
        placeholder="Resource title"
        value={title}
        onChange={(event) => setTitle(event.target.value)}
        required
      />

      <input
        type="text"
        placeholder="Subject name"
        value={subject}
        onChange={(event) => setSubject(event.target.value)}
        required
      />

      <input
        type="file"
        accept=".pdf,.ppt,.pptx"
        onChange={(event) => setFile(event.target.files[0] || null)}
        required
      />

      <button type="submit" disabled={uploading}>
        {uploading ? "Uploading..." : "Add resource"}
      </button>
    </form>
  );
}

export default UploadForm;
