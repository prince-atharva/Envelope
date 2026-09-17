import type { FieldInfo, PageSize } from '@envelope/shared';
import { pointsToRatios, ratiosToPoints, validateRatios } from '@envelope/shared';
import { describe, expect, it } from 'vitest';
import { type BuilderState, builderReducer, initialBuilderState } from './builder-state';

const A4: PageSize = { widthPt: 595.28, heightPt: 841.89 };
/**
 * Storing a position as a ratio rounded to 6 decimals loses up to 1e-6 of the
 * page, which is about 0.0006pt on A4 (ADR 0002). So a value that was exactly
 * on the grid, or exactly at the minimum size, comes back a fraction off. That
 * is invisible and far inside the 1pt placement tolerance, but it means these
 * tests compare within the rounding, not for exact equality.
 */
const ROUNDING_PT = 0.001;
const LETTER: PageSize = { widthPt: 612, heightPt: 792 };

/** How far a length in points is from the nearest 4pt grid line. */
function distanceToGrid(valuePt: number, gridPt = 4): number {
  const remainder = Math.abs(valuePt) % gridPt;
  return Math.min(remainder, gridPt - remainder);
}

function stateWithField(overrides: Partial<FieldInfo> = {}): BuilderState {
  const field: FieldInfo = {
    id: 'field-1',
    recipientId: 'recipient-1',
    type: 'SIGNATURE',
    pageNumber: 1,
    required: true,
    ...pointsToRatios({ x: 100, y: 200, width: 150, height: 40 }, A4),
    ...overrides,
  };
  return { ...initialBuilderState, fields: [field], selection: [field.id] };
}

describe('placing a field', () => {
  it('centres it on the click and marks the layout unsaved', () => {
    const next = builderReducer(
      { ...initialBuilderState, activeRecipientId: 'recipient-1' },
      {
        type: 'addField',
        id: 'new-field',
        fieldType: 'SIGNATURE',
        recipientId: 'recipient-1',
        pageNumber: 2,
        page: A4,
        centrePt: { xPt: 300, yPt: 400 },
      },
    );

    expect(next.fields).toHaveLength(1);
    expect(next.selection).toEqual(['new-field']);
    expect(next.dirty).toBe(true);

    const rect = ratiosToPoints(next.fields[0] as FieldInfo, A4);
    expect(rect.width).toBeCloseTo(150, 3);
    expect(rect.x + rect.width / 2).toBeCloseTo(299, 0);
  });

  it('keeps a field dropped at the page edge on the page', () => {
    const next = builderReducer(initialBuilderState, {
      type: 'addField',
      id: 'edge',
      fieldType: 'SIGNATURE',
      recipientId: 'recipient-1',
      pageNumber: 1,
      page: A4,
      centrePt: { xPt: A4.widthPt + 50, yPt: A4.heightPt },
    });

    expect(validateRatios(next.fields[0] as FieldInfo)).toBeNull();
  });
});

describe('moving a field', () => {
  it('snaps to the 4pt grid', () => {
    const next = builderReducer(stateWithField(), {
      type: 'moveSelection',
      deltaPt: { x: 7, y: -3 },
      page: A4,
      snap: true,
    });

    const rect = ratiosToPoints(next.fields[0] as FieldInfo, A4);
    expect(distanceToGrid(rect.x)).toBeLessThan(ROUNDING_PT);
    expect(distanceToGrid(rect.y)).toBeLessThan(ROUNDING_PT);
  });

  it('moves by the exact amount when snapping is bypassed', () => {
    const next = builderReducer(stateWithField(), {
      type: 'moveSelection',
      deltaPt: { x: 7, y: 5 },
      page: A4,
      snap: false,
    });

    const rect = ratiosToPoints(next.fields[0] as FieldInfo, A4);
    expect(rect.x).toBeCloseTo(107, 2);
    expect(rect.y).toBeCloseTo(205, 2);
  });

  it('stores the same ratios whatever the zoom the drag happened at', () => {
    // The same 24pt movement, arrived at from different pixel deltas: 48px at
    // 200% and 24px at 100% are both 24pt, and must store identical numbers.
    const atFullZoom = builderReducer(stateWithField(), {
      type: 'moveSelection',
      deltaPt: { x: 48 / 2, y: 48 / 2 },
      page: A4,
      snap: true,
    });
    const atNormalZoom = builderReducer(stateWithField(), {
      type: 'moveSelection',
      deltaPt: { x: 24 / 1, y: 24 / 1 },
      page: A4,
      snap: true,
    });

    expect(atFullZoom.fields).toEqual(atNormalZoom.fields);
  });

  it('cannot push a field off the page', () => {
    const next = builderReducer(stateWithField(), {
      type: 'moveSelection',
      deltaPt: { x: 10_000, y: 10_000 },
      page: A4,
      snap: true,
    });

    expect(validateRatios(next.fields[0] as FieldInfo)).toBeNull();
  });
});

