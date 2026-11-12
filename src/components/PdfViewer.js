import { useEffect, useRef, useState, useCallback } from "react";

function loadPdfJsScript() {
  if (typeof window !== "undefined" && window.pdfjsLib) {
    return Promise.resolve(window.pdfjsLib);
  }

  return new Promise((resolve, reject) => {
    // If already injected, wait for it
    const existing = document.getElementById("pdfjs-cdn-script");
    if (existing) {
      existing.addEventListener("load", () => resolve(window.pdfjsLib));
      existing.addEventListener("error", () => reject(new Error("Failed to load PDF.js script")));
      return;
    }

    const script = document.createElement("script");
    script.id = "pdfjs-cdn-script";
    script.src = "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js";
    script.async = true;

    script.onload = () => {
      if (window.pdfjsLib) {
        window.pdfjsLib.GlobalWorkerOptions.workerSrc =
          "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js";
        resolve(window.pdfjsLib);
      } else {
        reject(new Error("PDF.js library was not found on window"));
      }
    };

    script.onerror = () => {
      reject(new Error("Failed to load PDF viewer from CDN"));
    };

    document.head.appendChild(script);
  });
}

function PdfViewer({
  pdfBlob,
  signedUrl,
  title,
  fileName,
  onDownload,
  downloading = false
}) {
  const [numPages, setNumPages] = useState(0);
  const [currentPage, setCurrentPage] = useState(1);
  const [scale, setScale] = useState(1.2);
  const [loading, setLoading] = useState(true);
  const [renderError, setRenderError] = useState("");
  const [renderingPage, setRenderingPage] = useState(false);

  const canvasRef = useRef(null);
  const pdfDocRef = useRef(null);
  const renderTaskRef = useRef(null);

  // Initialize PDF.js and load document
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setRenderError("");

    async function initPdf() {
      try {
        const pdfjs = await loadPdfJsScript();
        if (cancelled) return;

        let dataBuffer;
        if (pdfBlob instanceof Blob) {
          dataBuffer = await pdfBlob.arrayBuffer();
        } else if (pdfBlob instanceof ArrayBuffer) {
          dataBuffer = pdfBlob;
        } else {
          throw new Error("Invalid PDF data source.");
        }

        const loadingTask = pdfjs.getDocument({
          data: new Uint8Array(dataBuffer),
          cMapUrl: "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/cmaps/",
          cMapPacked: true
        });

        const doc = await loadingTask.promise;
        if (cancelled) return;

        pdfDocRef.current = doc;
        setNumPages(doc.numPages);
        setCurrentPage(1);
        setLoading(false);
      } catch (err) {
        if (!cancelled) {
          setRenderError(err.message || "Could not render PDF.");
          setLoading(false);
        }
      }
    }

    initPdf();

    return () => {
      cancelled = true;
      if (renderTaskRef.current) {
        try {
          renderTaskRef.current.cancel();
        } catch (_e) {
          // Ignore cancellation errors
        }
      }
      pdfDocRef.current = null;
    };
  }, [pdfBlob]);

  // Render current page onto canvas
  const renderPage = useCallback(
    async (pageNumber) => {
      if (!pdfDocRef.current || !canvasRef.current) return;

      if (renderTaskRef.current) {
        try {
          renderTaskRef.current.cancel();
        } catch (_e) {
          // ignore
        }
      }

      setRenderingPage(true);

      try {
        const page = await pdfDocRef.current.getPage(pageNumber);
        const canvas = canvasRef.current;
        if (!canvas) return;

        const viewport = page.getViewport({ scale });
        const context = canvas.getContext("2d");

        canvas.height = viewport.height;
        canvas.width = viewport.width;

        const renderContext = {
          canvasContext: context,
          viewport: viewport
        };

        const renderTask = page.render(renderContext);
        renderTaskRef.current = renderTask;

        await renderTask.promise;
      } catch (err) {
        if (err?.name !== "RenderingCancelledException") {
          console.warn("PDF page render warning:", err);
        }
      } finally {
        setRenderingPage(false);
      }
    },
    [scale]
  );

  useEffect(() => {
    if (!loading && !renderError && pdfDocRef.current && currentPage) {
      renderPage(currentPage);
    }
  }, [loading, renderError, currentPage, renderPage]);

  function handlePrevPage() {
    if (currentPage > 1) {
      setCurrentPage((prev) => prev - 1);
    }
  }

  function handleNextPage() {
    if (currentPage < numPages) {
      setCurrentPage((prev) => prev + 1);
    }
  }

  function handleZoomIn() {
    setScale((prev) => Math.min(prev + 0.25, 2.5));
  }

  function handleZoomOut() {
    setScale((prev) => Math.max(prev - 0.25, 0.75));
  }

  function handleOpenExternal() {
    if (signedUrl) {
      window.open(signedUrl, "_blank", "noopener,noreferrer");
    } else if (pdfBlob instanceof Blob) {
      const url = URL.createObjectURL(pdfBlob);
      window.open(url, "_blank", "noopener,noreferrer");
      setTimeout(() => URL.revokeObjectURL(url), 60000);
    }
  }

  return (
    <div className="pdf-viewer-container" role="region" aria-label="PDF Document Viewer">
      {/* Top PDF Controls Bar */}
      <div className="pdf-viewer-toolbar">
        <div className="pdf-toolbar-group pdf-page-controls">
          <button
            type="button"
            className="pdf-tool-btn"
            onClick={handlePrevPage}
            disabled={currentPage <= 1 || loading || renderingPage}
            aria-label="Previous Page"
            title="Previous Page"
          >
            &larr; Prev
          </button>

          <span className="pdf-page-indicator">
            Page {numPages > 0 ? currentPage : 0} of {numPages}
          </span>

          <button
            type="button"
            className="pdf-tool-btn"
            onClick={handleNextPage}
            disabled={currentPage >= numPages || loading || renderingPage}
            aria-label="Next Page"
            title="Next Page"
          >
            Next &rarr;
          </button>
        </div>

        <div className="pdf-toolbar-group pdf-zoom-controls">
          <button
            type="button"
            className="pdf-tool-btn"
            onClick={handleZoomOut}
            disabled={scale <= 0.75 || loading}
            aria-label="Zoom Out"
            title="Zoom Out"
          >
            &minus;
          </button>
          <span className="pdf-zoom-label">{Math.round(scale * 100)}%</span>
          <button
            type="button"
            className="pdf-tool-btn"
            onClick={handleZoomIn}
            disabled={scale >= 2.5 || loading}
            aria-label="Zoom In"
            title="Zoom In"
          >
            +
          </button>
        </div>

        <div className="pdf-toolbar-group pdf-action-controls">
          {(signedUrl || pdfBlob) && (
            <button
              type="button"
              className="pdf-tool-btn pdf-tool-btn-primary"
              onClick={handleOpenExternal}
              aria-label="Open PDF in new tab"
              title="Open full PDF in a new browser tab"
            >
              <svg width="13" height="13" viewBox="0 0 16 16" fill="none" aria-hidden="true">
                <path
                  d="M11 2H14V5M13.5 2.5L7.5 8.5M14 9V13.5C14 13.7652 13.8946 14.0196 13.7071 14.2071C13.5196 14.3946 13.2652 14.5 13 14.5H2.5C2.23478 14.5 1.98043 14.3946 1.79289 14.2071C1.60536 14.0196 1.5 13.7652 1.5 13.5V3C1.5 2.73478 1.60536 2.48043 1.79289 2.29289C1.98043 2.10536 2.23478 2 2.5 2H7"
                  stroke="currentColor"
                  strokeWidth="1.3"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
              Open in Tab
            </button>
          )}

          {onDownload && (
            <button
              type="button"
              className="pdf-tool-btn"
              onClick={onDownload}
              disabled={downloading}
              aria-label="Download PDF"
            >
              {downloading ? "Saving..." : "Download"}
            </button>
          )}
        </div>
      </div>

      {/* Main Canvas Viewport */}
      <div className="pdf-viewport">
        {loading ? (
          <div className="pdf-loading-state">
            <span className="btn-spinner" aria-hidden="true" />
            <p className="status-text">Rendering document with PDF.js...</p>
          </div>
        ) : renderError ? (
          <div className="pdf-fallback-card">
            <div className="fallback-card-icon" aria-hidden="true">
              📄
            </div>
            <h3>Could not display inline PDF preview</h3>
            <p className="fallback-explanation">
              Mobile browsers and certain sandbox environments restrict canvas PDF rendering. You can open the full PDF directly in a new tab or download it.
            </p>
            <div className="pdf-fallback-actions">
              {(signedUrl || pdfBlob) && (
                <button
                  type="button"
                  className="download-button"
                  onClick={handleOpenExternal}
                >
                  Open in New Tab
                </button>
              )}
              {onDownload && (
                <button
                  type="button"
                  className="secondary-button"
                  onClick={onDownload}
                  disabled={downloading}
                >
                  {downloading ? "Saving..." : "Download Original PDF"}
                </button>
              )}
            </div>
          </div>
        ) : (
          <div className="pdf-canvas-wrapper">
            <canvas ref={canvasRef} className="pdf-canvas" />
          </div>
        )}
      </div>
    </div>
  );
}

export default PdfViewer;
