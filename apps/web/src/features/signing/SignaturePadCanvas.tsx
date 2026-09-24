import { type Ref, useEffect, useImperativeHandle, useRef } from 'react';
import SignaturePad from 'signature_pad';
import { CloseIcon } from '../../components/ui/icons';
import { INK_COLOUR } from './signature-image';

export interface SignaturePadHandle {
  clear(): void;
  isEmpty(): boolean;
  /** The drawing canvas, for turning into the adopted image. */
  canvas(): HTMLCanvasElement | null;
}

/** At least 2×, so a signature drawn on a low-density screen is still sharp in the PDF (docs/09). */
const MIN_PIXEL_RATIO = 2;

/**
 * A box to draw a signature in with a finger, pen or mouse (`signature_pad`,
 * variable-width Bézier strokes).
 *
 * The iOS handling is not optional (docs/09, "Signature capture"): without
 * `touch-action: none` on the canvas and a non-passive touchmove handler that
 * cancels the event, Safari scrolls the page under the finger and the stroke
 * is unusable. Emulation does not reproduce this; it must be checked on a real
 * iPhone (step 11).
 */
export function SignaturePadCanvas({
  label,
  onChange,
  ref,
}: {
  label: string;
  /** Called after each stroke and after Clear, with whether anything is drawn. */
  onChange: (hasInk: boolean) => void;
  ref?: Ref<SignaturePadHandle>;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const padRef = useRef<SignaturePad | null>(null);
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  useImperativeHandle(ref, () => ({
    clear() {
      padRef.current?.clear();
      onChangeRef.current(false);
    },
    isEmpty: () => padRef.current?.isEmpty() ?? true,
    canvas: () => canvasRef.current,
  }));

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const pad = new SignaturePad(canvas, {
      penColor: INK_COLOUR,
      minWidth: 1.2,
      maxWidth: 3.2,
      // Fully transparent: the image goes on top of the document (docs/06).
      backgroundColor: 'rgba(0,0,0,0)',
    });
    padRef.current = pad;

    // The backing store follows the box's size on screen. Strokes are kept
    // across a resize (turning the phone, opening the keyboard).
    const fitToBox = () => {
      const width = canvas.offsetWidth;
      const height = canvas.offsetHeight;
      if (width === 0 || height === 0) return; // Not on screen yet.
      const ratio = Math.max(window.devicePixelRatio || 1, MIN_PIXEL_RATIO);
      if (
        canvas.width === Math.round(width * ratio) &&
        canvas.height === Math.round(height * ratio)
      )
        return;
      const strokes = pad.toData();
      canvas.width = Math.round(width * ratio);
      canvas.height = Math.round(height * ratio);
      canvas.getContext('2d')?.scale(ratio, ratio);
      pad.clear();
      pad.fromData(strokes);
    };
    fitToBox();
    const observer = new ResizeObserver(fitToBox);
    observer.observe(canvas);

    const holdStill = (event: TouchEvent) => event.preventDefault();
    canvas.addEventListener('touchmove', holdStill, { passive: false });
    const strokeEnded = () => onChangeRef.current(!pad.isEmpty());
    pad.addEventListener('endStroke', strokeEnded);

    return () => {
      observer.disconnect();
      canvas.removeEventListener('touchmove', holdStill);
      pad.removeEventListener('endStroke', strokeEnded);
      pad.off();
      padRef.current = null;
    };
  }, []);

  return (
    <div className="relative w-full rounded-xl border-2 border-dashed border-slate-300 bg-white/60 shadow-inner overflow-hidden">
      {/* Signature baseline guide - sits behind transparent canvas */}
      <div className="pointer-events-none absolute inset-x-6 bottom-10 flex items-center gap-2 border-b border-slate-200 select-none">
        <CloseIcon className="h-3.5 w-3.5 text-slate-300" />
        <span className="text-xs font-medium text-slate-400 uppercase tracking-wider">
          Sign above this line
        </span>
      </div>

      <canvas
        ref={canvasRef}
        aria-label={label}
        className="relative block h-56 w-full cursor-crosshair touch-none select-none bg-transparent sm:h-64 md:h-72"
        style={{ WebkitUserSelect: 'none', WebkitTouchCallout: 'none' }}
      />
    </div>
  );
}