describe('resizing a field', () => {
  it('refuses to make a signature smaller than 40x15pt', () => {
    const next = builderReducer(stateWithField(), {
      type: 'resizeField',
      id: 'field-1',
      rectPt: { x: 100, y: 200, width: 4, height: 2 },
      page: A4,
      anchor: 'top-left',
    });

    const rect = ratiosToPoints(next.fields[0] as FieldInfo, A4);
    expect(rect.width).toBeGreaterThan(40 - ROUNDING_PT);
    expect(rect.height).toBeGreaterThan(15 - ROUNDING_PT);
  });

  it('lets a tick box stay square and small', () => {
    const next = builderReducer(stateWithField({ type: 'CHECKBOX' }), {
      type: 'resizeField',
      id: 'field-1',
      rectPt: { x: 100, y: 200, width: 12, height: 12 },
      page: A4,
      anchor: 'top-left',
    });

    const rect = ratiosToPoints(next.fields[0] as FieldInfo, A4);
    expect(rect.width).toBeCloseTo(12, 1);
    expect(rect.height).toBeCloseTo(12, 1);
  });
});

describe('nudging with the arrow keys', () => {
  const pages = new Map([[1, A4]]);

  it('moves 1pt, and 10pt with shift', () => {
    const small = builderReducer(stateWithField(), {
      type: 'nudgeSelection',
      direction: 'right',
      large: false,
      pages,
    });
    const large = builderReducer(stateWithField(), {
      type: 'nudgeSelection',
      direction: 'right',
      large: true,
      pages,
    });

    expect(ratiosToPoints(small.fields[0] as FieldInfo, A4).x).toBeCloseTo(101, 2);
    expect(ratiosToPoints(large.fields[0] as FieldInfo, A4).x).toBeCloseTo(110, 2);
  });

  it('leaves a field alone when its page size is unknown', () => {
    const before = stateWithField({ pageNumber: 7 });
    const after = builderReducer(before, {
      type: 'nudgeSelection',
      direction: 'up',
      large: false,
      pages,
    });

    expect(after.fields).toEqual(before.fields);
  });
});

describe('copying to every page', () => {
  it('adds one copy per other page, at the same relative position', () => {
    const next = builderReducer(stateWithField(), {
      type: 'copyToAllPages',
      id: 'field-1',
      pageCount: 3,
      newIds: ['copy-2', 'copy-3'],
    });

    expect(next.fields).toHaveLength(3);
    expect(next.fields.map((f) => f.pageNumber).sort()).toEqual([1, 2, 3]);
    // Ratios, not points: on a Letter page the box lands in the same relative
    // spot, which is the whole point of storing positions this way.
    for (const field of next.fields) {
      expect(field.ratioX).toBe((stateWithField().fields[0] as FieldInfo).ratioX);
      expect(validateRatios(field)).toBeNull();
    }
    expect(ratiosToPoints(next.fields[1] as FieldInfo, LETTER).x).toBeCloseTo(
      (next.fields[1] as FieldInfo).ratioX * LETTER.widthPt,
      6,
    );
  });
});

describe('selection', () => {
  it('adds to the selection when shift is held', () => {
    const base = stateWithField();
    const withTwo: BuilderState = {
      ...base,
      fields: [...base.fields, { ...(base.fields[0] as FieldInfo), id: 'field-2' }],
      selection: ['field-1'],
    };

    const next = builderReducer(withTwo, { type: 'select', ids: ['field-2'], additive: true });
    expect(next.selection).toEqual(['field-1', 'field-2']);

    const replaced = builderReducer(withTwo, { type: 'select', ids: ['field-2'] });
    expect(replaced.selection).toEqual(['field-2']);
  });

  it('deletes everything selected', () => {
    const next = builderReducer(stateWithField(), { type: 'deleteSelection' });
    expect(next.fields).toEqual([]);
    expect(next.selection).toEqual([]);
    expect(next.dirty).toBe(true);
  });
});

describe('after a save', () => {
  it('takes the server’s fields and stops being dirty', () => {
    const dirty = { ...stateWithField(), dirty: true };
    const saved = builderReducer(dirty, { type: 'saved', fields: dirty.fields });

    expect(saved.dirty).toBe(false);
  });

  it('drops the fields of someone removed from the envelope', () => {
    const next = builderReducer(stateWithField(), {
      type: 'removeRecipientFields',
      recipientId: 'recipient-1',
    });

    expect(next.fields).toEqual([]);
  });
});
