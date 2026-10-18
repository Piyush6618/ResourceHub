
import { useState, useEffect } from "react";
import "./App.css";
import TopBar from "./components/TopBar";
import Sidebar from "./components/Sidebar";
import ResourceRow from "./components/ResourceRow";
import UploadForm from "./components/UploadForm";
import { supabase } from "./supabaseClient";
import AuthForm from "./components/AuthForm";

function App() {
  const [search, setSearch] = useState("");
  const [subject, setSubject] = useState("All Subjects");
  const [fileType, setFileType] = useState("All Files");
  const [resourceList, setResourceList] = useState([]);
  const [session, setSession] = useState(null);
  const [userRole, setUserRole] = useState(null);
  const [authChecked, setAuthChecked] = useState(false);
  const [loadingResources, setLoadingResources] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");

  useEffect(() => {
    let mounted = true;

    async function checkSession() {
      const { data, error } = await supabase.auth.getSession();

      if (!mounted) return;

      if (error) {
        console.error(error.message);
      }

      setSession(data?.session ?? null);
      setAuthChecked(true);
    }

    checkSession();

    const { data } = supabase.auth.onAuthStateChange(
      (_event, newSession) => {
        setSession(newSession);
      }
    );

    return () => {
      mounted = false;
      data.subscription.unsubscribe();
    };
  }, []);

  useEffect(() => {
    if (!session) {
      setResourceList([]);
      setUserRole(null);
      setLoadingResources(false);
      return;
    }

    let mounted = true;

    async function loadResources() {
      setLoadingResources(true);
      setErrorMessage("");
      setUserRole(null);

      const { data: profile, error: profileError } = await supabase
        .from("profiles")
        .select("role")
        .eq("id", session.user.id)
        .single();

      if (!mounted) return;

      if (profileError) {
        setErrorMessage(
          "Could not load user role: " + profileError.message
        );
        setLoadingResources(false);
        return;
      }

      setUserRole(profile.role);

      const { data, error } = await supabase
        .from("resources")
        .select("*")
        .order("created_at", { ascending: false });

      if (!mounted) return;

      if (error) {
        setErrorMessage(error.message);
        setLoadingResources(false);
        return;
      }

      const { data: likesData, error: likesError } = await supabase
        .from("resource_likes")
        .select("resource_id, user_id");

      if (!mounted) return;

      if (likesError) {
        setErrorMessage("Could not load likes: " + likesError.message);
        setLoadingResources(false);
        return;
      }

      const formattedResources = data.map((item) => {
        const resourceLikes = likesData.filter(
          (like) => like.resource_id === item.id
        );

        const likedByMe = resourceLikes.some(
          (like) => like.user_id === session.user.id
        );

        return {
          id: item.id,
          title: item.title,
          subject: item.subject,
          type: item.file_type,
          uploader:
            item.owner_id === session.user.id
              ? session.user.email
              : "ResourceHub user",
          date: new Date(item.created_at).toLocaleDateString("en-GB", {
            day: "2-digit",
            month: "short",
            year: "numeric"
          }),
          likes: resourceLikes.length,
          likedByMe: likedByMe,
          fileName: item.file_name,
          filePath: item.file_path
        };
      });

      setResourceList(formattedResources);
      setLoadingResources(false);
    }

    loadResources();

    return () => {
      mounted = false;
    };
  }, [session]);

  const subjects = [
    "All Subjects",
    ...new Set(resourceList.map((item) => item.subject))
  ];

  const filteredResources = resourceList.filter((item) => {
    return (
      item.title.toLowerCase().includes(search.toLowerCase()) &&
      (subject === "All Subjects" || item.subject === subject) &&
      (fileType === "All Files" || item.type === fileType)
    );
  });

  async function likeResource(id) {
    const resource = resourceList.find((item) => item.id === id);

    if (!resource) return;

    setErrorMessage("");

    if (resource.likedByMe) {
      const { error } = await supabase
        .from("resource_likes")
        .delete()
        .eq("resource_id", id)
        .eq("user_id", session.user.id);

      if (error) {
        setErrorMessage("Could not remove like: " + error.message);
        return;
      }

      setResourceList((currentResources) =>
        currentResources.map((item) =>
          item.id === id
            ? {
                ...item,
                likes: item.likes - 1,
                likedByMe: false
              }
            : item
        )
      );
    } else {
      const { error } = await supabase
        .from("resource_likes")
        .insert({
          resource_id: id,
          user_id: session.user.id
        });

      if (error) {
        setErrorMessage("Could not save like: " + error.message);
        return;
      }

      setResourceList((currentResources) =>
        currentResources.map((item) =>
          item.id === id
            ? {
                ...item,
                likes: item.likes + 1,
                likedByMe: true
              }
            : item
        )
      );
    }
  }

  async function addResource(newResource) {
    setErrorMessage("");

    const file = newResource.file;
    const safeFileName = file.name.replace(/[^a-zA-Z0-9._-]/g, "_");
    const filePath =
      session.user.id + "/" + Date.now() + "-" + safeFileName;

    const { error: uploadError } = await supabase.storage
      .from("resources")
      .upload(filePath, file);

    if (uploadError) {
      setErrorMessage(uploadError.message);
      return false;
    }

    const { data, error } = await supabase
      .from("resources")
      .insert({
        title: newResource.title,
        subject: newResource.subject,
        file_name: file.name,
        file_path: filePath,
        file_type: newResource.type,
        owner_id: session.user.id
      })
      .select()
      .single();

    if (error) {
      setErrorMessage(error.message);

      await supabase.storage
        .from("resources")
        .remove([filePath]);

      return false;
    }

    setResourceList((currentResources) => [
      {
        id: data.id,
        title: data.title,
        subject: data.subject,
        type: data.file_type,
        uploader: session.user.email,
        date: new Date(data.created_at).toLocaleDateString("en-GB", {
          day: "2-digit",
          month: "short",
          year: "numeric"
        }),
        likes: 0,
        likedByMe: false,
        fileName: data.file_name,
        filePath: data.file_path
      },
      ...currentResources
    ]);

    return true;
  }

  async function handleSignOut() {
    const { error } = await supabase.auth.signOut();

    if (error) {
      alert("Could not sign out: " + error.message);
    }
  }

  if (!authChecked) {
    return <p>Loading ResourceHub...</p>;
  }

  if (!session) {
    return <AuthForm />;
  }

  return (
    <div className="app">
      <TopBar />

      <main className="workspace">
        <Sidebar
          subjects={subjects}
          subject={subject}
          setSubject={setSubject}
        />

        <section className="content">
          <div className="account-bar">
            <span>{session.user.email}</span>
            <button onClick={handleSignOut}>Sign out</button>
          </div>

          <p className="label">YOUR STUDY MATERIAL</p>
          <h1>Resource Library</h1>

          <p className="description">
            Find notes, presentations, and useful study resources.
          </p>

          {userRole === "facilitator" && (
            <UploadForm addResource={addResource} />
          )}

          {errorMessage && (
            <p className="error-message">{errorMessage}</p>
          )}

          <div className="filters">
            <input
              type="text"
              placeholder="Search resources..."
              value={search}
              onChange={(event) => setSearch(event.target.value)}
            />

            <select
              value={fileType}
              onChange={(event) => setFileType(event.target.value)}
            >
              <option value="All Files">All Files</option>
              <option value="PDF">PDF</option>
              <option value="PPT">PPT</option>
              <option value="PPTX">PPTX</option>
            </select>
          </div>

          {loadingResources ? (
            <p>Loading resources...</p>
          ) : (
            <>
              <p className="count">
                {filteredResources.length} resources
              </p>

              <div className="resource-list">
                {filteredResources.length > 0 ? (
                  filteredResources.map((item) => (
                    <ResourceRow
                      key={item.id}
                      item={item}
                      likeResource={likeResource}
                    />
                  ))
                ) : (
                  <div className="empty-state">
                    <h3>No resources found</h3>
                    <p>
                      Try another search or change your filters.
                    </p>

                    <button
                      onClick={() => {
                        setSearch("");
                        setSubject("All Subjects");
                        setFileType("All Files");
                      }}
                    >
                      Clear filters
                    </button>
                  </div>
                )}
              </div>
            </>
          )}
        </section>
      </main>
    </div>
  );
}

export default App;
