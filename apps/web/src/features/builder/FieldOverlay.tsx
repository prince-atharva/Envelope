import {
  type AlignmentGuide,
  type FieldInfo,
  findAlignmentGuides,
  type PageSize,
  type PdfRect,
  type RecipientInfo,
  ratiosToPoints,
  validateRatios,
} from '@envelope/shared';
import { type PointerEvent as ReactPointerEvent, useRef, useState } from 'react';
import type { PageRenderInfo } from '../../components/pdf/PdfViewer';
import type { BuilderAction } from './builder-state';
import { recipientColor } from './recipient-colors';

const FIELD_LABEL: Record<FieldInfo['type'], string> = {
  SIGNATURE: 'Signature',
  INITIALS: 'Initials',
  DATE_SIGNED: 'Date',
  TEXT_INPUT: 'Text',
  CHECKBOX: 'Tick box',
};

type Corner = 'nw' | 'ne' | 'sw' | 'se';

interface DragState {
  kind: 'move' | 'resize';
  corner?: Corner;
  fieldId: string;
  startClient: { x: number; y: number };
  startRect: PdfRect;
  lastDelta: { x: number; y: number };
}

interface FieldOverlayProps {
  page: PageRenderInfo;
  fields: FieldInfo[];
  recipients: RecipientInfo[];
  selection: string[];
  dispatch: (action: BuilderAction) => void;
  onAddAt?: (pageNumber: number, centrePt: { xPt: number; yPt: number }) => void;
}

/**
 * The layer of field boxes over one page.
 *
 * Pointer events are handled here directly rather than through a drag-and-drop
 * library: the pixel movement has to be divided by the page's pixels-per-point
 * before anything else happens to it, and a library that does its own
 * arithmetic would be a second place where the coordinate rules live.
 */
