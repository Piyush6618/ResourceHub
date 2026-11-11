function getInitials(displayName, email) {
  const source = (displayName || email || "U").trim();
  const parts = source.split(/[\s._@-]+/).filter(Boolean);

  if (parts.length >= 2) {
    return (parts[0][0] + parts[1][0]).toUpperCase();
  }

  return source.slice(0, 2).toUpperCase();
}

function TopBar({
  session,
  userRole,
  userProfile,
  onSignOut,
  onToggleSidebar
}) {
  const roleLabel =
    userRole === "facilitator"
      ? "Facilitator"
      : userRole === "teacher"
      ? "Teacher"
      : "Student";

  const initials = getInitials(
    userProfile?.display_name,
    session?.user?.email
  );

  return (
    <header className="topbar">
      <div className="topbar-inner">
        <div className="topbar-brand">
          {onToggleSidebar && (
            <button
              type="button"
              className="mobile-menu-button"
              onClick={onToggleSidebar}
              aria-label="Toggle subjects navigation"
            >
              <svg
                width="16"
                height="16"
                viewBox="0 0 16 16"
                fill="none"
                aria-hidden="true"
              >
                <path
                  d="M2.5 4H13.5M2.5 8H13.5M2.5 12H13.5"
                  stroke="currentColor"
                  strokeWidth="1.5"
                  strokeLinecap="round"
                />
              </svg>
            </button>
          )}

          <span className="brand-mark" aria-hidden="true">
            <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
              <path
                d="M3 2.5C3 1.94772 3.44772 1.5 4 1.5H12C12.5523 1.5 13 1.94772 13 2.5V13.5C13 14.0523 12.5523 14.5 12 14.5H4C3.44772 14.5 3 14.0523 3 13.5V2.5Z"
                stroke="currentColor"
                strokeWidth="1.4"
              />
              <path
                d="M5.5 5H10.5M5.5 8H10.5M5.5 11H8.5"
                stroke="currentColor"
                strokeWidth="1.4"
                strokeLinecap="round"
              />
            </svg>
          </span>

          <h2>ResourceHub</h2>

          <span className="role-badge">
            <span className="status-dot" aria-hidden="true" />
            {roleLabel}
          </span>
        </div>

        {session?.user && (
          <div className="account-bar">
            <div className="account-identity">
              <span className="account-avatar" aria-hidden="true">
                {initials}
              </span>
              <div className="account-text">
                {userProfile?.display_name && (
                  <span className="account-name">
                    {userProfile.display_name}
                  </span>
                )}
                <span className="account-email">{session.user.email}</span>
              </div>
            </div>

            {onSignOut && (
              <button
                type="button"
                className="signout-button"
                onClick={onSignOut}
              >
                Sign out
              </button>
            )}
          </div>
        )}
      </div>
    </header>
  );
}

export default TopBar;
