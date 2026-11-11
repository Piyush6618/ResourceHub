function GoogleDriveConnect({ session, userRole }) {
  async function connectGoogleDrive() {
    if (userRole !== "facilitator") {
      alert("Only facilitators can connect Google Drive.");
      return;
    }

    if (!session || !session.access_token) {
      alert("Please sign in to ResourceHub first.");
      return;
    }

    try {
      const response = await fetch("/api/google/auth", {
        method: "GET",
        headers: {
          Authorization: `Bearer ${session.access_token}`
        },
        credentials: "same-origin"
      });

      if (!response.ok) {
        const message = await response.text();
        throw new Error(message || "Could not start Google authorization.");
      }

      const data = await response.json();

      if (!data.url) {
        throw new Error("Google authorization URL was not returned.");
      }

      window.location.assign(data.url);
    } catch (error) {
      alert(error.message || "Could not connect Google Drive.");
    }
  }

  if (userRole !== "facilitator") {
    return null;
  }

  const justConnected =
    typeof window !== "undefined" &&
    new URLSearchParams(window.location.search).get("google_connected") === "1";

  return (
    <div className="integration-bar">
      <div className="integration-meta">
        <span
          className={
            justConnected
              ? "status-dot status-dot-connected"
              : "status-dot status-dot-neutral"
          }
          aria-hidden="true"
        />
        <div className="integration-text">
          <span className="integration-title">
            {justConnected
              ? "Google Drive connected"
              : "Google Drive integration"}
          </span>
          <span className="integration-subtitle">
            Used to convert PPT and PPTX slides into in-browser PDF previews.
          </span>
        </div>
      </div>

      <button
        type="button"
        className="google-connect-button"
        onClick={connectGoogleDrive}
      >
        Connect Google Drive
      </button>
    </div>
  );
}

export default GoogleDriveConnect;