export function FieldOverlay({
  page,
  fields,
  recipients,
  selection,
  dispatch,
  onAddAt,
}: FieldOverlayProps) {
  const [guides, setGuides] = useState<AlignmentGuide[]>([]);
  const dragRef = useRef<DragState | null>(null);
  const layerRef = useRef<HTMLDivElement>(null);

  const pageSize: PageSize = { widthPt: page.widthPt, heightPt: page.heightPt };
  const byId = new Map(recipients.map((r) => [r.id, r]));

  const toPoints = (field: FieldInfo) => ratiosToPoints(field, pageSize);

  function beginDrag(
    event: ReactPointerEvent<HTMLElement>,
    field: FieldInfo,
    kind: 'move' | 'resize',
    corner?: Corner,
  ) {
    event.stopPropagation();
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);

    if (!selection.includes(field.id)) {
      dispatch({ type: 'select', ids: [field.id], additive: event.shiftKey });
    }

    dragRef.current = {
      kind,
      corner,
      fieldId: field.id,
      startClient: { x: event.clientX, y: event.clientY },
      startRect: toPoints(field),
      lastDelta: { x: 0, y: 0 },
    };
  }

  function onPointerMove(event: ReactPointerEvent<HTMLElement>) {
    const drag = dragRef.current;
    if (!drag) return;

    // Screen movement becomes movement in points. This division is the only
    // place zoom enters the calculation.
    const deltaPt = {
      x: (event.clientX - drag.startClient.x) / page.pxPerPt,
      y: (event.clientY - drag.startClient.y) / page.pxPerPt,
    };
    // Alt bypasses snapping, for placing a box against something already on the
    // page (docs/09).
    const snap = !event.altKey;

    if (drag.kind === 'move') {
      const step = { x: deltaPt.x - drag.lastDelta.x, y: deltaPt.y - drag.lastDelta.y };
      drag.lastDelta = deltaPt;
      dispatch({ type: 'moveSelection', deltaPt: step, page: pageSize, snap });
    } else {
      const rect = resizedRect(drag.startRect, drag.corner ?? 'se', deltaPt);
      dispatch({
        type: 'resizeField',
        id: drag.fieldId,
        rectPt: rect,
        page: pageSize,
        anchor: drag.corner === 'nw' ? 'bottom-right' : 'top-left',
        snap,
      });
    }

    const moving = fields.find((f) => f.id === drag.fieldId);
    if (moving) {
      setGuides(
        findAlignmentGuides(
          toPoints(moving),
          fields.filter((f) => f.id !== drag.fieldId).map(toPoints),
        ),
      );
    }
  }

  function endDrag(event: ReactPointerEvent<HTMLElement>) {
    if (!dragRef.current) return;
    event.currentTarget.releasePointerCapture(event.pointerId);
    dragRef.current = null;
    setGuides([]);
  }

  /** A click on blank page space: deselect, or place a field when one is armed. */
  function onLayerPointerDown(event: ReactPointerEvent<HTMLDivElement>) {
    if (event.target !== event.currentTarget) return;
    const rect = layerRef.current?.getBoundingClientRect();
    if (!rect || !onAddAt) {
      dispatch({ type: 'clearSelection' });
      return;
    }
    onAddAt(page.pageNumber, {
      xPt: (event.clientX - rect.left) / page.pxPerPt,
      yPt: (event.clientY - rect.top) / page.pxPerPt,
    });
  }

  return (
    // The layer itself is a surface, not a control: a click on it places a field
    // or clears the selection. Every field on it is a real button, and the
    // palette offers the same placement by keyboard.
    <div
      ref={layerRef}
      className="absolute inset-0"
      style={{ touchAction: 'none' }}
      onPointerDown={onLayerPointerDown}
    >
      {guides.map((guide) => (
        <div
          key={`${guide.axis}-${guide.positionPt}`}
          aria-hidden="true"
          className="absolute bg-fuchsia-600/80 pointer-events-none"
          style={
            guide.axis === 'x'
              ? { left: guide.positionPt * page.pxPerPt, top: 0, width: 1, height: '100%' }
              : { top: guide.positionPt * page.pxPerPt, left: 0, height: 1, width: '100%' }
          }
        />
      ))}

      {fields.map((field) => {
        const recipient = byId.get(field.recipientId);
        const color = recipientColor(recipient?.colorIndex ?? 0);
        const selected = selection.includes(field.id);
        const invalid = validateRatios(field) !== null;
        const rect = toPoints(field);

        return (
          <button
            type="button"
            key={field.id}
            data-field-id={field.id}
            data-testid={`field-${field.id}`}
            aria-label={`${FIELD_LABEL[field.type]} field for ${recipient?.name ?? 'nobody'}, page ${field.pageNumber}`}
            aria-pressed={selected}
            className={`absolute border-2 text-left ${invalid ? 'border-red-600 bg-red-500/20' : color.box} ${
              selected ? 'ring-2 ring-offset-1 ring-slate-900' : ''
            } cursor-move`}
            style={{
              left: rect.x * page.pxPerPt,
              top: rect.y * page.pxPerPt,
              width: rect.width * page.pxPerPt,
              height: rect.height * page.pxPerPt,
              touchAction: 'none',
            }}
            onPointerDown={(event) => beginDrag(event, field, 'move')}
            onPointerMove={onPointerMove}
            onPointerUp={endDrag}
            onPointerCancel={endDrag}
            onClick={(event) => {
              event.stopPropagation();
              dispatch({ type: 'select', ids: [field.id], additive: event.shiftKey });
            }}
          >
            {/* The name, not only the colour: colour alone fails WCAG and fails
                anyone who cannot tell two of the palette apart. */}
            <span
              className={`absolute -top-5 left-0 whitespace-nowrap rounded px-1 text-[10px] font-medium leading-4 ${color.label}`}
            >
              {recipient?.name ?? 'Unassigned'} · {FIELD_LABEL[field.type]}
              {field.required ? '' : ' (optional)'}
            </span>

            {selected &&
              (['nw', 'ne', 'sw', 'se'] as Corner[]).map((corner) => (
                <span
                  key={corner}
                  data-testid={`resize-${corner}`}
                  role="presentation"
                  className={`absolute h-3 w-3 rounded-full border border-white bg-slate-900 ${cornerPosition(corner)}`}
                  style={{ touchAction: 'none' }}
                  onPointerDown={(event) => beginDrag(event, field, 'resize', corner)}
                  onPointerMove={onPointerMove}
                  onPointerUp={endDrag}
                  onPointerCancel={endDrag}
                />
              ))}
          </button>
        );
      })}
    </div>
  );
}

function cornerPosition(corner: Corner): string {
  switch (corner) {
    case 'nw':
      return '-left-1.5 -top-1.5 cursor-nwse-resize';
    case 'ne':
      return '-right-1.5 -top-1.5 cursor-nesw-resize';
    case 'sw':
      return '-left-1.5 -bottom-1.5 cursor-nesw-resize';
    default:
      return '-right-1.5 -bottom-1.5 cursor-nwse-resize';
  }
}

/** The rectangle after dragging one corner by `deltaPt`; the opposite corner stays put. */
function resizedRect(start: PdfRect, corner: Corner, deltaPt: { x: number; y: number }): PdfRect {
  const left = corner === 'nw' || corner === 'sw' ? start.x + deltaPt.x : start.x;
  const top = corner === 'nw' || corner === 'ne' ? start.y + deltaPt.y : start.y;
  const right =
    corner === 'ne' || corner === 'se' ? start.x + start.width + deltaPt.x : start.x + start.width;
  const bottom =
    corner === 'sw' || corner === 'se'
      ? start.y + start.height + deltaPt.y
      : start.y + start.height;

  return {
    x: Math.min(left, right),
    y: Math.min(top, bottom),
    width: Math.abs(right - left),
    height: Math.abs(bottom - top),
  };
}
