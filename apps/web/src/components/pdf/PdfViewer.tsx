import type { PDFDocumentProxy, PDFPageProxy, RenderTask } from 'pdfjs-dist';
import { GlobalWorkerOptions, getDocument } from 'pdfjs-dist';
import type { ReactNode, Ref } from 'react';
import { useCallback, useEffect, useImperativeHandle, useRef, useState } from 'react';

// Setup the worker for pdfjs-dist v6
GlobalWorkerOptions.workerSrc = '/pdfjs/pdf.worker.min.mjs';

const CMAP_URL = '/pdfjs/cmaps/';
const STANDARD_FONT_URL = '/pdfjs/standard_fonts/';
const ZOOM_PRESETS = [0.5, 0.75, 1, 1.25, 1.5, 2] as const;

export type ScaleMode = number | 'fit-width';

/** Side padding the scroll area takes out of the available width in fit-width mode. */
const FIT_WIDTH_PADDING = 48;

/**
 * What an overlay needs to place things on a page.
 *
 * `widthPt`/`heightPt` are the page's own size in PDF points, with /Rotate and
 * the CropBox already applied, exactly what the coordinates module expects.
 * `pxPerPt` converts between what is on screen and that fixed space.
 */
export interface PageRenderInfo {
  pageNumber: number;
  widthPt: number;
  heightPt: number;
  cssWidth: number;
  cssHeight: number;
  pxPerPt: number;
}

export interface PdfViewerHandle {
  jumpToPage: (page: number) => void;
}

interface PdfViewerProps {
  data: ArrayBuffer;
  className?: string;
  /**
   * Draws something on top of a page, sized to exactly the rendered page.
   * Used by the field builder; without it the viewer behaves as before.
   */
  renderPageOverlay?: (page: PageRenderInfo) => ReactNode;
  onPageChange?: (page: number) => void;
  ref?: Ref<PdfViewerHandle>;
}

interface PageDimensions {
  width: number;
  height: number;
}

/**
 * The page's size on screen, in CSS pixels.
 *
 * The canvas, the page wrapper and any overlay all take their size from here, so
 * they cannot drift apart: a box drawn at inset 0 covers exactly the page.
 */
function displaySize(
  page: PageDimensions,
  scale: ScaleMode,
  containerWidth: number,
): { width: number; height: number; scale: number } {
  if (page.width <= 0) return { width: page.width, height: page.height, scale: 1 };

  if (scale === 'fit-width') {
    if (containerWidth <= 32) return { width: page.width, height: page.height, scale: 1 };
    const fitScale = (containerWidth - FIT_WIDTH_PADDING) / page.width;
    return { width: page.width * fitScale, height: page.height * fitScale, scale: fitScale };
  }
  return { width: page.width * scale, height: page.height * scale, scale };
}

