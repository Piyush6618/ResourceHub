import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import App from "./App";
import { supabase } from "./supabaseClient";

jest.mock("./supabaseClient", () => ({
  supabase: {
    auth: {
      getSession: jest.fn(),
      onAuthStateChange: jest.fn(),
      signOut: jest.fn()
    },
    from: jest.fn(),
    storage: {
      from: jest.fn()
    }
  }
}));

function setupMockRole(role, initialResources = []) {
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

  const mockUpload = jest.fn().mockResolvedValue({ error: null });
  const mockRemove = jest.fn().mockResolvedValue({ error: null });
  const mockDownload = jest
    .fn()
    .mockResolvedValue({ data: new Blob(["pdf"], { type: "application/pdf" }), error: null });

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
                  display_name: `Test ${role}`,
                  designation: "Faculty"
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
                  designation: "Faculty",
                  role
                }
              ],
              error: null
            })
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
        })
      };
    }

    if (table === "resource_likes") {
      return {
        select: () =>
          Promise.resolve({
            data: [],
            error: null
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

  return { mockUpload, mockInsertSingle, mockLikeInsert };
}

describe("ResourceHub UI & Role-Based Access Control", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test("student role cannot see UploadForm or GoogleDriveConnect", async () => {
    setupMockRole("student");
    render(<App />);

    await waitFor(() => {
      expect(screen.getByText("Resource Library")).toBeInTheDocument();
    });

    expect(
      screen.queryByRole("heading", { name: /add a resource/i })
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /connect google drive/i })
    ).not.toBeInTheDocument();
  });

  test("teacher role can see UploadForm, preview selected file info, and upload a resource", async () => {
    const { mockUpload, mockInsertSingle } = setupMockRole("teacher");
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
      target: { value: "Mathematics" }
    });

    const fileInput = document.querySelector('input[type="file"]');
    const file = new File(["pdf content"], "notes.pdf", {
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

  test("facilitator role can see both GoogleDriveConnect and UploadForm", async () => {
    setupMockRole("facilitator");
    render(<App />);

    await waitFor(() => {
      expect(
        screen.getByRole("heading", { name: /add a resource/i })
      ).toBeInTheDocument();
    });

    expect(
      screen.getByRole("button", { name: /connect google drive/i })
    ).toBeInTheDocument();
  });

  test("search, subject filter, file-type filter, and likes work properly", async () => {
    const sampleResources = [
      {
        id: "r1",
        title: "Operating Systems Slides",
        subject: "Computer Science",
        file_name: "os.pptx",
        file_path: "user-123/os.pptx",
        file_type: "PPTX",
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

    const { mockLikeInsert } = setupMockRole("student", sampleResources);
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
      target: { value: "PPTX" }
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
  });
});
