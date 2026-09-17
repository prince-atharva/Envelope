import {
  clampRectToPage,
  defaultRectAt,
  enforceMinSize,
  type FieldInfo,
  type FieldType,
  NUDGE_LARGE_PT,
  NUDGE_PT,
  type PageSize,
  type PdfRect,
  pointsToRatios,
  ratiosToPoints,
  snapToGrid,
} from '@envelope/shared';

/**
 * The field layout while it is being edited.
 *
 * Fields are held exactly as they are stored, as ratios. Every interaction
 * converts to points, does its arithmetic there, and converts back:
 *
 *     ratios → points → move/resize/snap/clamp → ratios
 *
 * Points are the same size at every zoom level, so a box dragged to the same
 * place at 100% and at 200% produces identical stored numbers. That equality is
 * the exit criterion for this phase, and doing the arithmetic in pixels is what
 * would quietly break it.
 */

export interface BuilderState {
  fields: FieldInfo[];
  /** Ids of the selected fields. Several at once when shift-clicking. */
  selection: string[];
  /** Who new fields belong to. */
  activeRecipientId: string | null;
  /** True once anything has changed since the last save. */
  dirty: boolean;
}

export type BuilderAction =
  | { type: 'reset'; fields: FieldInfo[] }
  | { type: 'setActiveRecipient'; recipientId: string | null }
  | {
      type: 'addField';
      id: string;
      fieldType: FieldType;
      recipientId: string;
      pageNumber: number;
      page: PageSize;
      centrePt: { xPt: number; yPt: number };
    }
  | { type: 'select'; ids: string[]; additive?: boolean }
  | { type: 'clearSelection' }
  | { type: 'moveSelection'; deltaPt: { x: number; y: number }; page: PageSize; snap?: boolean }
  | {
      type: 'resizeField';
      id: string;
      rectPt: PdfRect;
      page: PageSize;
      anchor: 'top-left' | 'bottom-right';
      snap?: boolean;
    }
  | {
      type: 'nudgeSelection';
      direction: 'up' | 'down' | 'left' | 'right';
      large: boolean;
      pages: Map<number, PageSize>;
    }
  | { type: 'deleteSelection' }
  | { type: 'assignSelection'; recipientId: string }
  | { type: 'setRequired'; id: string; required: boolean }
  | { type: 'copyToAllPages'; id: string; pageCount: number; newIds: string[] }
  | { type: 'removeRecipientFields'; recipientId: string }
  | { type: 'saved'; fields: FieldInfo[] };

export const initialBuilderState: BuilderState = {
  fields: [],
  selection: [],
  activeRecipientId: null,
  dirty: false,
};

/** Applies a rectangle in points back onto a field, as ratios. */
function withRect(field: FieldInfo, rectPt: PdfRect, page: PageSize): FieldInfo {
  return { ...field, ...pointsToRatios(clampRectToPage(rectPt, page), page) };
}

export function builderReducer(state: BuilderState, action: BuilderAction): BuilderState {
  switch (action.type) {
    case 'reset':
      return { ...state, fields: action.fields, selection: [], dirty: false };

    case 'saved':
      return { ...state, fields: action.fields, dirty: false };

    case 'setActiveRecipient':
      return { ...state, activeRecipientId: action.recipientId };

    case 'addField': {
      const rect = defaultRectAt(action.fieldType, action.centrePt, action.page);
      const field: FieldInfo = {
        id: action.id,
        recipientId: action.recipientId,
        type: action.fieldType,
        pageNumber: action.pageNumber,
        required: true,
        ...pointsToRatios(rect, action.page),
      };
      return { ...state, fields: [...state.fields, field], selection: [field.id], dirty: true };
    }

    case 'select':
      return {
        ...state,
        selection: action.additive ? [...new Set([...state.selection, ...action.ids])] : action.ids,
      };

    case 'clearSelection':
      return { ...state, selection: [] };

    case 'moveSelection': {
      if (state.selection.length === 0) return state;
      const fields = state.fields.map((field) => {
        if (!state.selection.includes(field.id)) return field;
        const rect = ratiosToPoints(field, action.page);
        const moved = {
          ...rect,
          x: action.snap ? snapToGrid(rect.x + action.deltaPt.x) : rect.x + action.deltaPt.x,
          y: action.snap ? snapToGrid(rect.y + action.deltaPt.y) : rect.y + action.deltaPt.y,
        };
        return withRect(field, moved, action.page);
      });
      return { ...state, fields, dirty: true };
    }

    case 'resizeField': {
      const fields = state.fields.map((field) => {
        if (field.id !== action.id) return field;
        const snapped = action.snap
          ? {
              x: snapToGrid(action.rectPt.x),
              y: snapToGrid(action.rectPt.y),
              width: snapToGrid(action.rectPt.width),
              height: snapToGrid(action.rectPt.height),
            }
          : action.rectPt;
        const sized = enforceMinSize(snapped, field.type, action.page, action.anchor);
        return withRect(field, sized, action.page);
      });
      return { ...state, fields, dirty: true };
    }

    case 'nudgeSelection': {
      if (state.selection.length === 0) return state;
      const step = action.large ? NUDGE_LARGE_PT : NUDGE_PT;
      const delta = {
        x: action.direction === 'left' ? -step : action.direction === 'right' ? step : 0,
        y: action.direction === 'up' ? -step : action.direction === 'down' ? step : 0,
      };
      const fields = state.fields.map((field) => {
        if (!state.selection.includes(field.id)) return field;
        const page = action.pages.get(field.pageNumber);
        if (!page) return field;
        const rect = ratiosToPoints(field, page);
        return withRect(field, { ...rect, x: rect.x + delta.x, y: rect.y + delta.y }, page);
      });
      return { ...state, fields, dirty: true };
    }

    case 'deleteSelection': {
      if (state.selection.length === 0) return state;
      return {
        ...state,
        fields: state.fields.filter((field) => !state.selection.includes(field.id)),
        selection: [],
        dirty: true,
      };
    }

    case 'assignSelection': {
      if (state.selection.length === 0) return state;
      return {
        ...state,
        fields: state.fields.map((field) =>
          state.selection.includes(field.id)
            ? { ...field, recipientId: action.recipientId }
            : field,
        ),
        dirty: true,
      };
    }

    case 'setRequired':
      return {
        ...state,
        fields: state.fields.map((field) =>
          field.id === action.id ? { ...field, required: action.required } : field,
        ),
        dirty: true,
      };

    case 'copyToAllPages': {
      const source = state.fields.find((field) => field.id === action.id);
      if (!source) return state;
      // Ratios are relative to each page, so the same numbers put the box in the
      // same relative spot even where pages differ in size.
      const copies: FieldInfo[] = [];
      let next = 0;
      for (let page = 1; page <= action.pageCount; page += 1) {
        if (page === source.pageNumber) continue;
        const id = action.newIds[next];
        next += 1;
        if (!id) break;
        copies.push({ ...source, id, pageNumber: page });
      }
      return { ...state, fields: [...state.fields, ...copies], dirty: true };
    }

    case 'removeRecipientFields': {
      const remaining = state.fields.filter((field) => field.recipientId !== action.recipientId);
      if (remaining.length === state.fields.length) return state;
      return { ...state, fields: remaining, selection: [], dirty: true };
    }

    default:
      return state;
  }
}