// A single page component that renders a canvas when visible and preserves it once rendered
const PdfPage = ({
  pdfDoc,
  pageNumber,
  scale,
  containerWidth,
  defaultDimensions,
  renderPageOverlay,
}: {
  pdfDoc: PDFDocumentProxy;
  pageNumber: number;
  scale: ScaleMode;
  containerWidth: number;
  defaultDimensions: PageDimensions;
  renderPageOverlay?: (page: PageRenderInfo) => ReactNode;
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [isVisible, setIsVisible] = useState(false);
  const [hasEverRendered, setHasEverRendered] = useState(false);
  const [pageProxy, setPageProxy] = useState<PDFPageProxy | null>(null);
  const [pageDimensions, setPageDimensions] = useState<PageDimensions>(defaultDimensions);
  const renderTaskRef = useRef<RenderTask | null>(null);

  // Intersection observer for visibility: loads ±400px around viewport
  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        const entry = entries[0];
        if (!entry) return;
        setIsVisible(entry.isIntersecting);
      },
      { rootMargin: '400px 0px 400px 0px' },
    );

    if (containerRef.current) {
      observer.observe(containerRef.current);
    }
    return () => observer.disconnect();
  }, []);

  // Load the page proxy and get its true unscaled dimensions
  useEffect(() => {
    let active = true;
    pdfDoc
      .getPage(pageNumber)
      .then((page) => {
        if (active) {
          setPageProxy(page);
          const unscaledViewport = page.getViewport({ scale: 1 });
          setPageDimensions({
            width: unscaledViewport.width,
            height: unscaledViewport.height,
          });
        }
      })
      .catch((err) => {
        console.error(`Failed to load page ${pageNumber}:`, err);
      });
    return () => {
      active = false;
    };
  }, [pdfDoc, pageNumber]);

  const display = displaySize(pageDimensions, scale, containerWidth);
  const displayWidth = display.width;
  const displayHeight = display.height;

  // Render to canvas
  useEffect(() => {
    if (!isVisible || !pageProxy || !canvasRef.current) return;

    if (renderTaskRef.current) {
      renderTaskRef.current.cancel();
      renderTaskRef.current = null;
    }

    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const renderScale = displaySize(pageDimensions, scale, containerWidth).scale;
    const viewport = pageProxy.getViewport({ scale: renderScale });

    // High DPI scaling (capped at 2 for mobile GPU safety)
    const pixelRatio = Math.min(window.devicePixelRatio || 1, 2);
    const maxWidth = 4096;
    let actualWidth = Math.floor(viewport.width * pixelRatio);
    let actualHeight = Math.floor(viewport.height * pixelRatio);

    if (actualWidth > maxWidth || actualHeight > maxWidth) {
      const maxDim = Math.max(actualWidth, actualHeight);
      const reduction = maxWidth / maxDim;
      actualWidth = Math.floor(actualWidth * reduction);
      actualHeight = Math.floor(actualHeight * reduction);
    }

    // Only the backing store is set here. The CSS size comes from the same
    // `displaySize` call the wrapper uses, below, so the canvas, the wrapper and
    // any overlay always describe the same rectangle — including for pages that
    // have not re-rendered since the last zoom change.
    canvas.width = actualWidth;
    canvas.height = actualHeight;

    const renderContext = {
      canvasContext: ctx,
      canvas,
      viewport,
      transform: [
        actualWidth / viewport.width,
        0,
        0,
        actualHeight / viewport.height,
        0,
        0,
      ] as number[],
    };

    const renderTask = pageProxy.render(renderContext);
    renderTaskRef.current = renderTask;

    renderTask.promise
      .then(() => {
        setHasEverRendered(true);
      })
      .catch((err) => {
        if (err.name !== 'RenderingCancelledException') {
          console.error(`Error rendering page ${pageNumber}:`, err);
        }
      });

    return () => {
      if (renderTaskRef.current) {
        renderTaskRef.current.cancel();
        renderTaskRef.current = null;
      }
    };
  }, [isVisible, pageProxy, scale, containerWidth, pageDimensions, pageNumber]);

  return (
    // `ring` rather than `border`: a border sits inside the wrapper's width, so
    // the canvas and an inset-0 overlay would each be a pixel or two adrift of
    // the page. A ring is drawn outside the box and costs nothing.
    <div
      ref={containerRef}
      id={`pdf-page-${pageNumber}`}
      data-page-number={pageNumber}
      className="relative bg-white shadow-lg mx-auto mb-6 last:mb-2 flex items-center justify-center shrink-0 rounded-sm ring-1 ring-slate-200/60 transition-shadow hover:shadow-xl"
      style={{
        width: `${Math.round(displayWidth)}px`,
        height: `${Math.round(displayHeight)}px`,
        minHeight: '120px',
      }}
    >
      <canvas
        ref={canvasRef}
        className={`block ${hasEverRendered ? 'opacity-100' : 'opacity-0'} transition-opacity duration-150`}
        style={{ width: `${Math.round(displayWidth)}px`, height: `${Math.round(displayHeight)}px` }}
      />
      {!hasEverRendered && (
        <div className="absolute inset-0 flex flex-col items-center justify-center bg-slate-50 text-xs text-slate-400 gap-2">
          <div className="w-5 h-5 border-2 border-brand-600 border-t-transparent rounded-full animate-spin" />
          <span className="font-medium text-slate-500">Page {pageNumber}</span>
        </div>
      )}
      {renderPageOverlay && pageDimensions.width > 0 && (
        <div className="absolute inset-0" data-pdf-overlay={pageNumber}>
          {renderPageOverlay({
            pageNumber,
            widthPt: pageDimensions.width,
            heightPt: pageDimensions.height,
            cssWidth: displayWidth,
            cssHeight: displayHeight,
            pxPerPt: display.scale,
          })}
        </div>
      )}
    </div>
  );
};

