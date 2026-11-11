import { useRef } from "react";

function SubjectChips({
  subjects = [],
  activeSubject = "All Subjects",
  onSelectSubject,
  subjectCounts = {}
}) {
  const containerRef = useRef(null);

  if (!subjects || subjects.length <= 1) {
    return null;
  }

  return (
    <div
      className="subject-chips-container"
      role="region"
      aria-label="Subject filter chips"
    >
      <div className="subject-chips-scroll" ref={containerRef}>
        {subjects.map((item) => {
          const isActive = item === activeSubject;
          const count = subjectCounts[item];

          return (
            <button
              key={item}
              type="button"
              className={isActive ? "subject-chip active" : "subject-chip"}
              onClick={() => onSelectSubject(item)}
              aria-pressed={isActive}
            >
              <span className="chip-label">{item}</span>
              {typeof count === "number" && (
                <span className="chip-badge">{count}</span>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}

export default SubjectChips;
