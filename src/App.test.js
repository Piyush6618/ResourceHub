import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import App from "./App";
import { supabase } from "./supabaseClient";

jest.mock("./supabaseClient", () => ({
  supabase: {
    auth: {
      getSession: jest.fn(),
      onAuthStateChange: jest.fn(),
      signOut: jest.fn(),
      resetPasswordForEmail: jest.fn()
    },
    from: jest.fn(),
    rpc: jest.fn(),
    storage: {
      from: jest.fn()
    }
  }
}));

function setupMockRole(
  role = "user",
  initialResources = [],
  status = "active"
) {
  const mockSession = {
    user: { id: "user-123", email: `${role}@example.com` },
    access_token: "test-token"
  };

  supabase.auth.getSession.mockResolvedValue({
    data: { session: mockSession },
    error: null
  });

  supabase.auth.onAuthStateChange.mockReturnValue({
    data: { subscription: { unsubscribe: jest.fn() } }
  });

  supabase.rpc.mockResolvedValue({
    data: "subject-uuid-1",
    error: null
  });

  const mockUpload = jest.fn().mockResolvedValue({ error: null });
  const mockRemove = jest.fn().mockResolvedValue({ error: null });
  const mockDownload = jest.fn().mockResolvedValue({
    data: new Blob(["%PDF-1.4 sample"], { type: "application/pdf" }),
    error: null
  });

  supabase.storage.from.mockReturnValue({
    upload: mockUpload,
    remove: mockRemove,
    download: mockDownload
  });

  const mockInsertSingle = jest.fn().mockResolvedValue({
    data: {
      id: "res-1",
      title: "Discrete Math Notes",
      subject: "Mathematics",
      file_name: "notes.pdf",
      file_path: "user-123/notes.pdf",
      file_type: "PDF",
      owner_id: "user-123",
      created_at: "2026-11-01T10:00:00.000Z"
    },
    error: null
  });

  const mockResourceDeleteEq = jest.fn().mockResolvedValue({ error: null });
  const mockResourceUpdateSingle = jest
    .fn()
    .mockResolvedValue({ data: {}, error: null });
  const mockLikeInsert = jest.fn().mockResolvedValue({ error: null });

  supabase.from.mockImplementation((table) => {
    if (table === "profiles") {
      return {
        select: () => ({
          eq: () => ({
            single: () =>
              Promise.resolve({
                data: {
                  role,
                  status,
                  display_name: `Test ${role}`,
                  designation: "Community Member"
                },
                error: null
              })
          }),
          in: () =>
            Promise.resolve({
              data: [
                {
                  id: "user-123",
                  display_name: `Test ${role}`,
                  designation: "Community Member",
                  role
                },
                {
                  id: "other-user-999",
                  display_name: "Other Contributor",
                  designation: "Student",
                  role: "user"
                }
              ],
              error: null
            })
        }),
        update: () => ({
          eq: () => Promise.resolve({ error: null })
        })
      };
    }

    if (table === "resources") {
      return {
        select: () => ({
          order: () =>
            Promise.resolve({
              data: initialResources,
              error: null
            })
        }),
        insert: () => ({
          select: () => ({
            single: mockInsertSingle
          })
        }),
        update: () => ({
          eq: () => ({
            select: () => ({
              single: mockResourceUpdateSingle
            })
          })
        }),
        delete: () => ({
          eq: mockResourceDeleteEq
        })
      };
    }

    if (table === "resource_likes") {
      return {
        select: () => ({
          in: () =>
            Promise.resolve({
              data: [],
              error: null
            }),
          then: (resolve) =>
            Promise.resolve({
              data: [],
              error: null
            }).then(resolve)
        }),
        insert: mockLikeInsert,
        delete: () => ({
          eq: () => ({
            eq: () => Promise.resolve({ error: null })
          })
        })
      };
    }

    return {};
  });

  return {
    mockUpload,
    mockRemove,
    mockInsertSingle,
    mockLikeInsert,
    mockResourceDeleteEq,
    mockResourceUpdateSingle
  };
}

