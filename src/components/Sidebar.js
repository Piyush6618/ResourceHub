import { useEffect } from "react";

function Sidebar({
  subjects,
  subject,
  setSubject,
  subjectCounts = {},
  isOpen = false,
  onClose
}) {
  useEffect(() => {
    if (!isOpen) return;

    function handleKeyDown(event) {
      if (event.key === "Escape" && onClose) {
        onClose();
      }
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, onClose]);

  function handleSelect(item) {
    setSubject(item);
    if (onClose) {
      onClose();
    }
  }

  return (
    <>
      {isOpen && (
        <div
          className="sidebar-backdrop"
          onClick={onClose}
          aria-hidden="true"
        />
      )}

      <aside
        className={isOpen ? "sidebar sidebar-open" : "sidebar"}
        aria-label="Subjects Navigation"
      >
        <div className="sidebar-section">
          <div className="sidebar-header">
            <div className="sidebar-header-titles">
              <span className="sidebar-sublabel">LIBRARY</span>
              <h3>Subjects</h3>
            </div>

            {onClose && (
              <button
                type="button"
                className="sidebar-close-button"
                onClick={onClose}
                aria-label="Close subjects menu"
              >
                &times;
              </button>
            )}
          </div>

          <nav className="subject-list" aria-label="Subjects">
            {subjects.map((item) => {
              const isActive = subject === item;
              const count = subjectCounts[item];

              return (
                <button
                  key={item}
                  type="button"
                  className={isActive ? "subject active" : "subject"}
                  onClick={() => handleSelect(item)}
                  aria-current={isActive ? "true" : undefined}
                >
                  <span className="subject-item-left">
                    <svg
                      className="subject-icon"
                      width="15"
                      height="15"
                      viewBox="0 0 16 16"
                      fill="none"
                      aria-hidden="true"
                    >
                      <path
                        d="M2 4.2C2 3.53726 2.53726 3 3.2 3H6.30294C6.6212 3 6.92643 3.12643 7.15147 3.35147L8.14853 4.34853C8.37357 4.57357 8.6788 4.7 8.99706 4.7H12.8C13.4627 4.7 14 5.23726 14 5.9V11.8C14 12.4627 13.4627 13 12.8 13H3.2C2.53726 13 2 12.4627 2 11.8V4.2Z"
                        stroke="currentColor"
                        strokeWidth="1.3"
                      />
                    </svg>
                    <span className="subject-name">{item}</span>
                  </span>

                  {typeof count === "number" && (
                    <span className="subject-count">{count}</span>
                  )}
                </button>
              );
            })}
          </nav>
        </div>
      </aside>
    </>
  );
}

export default Sidebar;
