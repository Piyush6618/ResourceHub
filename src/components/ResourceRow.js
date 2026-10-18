
import { supabase } from "../supabaseClient";

function ResourceRow({ item, likeResource }) {
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
    link.click();

    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  return (
    <article className="resource-row">
      <div className="file-icon">{item.type}</div>

      <div className="resource-info">
        <h3>{item.title}</h3>
        <p>{item.subject} · Uploaded by {item.uploader}</p>
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
        className="download-button"
        onClick={downloadFile}
      >
        Download
      </button>
    </article>
  );
}

export default ResourceRow;