describe("ResourceHub Universal Community Platform UI & Access Control", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test("standard user role can see UploadForm, does not see GoogleDriveConnect, and can upload a valid PDF", async () => {
    const { mockUpload, mockInsertSingle } = setupMockRole("user");
    render(<App />);

    await waitFor(() => {
      expect(
        screen.getByRole("heading", { name: /add a resource/i })
      ).toBeInTheDocument();
    });

    expect(
      screen.queryByRole("button", { name: /connect google drive/i })
    ).not.toBeInTheDocument();

    fireEvent.change(screen.getByPlaceholderText("Resource title"), {
      target: { value: "Discrete Math Notes" }
    });
    fireEvent.change(screen.getByPlaceholderText("Subject name"), {
      target: { value: "  Mathematics  " }
    });

    const fileInput = document.querySelector('input[type="file"]');
    const validPdfBytes = new Uint8Array([
      0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x34
    ]);
    const file = new File([validPdfBytes], "notes.pdf", {
      type: "application/pdf"
    });
    fireEvent.change(fileInput, { target: { files: [file] } });

    expect(screen.getByText("notes.pdf")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /add resource/i }));

    await waitFor(() => {
      expect(mockUpload).toHaveBeenCalledTimes(1);
      expect(mockInsertSingle).toHaveBeenCalledTimes(1);
      expect(screen.getByText("Discrete Math Notes")).toBeInTheDocument();
      expect(
        screen.getByText("Resource uploaded successfully.")
      ).toBeInTheDocument();
    });
  });

  test("magic-byte validation blocks spoofed executable disguised as a PDF", async () => {
    const { mockUpload } = setupMockRole("user");
    render(<App />);

    await waitFor(() => {
      expect(
        screen.getByRole("heading", { name: /add a resource/i })
      ).toBeInTheDocument();
    });

    fireEvent.change(screen.getByPlaceholderText("Resource title"), {
      target: { value: "Spoofed File" }
    });
    fireEvent.change(screen.getByPlaceholderText("Subject name"), {
      target: { value: "Security" }
    });

    const fileInput = document.querySelector('input[type="file"]');
    // Windows PE executable header ("MZ") disguised as .pdf
    const exeHeader = new Uint8Array([0x4d, 0x5a, 0x90, 0x00, 0x03, 0x00]);
    const spoofedFile = new File([exeHeader], "malware.pdf", {
      type: "application/pdf"
    });
    fireEvent.change(fileInput, { target: { files: [spoofedFile] } });

    fireEvent.click(screen.getByRole("button", { name: /add resource/i }));

    await waitFor(() => {
      expect(
        screen.getByText(/executable or html\/script content is not permitted/i)
      ).toBeInTheDocument();
    });
    expect(mockUpload).not.toHaveBeenCalled();
  });

  test("suspended user cannot see UploadForm and sees account suspension banner", async () => {
    setupMockRole("user", [], "suspended");
    render(<App />);

    await waitFor(() => {
      expect(screen.getByText(/account suspended:/i)).toBeInTheDocument();
    });

    expect(
      screen.queryByRole("heading", { name: /add a resource/i })
    ).not.toBeInTheDocument();
  });

  test("resource owner can delete their own resource using Database-First deletion, while non-owners cannot see Edit/Delete", async () => {
    const sampleResources = [
      {
        id: "own-res",
        title: "My Algorithms Cheat Sheet",
        subject: "Computer Science",
        file_name: "algo.pdf",
        file_path: "user-123/algo.pdf",
        file_type: "PDF",
        owner_id: "user-123",
        created_at: "2026-11-02T10:00:00.000Z"
      },
      {
        id: "other-res",
        title: "Someone Else Slides",
        subject: "Physics",
        file_name: "physics.ppt",
        file_path: "other-user-999/physics.ppt",
        file_type: "PPT",
        owner_id: "other-user-999",
        created_at: "2026-11-01T10:00:00.000Z"
      }
    ];

    const { mockResourceDeleteEq, mockRemove } = setupMockRole(
      "user",
      sampleResources
    );
    render(<App />);

    await waitFor(() => {
      expect(screen.getByText("My Algorithms Cheat Sheet")).toBeInTheDocument();
      expect(screen.getByText("Someone Else Slides")).toBeInTheDocument();
    });

    // Owner sees Edit and Delete for own resource, not for other-user-999's resource
    expect(
      screen.getByRole("button", { name: /delete my algorithms cheat sheet/i })
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /delete someone else slides/i })
    ).not.toBeInTheDocument();

    fireEvent.click(
      screen.getByRole("button", { name: /delete my algorithms cheat sheet/i })
    );

    fireEvent.click(
      screen.getByRole("button", { name: /confirm delete/i })
    );

    await waitFor(() => {
      expect(mockResourceDeleteEq).toHaveBeenCalledWith("id", "own-res");
      expect(mockRemove).toHaveBeenCalledWith(["user-123/algo.pdf"]);
      expect(
        screen.queryByText("My Algorithms Cheat Sheet")
      ).not.toBeInTheDocument();
    });
  });

  test("admin role sees Moderation console button and can manage any resource", async () => {
    const sampleResources = [
      {
        id: "other-res",
        title: "Community Uploaded Deck",
        subject: "Biology",
        file_name: "bio.pptx",
        file_path: "other-user-999/bio.pptx",
        file_type: "PPTX",
        owner_id: "other-user-999",
        created_at: "2026-11-01T10:00:00.000Z"
      }
    ];

    setupMockRole("admin", sampleResources);
    render(<App />);

    await waitFor(() => {
      expect(screen.getByText("Community Uploaded Deck")).toBeInTheDocument();
    });

    expect(
      screen.getByRole("button", { name: /^moderation$/i })
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /delete community uploaded deck/i })
    ).toBeInTheDocument();
  });

  test("search, subject filter, file-type filter, likes, and legacy PPT fallback preview work properly", async () => {
    const sampleResources = [
      {
        id: "r1",
        title: "Operating Systems Slides",
        subject: "Computer Science",
        file_name: "os.ppt",
        file_path: "user-123/os.ppt",
        file_type: "PPT",
        owner_id: "user-123",
        created_at: "2026-11-02T10:00:00.000Z"
      },
      {
        id: "r2",
        title: "Linear Algebra Handbook",
        subject: "Mathematics",
        file_name: "la.pdf",
        file_path: "user-123/la.pdf",
        file_type: "PDF",
        owner_id: "user-123",
        created_at: "2026-11-01T10:00:00.000Z"
      }
    ];

    const { mockLikeInsert } = setupMockRole("user", sampleResources);
    render(<App />);

    await waitFor(() => {
      expect(screen.getByText("Operating Systems Slides")).toBeInTheDocument();
      expect(screen.getByText("Linear Algebra Handbook")).toBeInTheDocument();
    });

    // Search filter
    fireEvent.change(screen.getByPlaceholderText("Search resources..."), {
      target: { value: "Linear" }
    });
    expect(
      screen.queryByText("Operating Systems Slides")
    ).not.toBeInTheDocument();
    expect(screen.getByText("Linear Algebra Handbook")).toBeInTheDocument();

    // Clear search
    fireEvent.change(screen.getByPlaceholderText("Search resources..."), {
      target: { value: "" }
    });

    // File type filter
    fireEvent.change(screen.getByLabelText("Filter by file type"), {
      target: { value: "PPT" }
    });
    expect(screen.getByText("Operating Systems Slides")).toBeInTheDocument();
    expect(
      screen.queryByText("Linear Algebra Handbook")
    ).not.toBeInTheDocument();

    // Like action
    const likeButtons = screen.getAllByRole("button", {
      name: /like resource/i
    });
    fireEvent.click(likeButtons[0]);

    await waitFor(() => {
      expect(mockLikeInsert).toHaveBeenCalledTimes(1);
    });

    // Legacy PPT preview shows fallback download card
    const previewButtons = screen.getAllByRole("button", { name: /^preview$/i });
    fireEvent.click(previewButtons[0]);
    await waitFor(() => {
      expect(
        screen.getByText(/legacy \.ppt presentations use a binary format/i)
      ).toBeInTheDocument();
    });
  });

  test("responsive mobile account dropdown menu toggles and shows navigation options", async () => {
    setupMockRole("admin");
    render(<App />);

    await waitFor(() => {
      expect(screen.getByRole("heading", { name: /resource library/i })).toBeInTheDocument();
    });

    const mobileMenuTrigger = screen.getByRole("button", {
      name: /user account menu/i
    });
    expect(mobileMenuTrigger).toBeInTheDocument();

    // Open dropdown
    fireEvent.click(mobileMenuTrigger);
    expect(screen.getByRole("menu", { name: /user menu/i })).toBeInTheDocument();
    expect(screen.getByRole("menuitem", { name: /moderation console/i })).toBeInTheDocument();
    expect(screen.getByRole("menuitem", { name: /edit profile/i })).toBeInTheDocument();
    expect(screen.getByRole("menuitem", { name: /sign out/i })).toBeInTheDocument();

    // Close on trigger click or Escape
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("menu", { name: /user menu/i })).not.toBeInTheDocument();
  });

  test("subject chips filter resources when tapped", async () => {
    const sampleResources = [
      {
        id: "r1",
        title: "Calculus III Lecture",
        subject: "Mathematics",
        file_name: "calc.pdf",
        file_path: "user-123/calc.pdf",
        file_type: "PDF",
        owner_id: "user-123",
        created_at: "2026-11-02T10:00:00.000Z"
      },
      {
        id: "r2",
        title: "Quantum Physics Notes",
        subject: "Physics",
        file_name: "physics.pdf",
        file_path: "user-123/physics.pdf",
        file_type: "PDF",
        owner_id: "user-123",
        created_at: "2026-11-01T10:00:00.000Z"
      }
    ];

    setupMockRole("user", sampleResources);
    render(<App />);

    await waitFor(() => {
      expect(screen.getByText("Calculus III Lecture")).toBeInTheDocument();
      expect(screen.getByText("Quantum Physics Notes")).toBeInTheDocument();
    });

    // Subject chip click for "Mathematics"
    const mathChips = screen.getAllByRole("button", { name: /mathematics/i });
    fireEvent.click(mathChips[0]);

    expect(screen.getByText("Calculus III Lecture")).toBeInTheDocument();
    expect(screen.queryByText("Quantum Physics Notes")).not.toBeInTheDocument();

    // Subject chip click for "All Subjects"
    const allChips = screen.getAllByRole("button", { name: /all subjects/i });
    fireEvent.click(allChips[0]);

    expect(screen.getByText("Calculus III Lecture")).toBeInTheDocument();
    expect(screen.getByText("Quantum Physics Notes")).toBeInTheDocument();
  });

  test("mobile card more actions menu displays discussion and management actions", async () => {
    const sampleResources = [
      {
        id: "own-res",
        title: "Operating Systems Deep Dive",
        subject: "Computer Science",
        file_name: "os.pdf",
        file_path: "user-123/os.pdf",
        file_type: "PDF",
        owner_id: "user-123",
        created_at: "2026-11-02T10:00:00.000Z"
      }
    ];

    setupMockRole("user", sampleResources);
    render(<App />);

    await waitFor(() => {
      expect(screen.getByText("Operating Systems Deep Dive")).toBeInTheDocument();
    });

    const moreActionsButton = screen.getByRole("button", {
      name: /more actions for operating systems deep dive/i
    });
    expect(moreActionsButton).toBeInTheDocument();

    // Open more actions menu
    fireEvent.click(moreActionsButton);

    expect(screen.getByRole("menuitem", { name: /discuss/i })).toBeInTheDocument();
    expect(screen.getByRole("menuitem", { name: /suggest improvement/i })).toBeInTheDocument();
    expect(screen.getByRole("menuitem", { name: /report issue/i })).toBeInTheDocument();
    expect(screen.getByRole("menuitem", { name: /edit resource/i })).toBeInTheDocument();
    expect(screen.getByRole("menuitem", { name: /delete resource/i })).toBeInTheDocument();

    // Close on Escape
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("menuitem", { name: /discuss/i })).not.toBeInTheDocument();
  });

  test("upload form can be collapsed and expanded", async () => {
    setupMockRole("user");
    render(<App />);

    await waitFor(() => {
      expect(screen.getByRole("heading", { name: /add a resource/i })).toBeInTheDocument();
    });

    const collapseButton = screen.getByRole("button", { name: /collapse/i });
    fireEvent.click(collapseButton);

    expect(screen.queryByPlaceholderText("Resource title")).not.toBeInTheDocument();

    const expandButton = screen.getByRole("button", { name: /expand/i });
    fireEvent.click(expandButton);

    expect(screen.getByPlaceholderText("Resource title")).toBeInTheDocument();
  });

  test("community feed tabs sort resources by latest, popular, and most discussed", async () => {
    const sampleResources = [
      {
        id: "r1",
        title: "Alpha Oldest Resource",
        subject: "Math",
        file_name: "alpha.pdf",
        file_path: "user-123/alpha.pdf",
        file_type: "PDF",
        owner_id: "user-123",
        created_at: "2026-11-01T10:00:00.000Z",
        likes_count: 5,
        comments_count: 2
      },
      {
        id: "r2",
        title: "Beta High Likes Resource",
        subject: "Math",
        file_name: "beta.pdf",
        file_path: "user-123/beta.pdf",
        file_type: "PDF",
        owner_id: "user-123",
        created_at: "2026-11-02T10:00:00.000Z",
        likes_count: 50,
        comments_count: 1
      },
      {
        id: "r3",
        title: "Gamma High Comments Resource",
        subject: "Math",
        file_name: "gamma.pdf",
        file_path: "user-123/gamma.pdf",
        file_type: "PDF",
        owner_id: "user-123",
        created_at: "2026-11-03T10:00:00.000Z",
        likes_count: 10,
        comments_count: 42
      }
    ];

    setupMockRole("user", sampleResources);
    render(<App />);

    await waitFor(() => {
      expect(screen.getByText("Alpha Oldest Resource")).toBeInTheDocument();
      expect(screen.getByText("Beta High Likes Resource")).toBeInTheDocument();
      expect(screen.getByText("Gamma High Comments Resource")).toBeInTheDocument();
    });

    // Check Discovery Sidebar elements
    expect(screen.getByText(/about resourcehub/i)).toBeInTheDocument();
    expect(screen.getByText(/community rules/i)).toBeInTheDocument();

    // Click Popular tab
    const popularTab = screen.getByRole("tab", { name: /popular/i });
    fireEvent.click(popularTab);
    expect(popularTab).toHaveAttribute("aria-selected", "true");

    // Click Most discussed tab
    const discussedTab = screen.getByRole("tab", { name: /most discussed/i });
    fireEvent.click(discussedTab);
    expect(discussedTab).toHaveAttribute("aria-selected", "true");

    // Click Latest tab
    const latestTab = screen.getByRole("tab", { name: /latest/i });
    fireEvent.click(latestTab);
    expect(latestTab).toHaveAttribute("aria-selected", "true");
  });
});
