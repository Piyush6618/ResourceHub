import { useState, useEffect, useRef } from "react";
import "./App.css";

import TopBar from "./components/TopBar";
import Sidebar from "./components/Sidebar";
import SubjectChips from "./components/SubjectChips";
import ResourceRow from "./components/ResourceRow";
import UploadForm from "./components/UploadForm";
import AuthForm from "./components/AuthForm";
import ProfileModal from "./components/ProfileModal";
import ResourceDiscussionModal from "./components/ResourceDiscussionModal";
import AdminModerationModal from "./components/AdminModerationModal";

import { supabase } from "./supabaseClient";
import { normalizeSubjectName } from "./utils/fileValidation";

function App() {
  const [search, setSearch] = useState("");
  const [subject, setSubject] = useState("All Subjects");
  const [fileType, setFileType] = useState("All Files");
  const [sortBy, setSortBy] = useState("newest");
  const [sidebarOpen, setSidebarOpen] = useState(false);

  const [resourceList, setResourceList] = useState([]);
  const [session, setSession] = useState(null);
  const [userRole, setUserRole] = useState(null);
  const [userProfile, setUserProfile] = useState(null);

  const [authChecked, setAuthChecked] = useState(false);
  const [loadingResources, setLoadingResources] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");

  const [showProfileModal, setShowProfileModal] = useState(false);
  const [showModerationModal, setShowModerationModal] = useState(false);
  const [activeDiscussion, setActiveDiscussion] = useState(null);

  const searchInputRef = useRef(null);

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
      setUserProfile(null);
      setLoadingResources(false);
      return;
    }

    let mounted = true;

    async function loadResources() {
      setLoadingResources(true);
      setErrorMessage("");
      setUserRole(null);
      setUserProfile(null);

      let profileResult = await supabase
        .from("profiles")
        .select("role, status, display_name, designation")
        .eq("id", session.user.id)
        .single();

      if (
        profileResult.error &&
        String(profileResult.error.message || "").includes("status")
      ) {
        profileResult = await supabase
          .from("profiles")
          .select("role, display_name, designation")
          .eq("id", session.user.id)
          .single();
      }

      if (!mounted) return;

      if (profileResult.error) {
        setErrorMessage(
          "Could not load user profile: " + profileResult.error.message
        );
        setLoadingResources(false);
        return;
      }

      const profile = {
        ...profileResult.data,
        role: profileResult.data?.role === "admin" ? "admin" : "user",
        status: profileResult.data?.status || "active"
      };

      setUserRole(profile.role);
      setUserProfile(profile);

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

      const resourcesData = data || [];
      const ownerIds = [
        ...new Set(resourcesData.map((item) => item.owner_id).filter(Boolean))
      ];
      const resourceIds = resourcesData.map((item) => item.id).filter(Boolean);

      const profilesPromise =
        ownerIds.length > 0
          ? supabase
              .from("profiles")
              .select("id, display_name, designation, role")
              .in("id", ownerIds)
          : Promise.resolve({ data: [], error: null });

      const baseLikesQuery = supabase
        .from("resource_likes")
        .select("resource_id, user_id");

      const likesPromise =
        resourceIds.length > 0 && typeof baseLikesQuery?.in === "function"
          ? baseLikesQuery.in("resource_id", resourceIds)
          : baseLikesQuery;

      const [profilesResponse, likesResponse] = await Promise.all([
        profilesPromise,
        likesPromise
      ]);

      if (!mounted) return;

      if (profilesResponse?.error) {
        setErrorMessage(
          "Could not load uploader details: " + profilesResponse.error.message
        );
        setLoadingResources(false);
        return;
      }

      if (likesResponse?.error) {
        setErrorMessage(
          "Could not load likes: " + likesResponse.error.message
        );
        setLoadingResources(false);
        return;
      }

      const profilesData = profilesResponse?.data || [];
      const likesData = likesResponse?.data || [];

      const formattedResources = resourcesData.map((item) => {
        const resourceLikes = likesData.filter(
          (like) => like.resource_id === item.id
        );

        const likedByMe = resourceLikes.some(
          (like) => like.user_id === session.user.id
        );

        const uploaderProfile = profilesData.find(
          (p) => p.id === item.owner_id
        );

        const normalizedSubject =
          normalizeSubjectName(item.subject) || "General";

        return {
          id: item.id,
          ownerId: item.owner_id,
          title: item.title,
          description: item.description || "",
          subject: normalizedSubject,
          type: item.file_type,
          uploaderName:
            uploaderProfile?.display_name || "ResourceHub user",
          designation: uploaderProfile?.designation || "",
          date: new Date(item.created_at).toLocaleDateString("en-GB", {
            day: "2-digit",
            month: "short",
            year: "numeric"
          }),
          createdAt: item.created_at,
          likes:
            typeof item.likes_count === "number"
              ? item.likes_count
              : resourceLikes.length,
          commentsCount:
            typeof item.comments_count === "number"
              ? item.comments_count
              : 0,
          likedByMe,
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

  const subjectCounts = resourceList.reduce(
    (acc, item) => {
      acc["All Subjects"] = (acc["All Subjects"] || 0) + 1;
      acc[item.subject] = (acc[item.subject] || 0) + 1;
      return acc;
    },
    { "All Subjects": 0 }
  );

  const filteredResources = resourceList.filter((item) => {
    const query = search.toLowerCase();
    const matchesSearch =
      item.title.toLowerCase().includes(query) ||
      item.subject.toLowerCase().includes(query) ||
      (item.description && item.description.toLowerCase().includes(query)) ||
      (item.uploaderName || "").toLowerCase().includes(query);

    return (
      matchesSearch &&
      (subject === "All Subjects" || item.subject === subject) &&
      (fileType === "All Files" || item.type === fileType)
    );
  });

  const sortedResources = [...filteredResources].sort((a, b) => {
    if (sortBy === "mostLiked" || sortBy === "popular") {
      return b.likes - a.likes;
    }
    if (sortBy === "mostDiscussed") {
      return (b.commentsCount || 0) - (a.commentsCount || 0);
    }

    return new Date(b.createdAt) - new Date(a.createdAt);
  });

  const isSuspended = userProfile?.status === "suspended";
  const canUploadResource = Boolean(session?.user) && !isSuspended;

  async function likeResource(id) {
    if (isSuspended) {
      setErrorMessage("Your account is currently suspended.");
      return;
    }

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
                likes: Math.max(0, item.likes - 1),
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

    if (!canUploadResource) {
      setErrorMessage(
        "Your account cannot upload resources at this time."
      );
      return false;
    }

    const file = newResource.file;
    const cleanSubject = normalizeSubjectName(newResource.subject);
    const safeFileName = file.name.replace(/[^a-zA-Z0-9._-]/g, "_");
    const filePath =
      session.user.id + "/" + Date.now() + "-" + safeFileName;

    const uploadOptions = newResource.mimeType
      ? { contentType: newResource.mimeType, upsert: false }
      : { upsert: false };

    const { error: uploadError } = await supabase.storage
      .from("resources")
      .upload(filePath, file, uploadOptions);

    if (uploadError) {
      setErrorMessage(uploadError.message);
      return false;
    }

    let subjectId = null;
    if (typeof supabase.rpc === "function") {
      try {
        const { data: rpcSubjectId } = await supabase.rpc(
          "get_or_create_subject",
          { p_name: cleanSubject }
        );
        if (rpcSubjectId) {
          subjectId = rpcSubjectId;
        }
      } catch (_err) {
        // Fallback if migration 002 RPC is not yet active on the database
      }
    }

    const insertPayload = {
      title: newResource.title.trim(),
      subject: cleanSubject,
      file_name: file.name,
      file_path: filePath,
      file_type: newResource.type,
      owner_id: session.user.id
    };

    if (newResource.description) {
      insertPayload.description = newResource.description;
    }

    if (subjectId) {
      insertPayload.subject_id = subjectId;
    }

    const { data, error } = await supabase
      .from("resources")
      .insert(insertPayload)
      .select()
      .single();

    if (error) {
      setErrorMessage(error.message);
      await supabase.storage.from("resources").remove([filePath]);
      return false;
    }

    setResourceList((currentResources) => [
      {
        id: data.id,
        ownerId: data.owner_id || session.user.id,
        title: data.title,
        description: data.description || newResource.description || "",
        subject: normalizeSubjectName(data.subject) || cleanSubject,
        type: data.file_type,
        uploaderName: userProfile?.display_name || "ResourceHub user",
        designation: userProfile?.designation || "",
        date: new Date(data.created_at).toLocaleDateString("en-GB", {
          day: "2-digit",
          month: "short",
          year: "numeric"
        }),
        createdAt: data.created_at,
        likes: 0,
        commentsCount: 0,
        likedByMe: false,
        fileName: data.file_name,
        filePath: data.file_path
      },
      ...currentResources
    ]);

    return true;
  }

  async function updateResource(id, { title, subject: rawSubject, description }) {
    setErrorMessage("");
    const cleanSubject = normalizeSubjectName(rawSubject);

    let subjectId = null;
    if (typeof supabase.rpc === "function") {
      try {
        const { data: rpcSubjectId } = await supabase.rpc(
          "get_or_create_subject",
          { p_name: cleanSubject }
        );
        if (rpcSubjectId) {
          subjectId = rpcSubjectId;
        }
      } catch (_err) {
        // Ignore if RPC not yet installed
      }
    }

    const updatePayload = {
      title: title.trim(),
      subject: cleanSubject
    };

    if (typeof description === "string") {
      updatePayload.description = description;
    }
    if (subjectId) {
      updatePayload.subject_id = subjectId;
    }

    const updateQuery = supabase
      .from("resources")
      .update(updatePayload)
      .eq("id", id);

    const { error } =
      typeof updateQuery?.select === "function"
        ? await updateQuery.select().single()
        : await updateQuery;

    if (error) {
      return { error: error.message };
    }

    setResourceList((currentResources) =>
      currentResources.map((item) =>
        item.id === id
          ? {
              ...item,
              title: updatePayload.title,
              subject: cleanSubject,
              description:
                typeof description === "string"
                  ? description
                  : item.description
            }
          : item
      )
    );

    return { error: null };
  }

  async function deleteResource(item) {
    if (!item?.id) return;

    setErrorMessage("");

    // Step 1: Database-First deletion (transactional source of truth)
    const { error: dbError } = await supabase
      .from("resources")
      .delete()
      .eq("id", item.id);

    if (dbError) {
      setErrorMessage("Could not delete resource: " + dbError.message);
      return;
    }

    // Step 2: Best-effort immediate Storage deletion
    if (item.filePath) {
      const { error: storageError } = await supabase.storage
        .from("resources")
        .remove([item.filePath]);

      // Step 3: Acknowledge queue cleanup if Storage removal succeeded
      if (!storageError && typeof supabase.rpc === "function") {
        try {
          await supabase.rpc("confirm_storage_cleanup", {
            p_file_path: item.filePath
          });
        } catch (_err) {
          // Queue entry remains for admin/scheduled reconciliation if RPC is unavailable
        }
      }
    }

    setResourceList((currentResources) =>
      currentResources.filter((res) => res.id !== item.id)
    );
  }

  async function handleSaveProfile({ display_name, designation }) {
    if (!session?.user?.id) {
      return { error: "Not signed in." };
    }

    const { error } = await supabase
      .from("profiles")
      .update({
        display_name,
        designation
      })
      .eq("id", session.user.id);

    if (error) {
      return { error: error.message };
    }

    setUserProfile((prev) => ({
      ...prev,
      display_name,
      designation
    }));

    setResourceList((currentResources) =>
      currentResources.map((item) =>
        item.ownerId === session.user.id
          ? {
              ...item,
              uploaderName: display_name,
              designation
            }
          : item
      )
    );

    return { error: null };
  }

  function handleCommentCountDelta(resourceId, delta) {
    setResourceList((currentResources) =>
      currentResources.map((item) =>
        item.id === resourceId
          ? {
              ...item,
              commentsCount: Math.max(0, (item.commentsCount || 0) + delta)
            }
          : item
      )
    );
  }

  async function handleSignOut() {
    const { error } = await supabase.auth.signOut();

    if (error) {
      alert("Could not sign out: " + error.message);
    }
  }

  if (!authChecked) {
    return (
      <div className="app-boot">
        <p className="status-text">Loading ResourceHub...</p>
      </div>
    );
  }

  if (!session) {
    return <AuthForm />;
  }

  const hasActiveFilters =
    search.trim() !== "" ||
    subject !== "All Subjects" ||
    fileType !== "All Files" ||
    (sortBy !== "newest" && sortBy !== "latest");

  const subjectTotal = Math.max(0, subjects.length - 1);
  const totalComments = resourceList.reduce(
    (acc, item) => acc + (item.commentsCount || 0),
    0
  );

  const topSubjects = subjects
    .filter((s) => s !== "All Subjects")
    .map((name) => ({ name, count: subjectCounts[name] || 0 }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 5);

  return (
    <div className="app-shell">
      <TopBar
        session={session}
        userRole={userRole}
        userProfile={userProfile}
        onSignOut={handleSignOut}
        onToggleSidebar={() => setSidebarOpen((open) => !open)}
        onOpenProfile={() => setShowProfileModal(true)}
        onOpenModeration={() => setShowModerationModal(true)}
      />

      <main className="workspace community-layout">
        {/* Left: Subject Navigation Sidebar */}
        <Sidebar
          subjects={subjects}
          subject={subject}
          setSubject={setSubject}
          subjectCounts={subjectCounts}
          isOpen={sidebarOpen}
          onClose={() => setSidebarOpen(false)}
        />

        {/* Center: Community Feed Column */}
        <section className="content community-feed-column">
          <header className="page-header">
            <div className="page-header-copy">
              <span className="library-sublabel">COMMUNITY REPOSITORY</span>
              <h1>Resource Library</h1>
              <p className="description">
                Community-driven repository for university & high school study materials. Browse, discuss, and suggest improvements.
              </p>
            </div>

            <div className="page-header-summary">
              <div className="stat-pill">
                <span className="stat-pill-count">{resourceList.length}</span>
                <span className="stat-pill-label">resources</span>
              </div>
              <div className="stat-pill">
                <span className="stat-pill-count">{subjectTotal}</span>
                <span className="stat-pill-label">subjects</span>
              </div>
            </div>
          </header>

          {/* Horizontally scrollable subject chips for quick 1-tap filtering on mobile / tablet */}
          <SubjectChips
            subjects={subjects}
            activeSubject={subject}
            onSelectSubject={setSubject}
            subjectCounts={subjectCounts}
          />

          {isSuspended && (
            <div className="suspended-banner" role="alert">
              <strong>Account suspended:</strong> You can browse and download
              resources, but uploading, commenting, and editing are currently
              disabled.
            </div>
          )}

          {canUploadResource && (
            <UploadForm
              addResource={addResource}
              existingSubjects={subjects}
            />
          )}

          {errorMessage && (
            <p className="error-message" role="alert">
              {errorMessage}
            </p>
          )}

          {/* Community Feed Navigation: Latest / Popular / Most Discussed */}
          <div className="community-feed-header" role="region" aria-label="Community feed navigation">
            <div className="feed-nav-tabs" role="tablist">
              <button
                type="button"
                role="tab"
                aria-selected={sortBy === "newest" || sortBy === "latest"}
                className={
                  sortBy === "newest" || sortBy === "latest"
                    ? "feed-nav-tab active"
                    : "feed-nav-tab"
                }
                onClick={() => setSortBy("newest")}
              >
                <svg
                  className="feed-tab-icon"
                  width="14"
                  height="14"
                  viewBox="0 0 16 16"
                  fill="none"
                  aria-hidden="true"
                >
                  <circle
                    cx="8"
                    cy="8"
                    r="6.5"
                    stroke="currentColor"
                    strokeWidth="1.3"
                  />
                  <path
                    d="M8 4.5V8.5L10.5 10"
                    stroke="currentColor"
                    strokeWidth="1.3"
                    strokeLinecap="round"
                  />
                </svg>
                <span>Latest</span>
              </button>

              <button
                type="button"
                role="tab"
                aria-selected={sortBy === "mostLiked" || sortBy === "popular"}
                className={
                  sortBy === "mostLiked" || sortBy === "popular"
                    ? "feed-nav-tab active"
                    : "feed-nav-tab"
                }
                onClick={() => setSortBy("mostLiked")}
              >
                <svg
                  className="feed-tab-icon"
                  width="14"
                  height="14"
                  viewBox="0 0 16 16"
                  fill="none"
                  aria-hidden="true"
                >
                  <path
                    d="M8 14.5C8 14.5 1.5 10.5 1.5 6C1.5 3.8 3.3 2 5.5 2C6.8 2 7.9 2.6 8.5 3.5C9.1 2.6 10.2 2 11.5 2C13.7 2 15.5 3.8 15.5 6C15.5 10.5 9 14.5 9 14.5L8.5 14.8L8 14.5Z"
                    stroke="currentColor"
                    strokeWidth="1.3"
                    strokeLinejoin="round"
                  />
                </svg>
                <span>Popular</span>
              </button>

              <button
                type="button"
                role="tab"
                aria-selected={sortBy === "mostDiscussed"}
                className={
                  sortBy === "mostDiscussed"
                    ? "feed-nav-tab active"
                    : "feed-nav-tab"
                }
                onClick={() => setSortBy("mostDiscussed")}
              >
                <svg
                  className="feed-tab-icon"
                  width="14"
                  height="14"
                  viewBox="0 0 16 16"
                  fill="none"
                  aria-hidden="true"
                >
                  <path
                    d="M2 3.5C2 2.67 2.67 2 3.5 2H12.5C13.33 2 14 2.67 14 3.5V10.5C14 11.33 13.33 12 12.5 12H5.5L2 15V3.5Z"
                    stroke="currentColor"
                    strokeWidth="1.3"
                    strokeLinejoin="round"
                  />
                </svg>
                <span>Most discussed</span>
              </button>
            </div>
          </div>

          {/* Search & Secondary Filter Toolbar */}
          <div className="filters-toolbar">
            <div className="search-field">
              <svg
                className="search-icon"
                width="16"
                height="16"
                viewBox="0 0 16 16"
                fill="none"
                aria-hidden="true"
              >
                <circle
                  cx="7.2"
                  cy="7.2"
                  r="4.7"
                  stroke="currentColor"
                  strokeWidth="1.4"
                />
                <path
                  d="M10.7 10.7L13.5 13.5"
                  stroke="currentColor"
                  strokeWidth="1.4"
                  strokeLinecap="round"
                />
              </svg>
              <input
                ref={searchInputRef}
                type="text"
                placeholder="Search resources..."
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                aria-label="Search resources"
              />
              {search && (
                <button
                  type="button"
                  className="search-clear-button"
                  onClick={() => setSearch("")}
                  aria-label="Clear search input"
                >
                  &times;
                </button>
              )}
            </div>

            <div className="filters-selectors-row">
              <div className="select-wrapper">
                <select
                  value={fileType}
                  onChange={(event) => setFileType(event.target.value)}
                  aria-label="Filter by file type"
                >
                  <option value="All Files">All Files</option>
                  <option value="PDF">PDF</option>
                  <option value="PPT">PPT</option>
                  <option value="PPTX">PPTX</option>
                </select>
                <svg
                  className="select-chevron"
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
              </div>

              <div className="select-wrapper">
                <select
                  value={sortBy}
                  onChange={(event) => setSortBy(event.target.value)}
                  aria-label="Sort resources"
                >
                  <option value="newest">Newest first</option>
                  <option value="mostLiked">Most liked</option>
                  <option value="mostDiscussed">Most discussed</option>
                </select>
                <svg
                  className="select-chevron"
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
              </div>
            </div>
          </div>

          {loadingResources ? (
            <div className="resource-list">
              <div className="loading-state-box">
                <span className="btn-spinner" aria-hidden="true" />
                <p className="status-text">Loading community resources...</p>
              </div>
            </div>
          ) : (
            <>
              <div className="list-toolbar">
                <p className="count">
                  {sortedResources.length}{" "}
                  {sortedResources.length === 1 ? "resource" : "resources"} in feed
                </p>

                {hasActiveFilters && (
                  <button
                    type="button"
                    className="reset-inline-button"
                    onClick={() => {
                      setSearch("");
                      setSubject("All Subjects");
                      setFileType("All Files");
                      setSortBy("newest");
                    }}
                  >
                    Clear all filters
                  </button>
                )}
              </div>

              <div className="resource-list community-card-feed">
                {sortedResources.length > 0 ? (
                  sortedResources.map((item) => (
                    <ResourceRow
                      key={item.id}
                      item={item}
                      likeResource={likeResource}
                      onEditResource={updateResource}
                      onDeleteResource={deleteResource}
                      onOpenDiscussion={(resItem, tab = "comments") =>
                        setActiveDiscussion({ item: resItem, tab })
                      }
                      session={session}
                      userRole={userRole}
                      userStatus={userProfile?.status || "active"}
                    />
                  ))
                ) : resourceList.length === 0 ? (
                  <div className="empty-state">
                    <div className="empty-state-icon" aria-hidden="true">
                      📚
                    </div>
                    <h3>No resources uploaded yet</h3>
                    <p>
                      {canUploadResource
                        ? "Use the form above to share the first PDF, PPT, or PPTX study material with the community."
                        : "Community study materials will appear here once uploaded."}
                    </p>

                    {canUploadResource && (
                      <button
                        type="button"
                        onClick={() => {
                          const titleInput = document.getElementById(
                            "resource-title-input"
                          );
                          titleInput?.focus();
                          titleInput?.scrollIntoView({ behavior: "smooth" });
                        }}
                      >
                        Upload first resource
                      </button>
                    )}
                  </div>
                ) : subject !== "All Subjects" &&
                  search.trim() === "" &&
                  fileType === "All Files" ? (
                  <div className="empty-state">
                    <div className="empty-state-icon" aria-hidden="true">
                      📂
                    </div>
                    <h3>No resources in {subject}</h3>
                    <p>
                      There are currently no study materials filed under this
                      subject.
                    </p>

                    <button
                      type="button"
                      onClick={() => setSubject("All Subjects")}
                    >
                      View all subjects
                    </button>
                  </div>
                ) : (
                  <div className="empty-state">
                    <div className="empty-state-icon" aria-hidden="true">
                      🔍
                    </div>
                    <h3>No matching resources</h3>
                    <p>
                      {search.trim()
                        ? `No resources matched "${search.trim()}". Try adjusting your search query or filters.`
                        : "No resources matched your current filter selection."}
                    </p>

                    <button
                      type="button"
                      onClick={() => {
                        setSearch("");
                        setSubject("All Subjects");
                        setFileType("All Files");
                        setSortBy("newest");
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

        {/* Right: Community Discovery Sidebar (Desktop >= 1200px) */}
        <aside className="discovery-sidebar" aria-label="Community Discovery Sidebar">
          {/* Community Info Card */}
          <div className="discovery-card">
            <span className="discovery-tag">COMMUNITY</span>
            <h4>About ResourceHub</h4>
            <p className="discovery-text">
              An open, peer-driven repository for academic notes, lecture slides, and exam preparation. Free for everyone, maintained by the community.
            </p>

            <div className="discovery-stats-grid">
              <div className="discovery-stat-item">
                <span className="stat-val">{resourceList.length}</span>
                <span className="stat-lbl">Resources</span>
              </div>
              <div className="discovery-stat-item">
                <span className="stat-val">{subjectTotal}</span>
                <span className="stat-lbl">Subjects</span>
              </div>
              <div className="discovery-stat-item">
                <span className="stat-val">{totalComments}</span>
                <span className="stat-lbl">Comments</span>
              </div>
            </div>

            {canUploadResource && (
              <button
                type="button"
                className="discovery-cta-btn"
                onClick={() => {
                  const titleInput = document.getElementById(
                    "resource-title-input"
                  );
                  titleInput?.focus();
                  titleInput?.scrollIntoView({ behavior: "smooth" });
                }}
              >
                + Share a Resource
              </button>
            )}
          </div>

          {/* Top Subjects Card */}
          {topSubjects.length > 0 && (
            <div className="discovery-card">
              <span className="discovery-tag">POPULAR CATEGORIES</span>
              <h4>Top Subjects</h4>
              <ul className="discovery-subjects-list">
                {topSubjects.map((s) => (
                  <li key={s.name}>
                    <button
                      type="button"
                      className={
                        subject === s.name
                          ? "discovery-subject-btn active"
                          : "discovery-subject-btn"
                      }
                      onClick={() => setSubject(s.name)}
                    >
                      <span className="subject-link-name">{s.name}</span>
                      <span className="subject-link-count">{s.count}</span>
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* Community Guidelines Card */}
          <div className="discovery-card discovery-guidelines-card">
            <span className="discovery-tag">GUIDELINES</span>
            <h4>Community Rules</h4>
            <ul className="guidelines-list">
              <li>
                <span className="bullet-num">1</span>
                <span>Share original notes, lecture slides, or open textbooks.</span>
              </li>
              <li>
                <span className="bullet-num">2</span>
                <span>Use descriptive titles and correct subject categorization.</span>
              </li>
              <li>
                <span className="bullet-num">3</span>
                <span>Keep comments constructive; suggest specific improvements.</span>
              </li>
              <li>
                <span className="bullet-num">4</span>
                <span>Report corrupt files or spam immediately to moderators.</span>
              </li>
            </ul>
          </div>
        </aside>
      </main>

      {showProfileModal && (
        <ProfileModal
          session={session}
          userProfile={userProfile}
          userRole={userRole}
          onClose={() => setShowProfileModal(false)}
          onSaveProfile={handleSaveProfile}
        />
      )}

      {activeDiscussion && (
        <ResourceDiscussionModal
          item={activeDiscussion.item}
          initialTab={activeDiscussion.tab}
          session={session}
          userRole={userRole}
          userProfile={userProfile}
          onClose={() => setActiveDiscussion(null)}
          onCommentCountChange={handleCommentCountDelta}
        />
      )}

      {showModerationModal && userRole === "admin" && (
        <AdminModerationModal
          session={session}
          onClose={() => setShowModerationModal(false)}
          onDeleteResource={deleteResource}
        />
      )}
    </div>
  );
}

export default App;
