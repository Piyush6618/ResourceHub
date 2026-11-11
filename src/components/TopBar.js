import { useState, useEffect, useRef } from "react";

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
  onToggleSidebar,
  onOpenProfile,
  onOpenModeration
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef(null);
  const triggerRef = useRef(null);

  const isSuspended = userProfile?.status === "suspended";

  const roleLabel = isSuspended
    ? "Suspended"
    : userRole === "admin"
    ? "Admin"
    : "Member";

  const initials = getInitials(
    userProfile?.display_name,
    session?.user?.email
  );

  // Close dropdown on click outside or Escape
  useEffect(() => {
    if (!menuOpen) return;

    function handleClickOutside(event) {
      if (
        menuRef.current &&
        !menuRef.current.contains(event.target) &&
        triggerRef.current &&
        !triggerRef.current.contains(event.target)
      ) {
        setMenuOpen(false);
      }
    }

    function handleKeyDown(event) {
      if (event.key === "Escape") {
        setMenuOpen(false);
        triggerRef.current?.focus();
      }
    }

    document.addEventListener("mousedown", handleClickOutside);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [menuOpen]);

  function handleProfileClick() {
    setMenuOpen(false);
    if (onOpenProfile) onOpenProfile();
  }

  function handleModerationClick() {
    setMenuOpen(false);
    if (onOpenModeration) onOpenModeration();
  }

  function handleSignOutClick() {
    setMenuOpen(false);
    if (onSignOut) onSignOut();
  }

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
                width="18"
                height="18"
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
            <svg width="15" height="15" viewBox="0 0 16 16" fill="none">
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

          <span className="brand-title">ResourceHub</span>

          <span
            className={
              isSuspended
                ? "role-badge role-badge-suspended"
                : userRole === "admin"
                ? "role-badge role-badge-admin"
                : "role-badge"
            }
          >
            <span className="status-dot" aria-hidden="true" />
            {roleLabel}
          </span>
        </div>

        {session?.user && (
          <div className="account-bar">
            {/* Desktop Quick Actions */}
            <div className="desktop-account-actions">
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

              {userRole === "admin" && onOpenModeration && (
                <button
                  type="button"
                  className="signout-button"
                  onClick={onOpenModeration}
                >
                  Moderation
                </button>
              )}

              {onOpenProfile && !isSuspended && (
                <button
                  type="button"
                  className="signout-button"
                  onClick={onOpenProfile}
                >
                  Edit profile
                </button>
              )}

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

            {/* Mobile / Tablet User Menu Toggle */}
            <div className="mobile-account-wrapper">
              <button
                ref={triggerRef}
                type="button"
                className="mobile-account-trigger"
                onClick={() => setMenuOpen(!menuOpen)}
                aria-expanded={menuOpen}
                aria-haspopup="menu"
                aria-label="User account menu"
              >
                <span className="account-avatar" aria-hidden="true">
                  {initials}
                </span>
                <svg
                  className={`menu-chevron ${menuOpen ? "open" : ""}`}
                  width="12"
                  height="12"
                  viewBox="0 0 12 12"
                  fill="none"
                  aria-hidden="true"
                >
                  <path
                    d="M2.5 4.5L6 8L9.5 4.5"
                    stroke="currentColor"
                    strokeWidth="1.4"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
              </button>

              {menuOpen && (
                <div
                  ref={menuRef}
                  className="account-dropdown-menu"
                  role="menu"
                  aria-label="User menu"
                >
                  <div className="dropdown-header">
                    <span className="dropdown-user-name">
                      {userProfile?.display_name || "Community Member"}
                    </span>
                    <span className="dropdown-user-email">
                      {session.user.email}
                    </span>
                    <span className="dropdown-user-badge">
                      Role: <strong>{roleLabel}</strong>
                    </span>
                  </div>

                  <div className="dropdown-divider" />

                  {userRole === "admin" && onOpenModeration && (
                    <button
                      type="button"
                      role="menuitem"
                      className="dropdown-item"
                      onClick={handleModerationClick}
                    >
                      <svg
                        width="14"
                        height="14"
                        viewBox="0 0 16 16"
                        fill="none"
                        aria-hidden="true"
                      >
                        <path
                          d="M8 1.5L2 4.5V8C2 11.5 4.5 14.5 8 15.5C11.5 14.5 14 11.5 14 8V4.5L8 1.5Z"
                          stroke="currentColor"
                          strokeWidth="1.3"
                        />
                      </svg>
                      Moderation Console
                    </button>
                  )}

                  {onOpenProfile && !isSuspended && (
                    <button
                      type="button"
                      role="menuitem"
                      className="dropdown-item"
                      onClick={handleProfileClick}
                    >
                      <svg
                        width="14"
                        height="14"
                        viewBox="0 0 16 16"
                        fill="none"
                        aria-hidden="true"
                      >
                        <path
                          d="M13.5 13.5H2.5V12C2.5 9.5 4.5 8 8 8C11.5 8 13.5 9.5 13.5 12V13.5Z"
                          stroke="currentColor"
                          strokeWidth="1.3"
                        />
                        <circle
                          cx="8"
                          cy="4.5"
                          r="2.5"
                          stroke="currentColor"
                          strokeWidth="1.3"
                        />
                      </svg>
                      Edit Profile
                    </button>
                  )}

                  <div className="dropdown-divider" />

                  {onSignOut && (
                    <button
                      type="button"
                      role="menuitem"
                      className="dropdown-item dropdown-item-danger"
                      onClick={handleSignOutClick}
                    >
                      <svg
                        width="14"
                        height="14"
                        viewBox="0 0 16 16"
                        fill="none"
                        aria-hidden="true"
                      >
                        <path
                          d="M6 14H3.5C2.67 14 2 13.33 2 12.5V3.5C2 2.67 2.67 2 3.5 2H6M10.5 11.5L14 8L10.5 4.5M14 8H6"
                          stroke="currentColor"
                          strokeWidth="1.3"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                        />
                      </svg>
                      Sign Out
                    </button>
                  )}
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </header>
  );
}

export default TopBar;
