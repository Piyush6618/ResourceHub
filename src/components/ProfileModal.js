import { useState } from "react";

function ProfileModal({
  session,
  userProfile,
  userRole,
  onSaveProfile,
  onClose
}) {
  const [displayName, setDisplayName] = useState(
    userProfile?.display_name || ""
  );
  const [designation, setDesignation] = useState(
    userProfile?.designation || ""
  );
  const [saving, setSaving] = useState(false);
  const [feedback, setFeedback] = useState({ type: "", text: "" });

  async function handleSubmit(event) {
    event.preventDefault();
    setFeedback({ type: "", text: "" });

    const cleanName = displayName.trim();
    const cleanDesignation = designation.trim();

    if (!cleanName || cleanName.length > 80) {
      setFeedback({
        type: "error",
        text: "Display name must be between 1 and 80 characters."
      });
      return;
    }

    if (cleanDesignation.length > 100) {
      setFeedback({
        type: "error",
        text: "Designation must be 100 characters or fewer."
      });
      return;
    }

    setSaving(true);
    const result = await onSaveProfile({
      display_name: cleanName,
      designation: cleanDesignation
    });
    setSaving(false);

    if (result?.error) {
      setFeedback({ type: "error", text: result.error });
    } else {
      setFeedback({
        type: "success",
        text: "Profile updated successfully."
      });
    }
  }

  return (
    <div className="preview-overlay" onClick={onClose}>
      <section
        className="dialog-modal"
        role="dialog"
        aria-modal="true"
        aria-label="Edit profile"
        onClick={(event) => event.stopPropagation()}
      >
        <header className="preview-header">
          <div>
            <h2>Profile settings</h2>
            <span>Update how your name appears on shared resources and comments.</span>
          </div>
          <button
            type="button"
            className="preview-close"
            onClick={onClose}
            aria-label="Close profile settings"
          >
            &times;
          </button>
        </header>

        <form className="dialog-body" onSubmit={handleSubmit}>
          <div className="upload-field">
            <label className="field-label" htmlFor="profile-email-readonly">
              Account email (read-only)
            </label>
            <input
              id="profile-email-readonly"
              type="email"
              value={session?.user?.email || ""}
              disabled
            />
          </div>

          <div className="upload-field">
            <label className="field-label" htmlFor="profile-role-readonly">
              Platform role (managed by system)
            </label>
            <input
              id="profile-role-readonly"
              type="text"
              value={userRole === "admin" ? "Administrator (admin)" : "Community Member (user)"}
              disabled
            />
          </div>

          <div className="upload-field">
            <label className="field-label" htmlFor="profile-display-name">
              Display name
            </label>
            <input
              id="profile-display-name"
              type="text"
              placeholder="Your full name"
              maxLength={80}
              value={displayName}
              onChange={(event) => setDisplayName(event.target.value)}
              required
            />
          </div>

          <div className="upload-field">
            <label className="field-label" htmlFor="profile-designation">
              Headline / Designation (optional)
            </label>
            <input
              id="profile-designation"
              type="text"
              placeholder="e.g., CS Undergraduate, Educator, Researcher"
              maxLength={100}
              value={designation}
              onChange={(event) => setDesignation(event.target.value)}
            />
          </div>

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

          <div className="dialog-footer">
            <button
              type="button"
              className="secondary-button"
              onClick={onClose}
            >
              Close
            </button>
            <button
              type="submit"
              className="upload-submit-button"
              disabled={saving}
            >
              {saving ? "Saving..." : "Save profile"}
            </button>
          </div>
        </form>
      </section>
    </div>
  );
}

export default ProfileModal;
