
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

  return (
    <button
      type="button"
      className="google-connect-button"
      onClick={connectGoogleDrive}
    >
      Connect Google Drive
    </button>
  );
}

export default GoogleDriveConnect;