export function PdfViewer({
  data,
  className = '',
  renderPageOverlay,
  onPageChange,
  ref,
}: PdfViewerProps) {
  const [pdfDoc, setPdfDoc] = useState<PDFDocumentProxy | null>(null);
  const [numPages, setNumPages] = useState<number>(0);
  const [currentPage, setCurrentPage] = useState<number>(1);
  const [inputPage, setInputPage] = useState<string>('1');
  const [scale, setScale] = useState<ScaleMode>('fit-width');
  const [zoomToast, setZoomToast] = useState<string | null>(null);
  const zoomToastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [containerWidth, setContainerWidth] = useState<number>(() => {
    if (typeof window !== 'undefined') {
      return Math.min(window.innerWidth - 64, 860);
    }
    return 860;
  });
  const [defaultDimensions, setDefaultDimensions] = useState<PageDimensions>({
    width: 595.28,
    height: 841.89, // Standard A4 points
  });
  const [error, setError] = useState<string | null>(null);

  const containerRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  // Sync inputPage whenever currentPage changes
  useEffect(() => {
    setInputPage(String(currentPage));
  }, [currentPage]);

  // Load document
  useEffect(() => {
    let active = true;
    const loadingTask = getDocument({
      data: new Uint8Array(data.slice(0)),
      cMapUrl: CMAP_URL,
      cMapPacked: true,
      standardFontDataUrl: STANDARD_FONT_URL,
    });

    loadingTask.promise
      .then(async (doc) => {
        if (!active) return;
        setPdfDoc(doc);
        setNumPages(doc.numPages);
        setCurrentPage(1);
        setError(null);

        try {
          const firstPage = await doc.getPage(1);
          if (active) {
            const viewport = firstPage.getViewport({ scale: 1 });
            setDefaultDimensions({
              width: viewport.width,
              height: viewport.height,
            });
          }
        } catch {
          // Fallback to standard A4
        }
      })
      .catch((err) => {
        if (active) {
          console.error('Error loading PDF:', err);
          setError('Failed to load PDF document.');
        }
      });

    return () => {
      active = false;
      void loadingTask.destroy();
    };
  }, [data]);

  // Monitor container width for responsive fit-width scaling
  useEffect(() => {
    if (!containerRef.current) return;
    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (entry && entry.contentRect.width > 0) {
        setContainerWidth(entry.contentRect.width);
      }
    });
    observer.observe(containerRef.current);
    return () => observer.disconnect();
  }, []);

  // Natural focal-point mouse wheel & trackpad pinch zoom
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;

    const onWheel = (e: WheelEvent) => {
      if (e.ctrlKey || e.metaKey) {
        e.preventDefault();

        // Smooth exponential zoom curve based on delta
        const factor = Math.exp(-e.deltaY * 0.003);

        const rect = el.getBoundingClientRect();
        const cursorX = e.clientX - rect.left;
        const cursorY = e.clientY - rect.top;

        const currentScrollLeft = el.scrollLeft;
        const currentScrollTop = el.scrollTop;

        setScale((prev) => {
          let currentNumeric = 1;
          if (typeof prev === 'number') {
            currentNumeric = prev;
          } else {
            const pageW = defaultDimensions.width || 595.28;
            currentNumeric = Math.max(0.5, (containerWidth - 48) / pageW);
          }

          const rawNext = currentNumeric * factor;
          const nextScale = Math.min(3.0, Math.max(0.4, Number(rawNext.toFixed(2))));

          // Adjust scroll position so point under cursor stays anchored
          requestAnimationFrame(() => {
            if (!el) return;
            const ratio = nextScale / currentNumeric;
            el.scrollLeft = (currentScrollLeft + cursorX) * ratio - cursorX;
            el.scrollTop = (currentScrollTop + cursorY) * ratio - cursorY;
          });

          // Show floating zoom HUD toast
          setZoomToast(`${Math.round(nextScale * 100)}%`);
          if (zoomToastTimerRef.current) {
            clearTimeout(zoomToastTimerRef.current);
          }
          zoomToastTimerRef.current = setTimeout(() => {
            setZoomToast(null);
          }, 1200);

          return nextScale;
        });
      }
    };

    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [containerWidth, defaultDimensions.width]);

  // Reliable instant jumpToPage
  const jumpToPage = useCallback(
    (pageNum: number) => {
      if (numPages === 0) return;
      const targetPage = Math.max(1, Math.min(pageNum, numPages));

      setCurrentPage(targetPage);
      setInputPage(String(targetPage));

      const container = scrollRef.current;
      if (!container) return;

      const targetElement = container.querySelector<HTMLElement>(
        `[data-page-number="${targetPage}"]`,
      );

      if (targetElement) {
        const containerRect = container.getBoundingClientRect();
        const elementRect = targetElement.getBoundingClientRect();
        const offset = elementRect.top - containerRect.top;
        const finalScrollTop = Math.max(0, container.scrollTop + offset - 12);

        container.scrollTo({
          top: finalScrollTop,
          behavior: 'instant',
        });
      }
    },
    [numPages],
  );

  // Lets the field builder scroll to a page, for example when the review screen
  // links to a problem field.
  useImperativeHandle(ref, () => ({ jumpToPage }), [jumpToPage]);

  useEffect(() => {
    if (numPages > 0) onPageChange?.(currentPage);
  }, [currentPage, numPages, onPageChange]);

  // Track active page via maximum visible viewport intersection
  const handleScroll = useCallback(() => {
    if (!scrollRef.current || numPages === 0) {
      return;
    }

    const container = scrollRef.current;
    const containerRect = container.getBoundingClientRect();
    const pageElements = container.querySelectorAll<HTMLElement>('[data-page-number]');

    let bestPage = currentPage;
    let maxVisibleHeight = -1;

    for (const el of pageElements) {
      const rect = el.getBoundingClientRect();
      const pageNum = Number(el.dataset.pageNumber);

      const visibleTop = Math.max(rect.top, containerRect.top);
      const visibleBottom = Math.min(rect.bottom, containerRect.bottom);
      const visibleHeight = Math.max(0, visibleBottom - visibleTop);

      if (visibleHeight > maxVisibleHeight) {
        maxVisibleHeight = visibleHeight;
        bestPage = pageNum;
      }
    }

    if (
      bestPage !== currentPage &&
      bestPage >= 1 &&
      bestPage <= numPages &&
      maxVisibleHeight > 40
    ) {
      setCurrentPage(bestPage);
    }
  }, [currentPage, numPages]);

  // Handle page input commit
  const commitInputPage = () => {
    const parsed = Number.parseInt(inputPage.trim(), 10);
    if (!Number.isNaN(parsed) && parsed >= 1 && parsed <= numPages) {
      jumpToPage(parsed);
    } else {
      setInputPage(String(currentPage));
    }
  };

  const changeScale = (newScale: ScaleMode) => {
    setScale(newScale);
    if (typeof newScale === 'number') {
      setZoomToast(`${Math.round(newScale * 100)}%`);
      if (zoomToastTimerRef.current) clearTimeout(zoomToastTimerRef.current);
      zoomToastTimerRef.current = setTimeout(() => setZoomToast(null), 1200);
    }
  };

  const currentNumericScale =
    typeof scale === 'number'
      ? scale
      : Math.max(0.5, (containerWidth - 48) / (defaultDimensions.width || 595.28));

  const zoomIn = () => {
    const nextScale = Math.min(3.0, Number((currentNumericScale + 0.25).toFixed(2)));
    changeScale(nextScale);
  };

  const zoomOut = () => {
    const nextScale = Math.max(0.4, Number((currentNumericScale - 0.25).toFixed(2)));
    changeScale(nextScale);
  };

  // Keyboard navigation shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (
        e.target instanceof HTMLInputElement ||
        e.target instanceof HTMLSelectElement ||
        e.target instanceof HTMLTextAreaElement
      ) {
        return;
      }
      // An overlay that has already acted on the key owns it: without this,
      // nudging a field with the arrow keys would also turn the page.
      if (e.defaultPrevented) return;
      if (e.target instanceof Element && e.target.closest('[data-pdf-overlay]')) return;
      if (e.key === 'ArrowRight' || e.key === 'PageDown') {
        e.preventDefault();
        jumpToPage(currentPage + 1);
      } else if (e.key === 'ArrowLeft' || e.key === 'PageUp') {
        e.preventDefault();
        jumpToPage(currentPage - 1);
      } else if (e.key === 'Home') {
        e.preventDefault();
        jumpToPage(1);
      } else if (e.key === 'End') {
        e.preventDefault();
        jumpToPage(numPages);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [currentPage, numPages, jumpToPage]);

  if (error) {
    return (
      <div
        className={`flex items-center justify-center p-8 bg-red-50 text-red-600 rounded-xl ${className}`}
      >
        {error}
      </div>
    );
  }

  if (!pdfDoc) {
    return (
      <div
        className={`flex items-center justify-center p-8 bg-slate-50 text-slate-500 rounded-xl ${className}`}
      >
        Loading document...
      </div>
    );
  }

  return (
    <div
      ref={containerRef}
      className={`relative flex flex-col h-full w-full bg-slate-200/70 overflow-hidden outline-none select-none ${className}`}
    >
      {/* Sleek, Professional Toolbar */}
      <div className="flex-none flex items-center justify-between px-3 py-1.5 bg-white border-b border-slate-200/90 shadow-xs z-10 sticky top-0 gap-2">
        {/* Page Navigation Group */}
        <div className="flex items-center space-x-1 text-slate-700">
          <button
            type="button"
            onClick={() => jumpToPage(1)}
            disabled={currentPage <= 1}
            className="p-1 rounded-md text-slate-500 hover:text-slate-800 hover:bg-slate-100 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
            aria-label="First Page"
            title="First Page (Home)"
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              width="16"
              height="16"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <path d="m11 17-5-5 5-5m7 10-5-5 5-5" />
            </svg>
          </button>

          <button
            type="button"
            onClick={() => jumpToPage(currentPage - 1)}
            disabled={currentPage <= 1}
            className="p-1.5 rounded-md text-slate-600 hover:text-slate-900 hover:bg-slate-100 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
            aria-label="Previous Page"
            title="Previous Page (← / PageUp)"
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              width="16"
              height="16"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.5"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <path d="m15 18-6-6 6-6" />
            </svg>
          </button>

          <form
            onSubmit={(e) => {
              e.preventDefault();
              commitInputPage();
            }}
            className="flex items-center mx-1"
          >
            <input
              type="number"
              min={1}
              max={numPages}
              value={inputPage}
              onChange={(e) => setInputPage(e.target.value)}
              onBlur={commitInputPage}
              className="w-12 text-center border border-slate-300 rounded-md px-1 py-0.5 text-xs font-semibold text-slate-800 focus:border-brand-600 focus:outline-none focus:ring-1 focus:ring-brand-600 shadow-xs"
              aria-label="Current Page Number"
            />
            <span className="text-slate-500 ml-1.5 text-xs font-medium">of {numPages}</span>
          </form>

          <button
            type="button"
            onClick={() => jumpToPage(currentPage + 1)}
            disabled={currentPage >= numPages}
            className="p-1.5 rounded-md text-slate-600 hover:text-slate-900 hover:bg-slate-100 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
            aria-label="Next Page"
            title="Next Page (→ / PageDown)"
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              width="16"
              height="16"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.5"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <path d="m9 18 6-6-6-6" />
            </svg>
          </button>

          <button
            type="button"
            onClick={() => jumpToPage(numPages)}
            disabled={currentPage >= numPages}
            className="p-1 rounded-md text-slate-500 hover:text-slate-800 hover:bg-slate-100 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
            aria-label="Last Page"
            title="Last Page (End)"
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              width="16"
              height="16"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <path d="m13 17 5-5-5-5M6 17l5-5-5-5" />
            </svg>
          </button>
        </div>

        {/* Clean, Unified Zoom Controls (Google Drive / Figma standard) */}
        <div className="flex items-center space-x-2 text-xs">
          <div className="flex items-center bg-slate-100/90 rounded-lg p-0.5 border border-slate-200">
            {/* Zoom Out Button */}
            <button
              type="button"
              onClick={zoomOut}
              className="p-1 rounded text-slate-600 hover:text-slate-900 hover:bg-white transition-colors"
              aria-label="Zoom Out"
              title="Zoom Out (Ctrl + Scroll Down)"
            >
              <svg
                xmlns="http://www.w3.org/2000/svg"
                width="14"
                height="14"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.5"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
              >
                <line x1="5" y1="12" x2="19" y2="12" />
              </svg>
            </button>

            {/* Zoom Preset Select */}
            <select
              value={typeof scale === 'number' ? String(scale) : scale}
              onChange={(e) => {
                const val = e.target.value;
                if (val === 'fit-width') {
                  changeScale('fit-width');
                } else {
                  changeScale(Number(val));
                }
              }}
              className="border-0 bg-transparent px-1.5 py-0.5 text-slate-700 focus:outline-none text-xs font-semibold cursor-pointer"
              aria-label="Zoom Level"
            >
              <option value="fit-width">Fit Width</option>
              {ZOOM_PRESETS.map((z) => (
                <option key={z} value={String(z)}>
                  {Math.round(z * 100)}%
                </option>
              ))}
            </select>

            {/* Zoom In Button */}
            <button
              type="button"
              onClick={zoomIn}
              className="p-1 rounded text-slate-600 hover:text-slate-900 hover:bg-white transition-colors"
              aria-label="Zoom In"
              title="Zoom In (Ctrl + Scroll Up)"
            >
              <svg
                xmlns="http://www.w3.org/2000/svg"
                width="14"
                height="14"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.5"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
              >
                <line x1="12" y1="5" x2="12" y2="19" />
                <line x1="5" y1="12" x2="19" y2="12" />
              </svg>
            </button>
          </div>

          {/* Dedicated Fit Width Button */}
          <button
            type="button"
            onClick={() => changeScale('fit-width')}
            className={`px-2.5 py-1 rounded-lg text-xs font-semibold transition-all shadow-xs ${
              scale === 'fit-width'
                ? 'bg-brand-600 text-white shadow-xs'
                : 'bg-white text-slate-700 hover:bg-slate-100 border border-slate-200'
            }`}
          >
            Fit Width
          </button>
        </div>
      </div>

      {/* Infinite Document Canvas with smooth scrolling & Ctrl+Wheel zoom */}
      <section
        ref={scrollRef}
        onScroll={handleScroll}
        aria-label="PDF Document Scroll Area"
        className="flex-1 min-h-0 overflow-y-auto p-4 md:p-6 outline-none overscroll-contain cursor-default"
        style={{ WebkitOverflowScrolling: 'touch' }}
      >
        <div className="flex flex-col items-center mx-auto" style={{ maxWidth: '100%' }}>
          {Array.from({ length: numPages }, (_, i) => i + 1).map((pageNum) => (
            <PdfPage
              key={pageNum}
              pdfDoc={pdfDoc}
              pageNumber={pageNum}
              scale={scale}
              containerWidth={containerWidth}
              defaultDimensions={defaultDimensions}
              renderPageOverlay={renderPageOverlay}
            />
          ))}
        </div>
      </section>

      {/* Floating Zoom HUD Pill (shows when zooming via mouse wheel) */}
      {zoomToast && (
        <div className="absolute bottom-5 left-1/2 -translate-x-1/2 bg-slate-900/90 backdrop-blur text-white px-3.5 py-1 rounded-full text-xs font-semibold shadow-lg pointer-events-none transition-all animate-fade-in z-20">
          Zoom: {zoomToast}
        </div>
      )}
    </div>
  );
}
