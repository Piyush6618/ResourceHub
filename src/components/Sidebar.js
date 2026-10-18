function Sidebar({ subjects, subject, setSubject }) {
  return (
    <aside className="sidebar">
      <p className="label">LIBRARY</p>
      <h3>Subjects</h3>

      {subjects.map((item) => (
        <button
          key={item}
          className={subject === item ? "subject active" : "subject"}
          onClick={() => setSubject(item)}
        >
          {item}
        </button>
      ))}
    </aside>
  );
}

export default Sidebar;