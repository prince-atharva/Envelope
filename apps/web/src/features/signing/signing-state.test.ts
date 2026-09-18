import type { SigningField } from '@envelope/shared';
import { describe, expect, it } from 'vitest';
import {
  fieldAccessibleName,
  isFilled,
  nextField,
  SIGNED_MARK,
  signingProgress,
  toSubmission,
} from './signing-state';

let counter = 0;
function field(overrides: Partial<SigningField> & Pick<SigningField, 'type'>): SigningField {
  counter += 1;
  return {
    id: `00000000-0000-4000-8000-${String(counter).padStart(12, '0')}`,
    pageNumber: 1,
    required: true,
    ratioX: 0.1,
    ratioY: 0.1,
    ratioWidth: 0.2,
    ratioHeight: 0.05,
    ...overrides,
  };
}

describe('isFilled', () => {
  it('always counts a date as filled: the server writes it', () => {
    expect(isFilled(field({ type: 'DATE_SIGNED' }), {}, {})).toBe(true);
  });

  it('needs both a tap and an adopted signature for a signature box', () => {
    const box = field({ type: 'SIGNATURE' });
    expect(isFilled(box, { [box.id]: SIGNED_MARK }, {})).toBe(false);
    expect(isFilled(box, {}, { SIGNATURE: 'TYPED' })).toBe(false);
    expect(isFilled(box, { [box.id]: SIGNED_MARK }, { SIGNATURE: 'TYPED' })).toBe(true);
  });

  it('does not accept a signature adopted for the other kind', () => {
    const box = field({ type: 'INITIALS' });
    expect(isFilled(box, { [box.id]: SIGNED_MARK }, { SIGNATURE: 'DRAWN' })).toBe(false);
  });

  it('counts a tick box only when it is ticked, and text only when it is not blank', () => {
    const tick = field({ type: 'CHECKBOX' });
    const text = field({ type: 'TEXT_INPUT' });
    expect(isFilled(tick, { [tick.id]: 'false' }, {})).toBe(false);
    expect(isFilled(tick, { [tick.id]: 'true' }, {})).toBe(true);
    expect(isFilled(text, { [text.id]: '   ' }, {})).toBe(false);
    expect(isFilled(text, { [text.id]: 'Acme Ltd' }, {})).toBe(true);
  });
});

describe('signingProgress', () => {
  it('counts required boxes the signer has to act on, leaving out dates and optional ones', () => {
    const sign = field({ type: 'SIGNATURE' });
    const text = field({ type: 'TEXT_INPUT' });
    const fields = [
      sign,
      text,
      field({ type: 'DATE_SIGNED' }),
      field({ type: 'CHECKBOX', required: false }),
    ];

    expect(signingProgress(fields, {}, {})).toEqual({ done: 0, total: 2, complete: false });
    expect(
      signingProgress(fields, { [sign.id]: SIGNED_MARK, [text.id]: 'x' }, { SIGNATURE: 'DRAWN' }),
    ).toEqual({ done: 2, total: 2, complete: true });
  });

  it('is complete at once when nothing is required', () => {
    const fields = [field({ type: 'CHECKBOX', required: false })];
    expect(signingProgress(fields, {}, {})).toEqual({ done: 0, total: 0, complete: true });
  });
});

describe('nextField', () => {
  const first = field({ type: 'SIGNATURE', pageNumber: 1 });
  const optional = field({ type: 'TEXT_INPUT', pageNumber: 1, required: false });
  const date = field({ type: 'DATE_SIGNED', pageNumber: 2 });
  const second = field({ type: 'CHECKBOX', pageNumber: 3 });
  const third = field({ type: 'INITIALS', pageNumber: 9 });
  const fields = [first, optional, date, second, third];

  it('starts at the first required box', () => {
    expect(nextField(fields, {}, {}, null)?.id).toBe(first.id);
  });

  it('moves past the current box even when it is still empty, skipping dates and optional ones', () => {
    expect(nextField(fields, {}, {}, first.id)?.id).toBe(second.id);
    expect(nextField(fields, {}, {}, second.id)?.id).toBe(third.id);
  });

  it('wraps round to the start and skips boxes already filled', () => {
    expect(nextField(fields, {}, {}, third.id)?.id).toBe(first.id);
    expect(nextField(fields, { [second.id]: 'true' }, {}, first.id)?.id).toBe(third.id);
  });

  it('starts from the beginning when the current box is not one of the signer’s', () => {
    expect(nextField(fields, {}, {}, 'somebody-else')?.id).toBe(first.id);
  });

  it('returns null when every required box is done', () => {
    const values = { [first.id]: SIGNED_MARK, [second.id]: 'true', [third.id]: SIGNED_MARK };
    const adopted = { SIGNATURE: 'TYPED', INITIALS: 'TYPED' } as const;
    expect(nextField(fields, values, adopted, null)).toBeNull();
  });
});

describe('toSubmission', () => {
  it('sends what the API expects for each kind of box', () => {
    const sign = field({ type: 'SIGNATURE' });
    const optionalSign = field({ type: 'SIGNATURE', required: false });
    const initials = field({ type: 'INITIALS', required: false });
    const date = field({ type: 'DATE_SIGNED' });
    const ticked = field({ type: 'CHECKBOX' });
    const unticked = field({ type: 'CHECKBOX', required: false });
    const untouched = field({ type: 'CHECKBOX', required: false });
    const text = field({ type: 'TEXT_INPUT' });
    const blank = field({ type: 'TEXT_INPUT', required: false });

    const body = toSubmission(
      [sign, optionalSign, initials, date, ticked, unticked, untouched, text, blank],
      {
        [sign.id]: SIGNED_MARK,
        [optionalSign.id]: SIGNED_MARK,
        // Tapped, but no initials were ever adopted: nothing to send.
        [initials.id]: SIGNED_MARK,
        [date.id]: '2026-01-01',
        [ticked.id]: 'true',
        [unticked.id]: 'false',
        [text.id]: '  Acme Ltd  ',
        [blank.id]: '   ',
      },
      { SIGNATURE: 'DRAWN' },
    );

    expect(body).toEqual({
      fields: [
        { id: sign.id },
        { id: optionalSign.id },
        { id: ticked.id, value: 'true' },
        { id: unticked.id, value: 'false' },
        { id: text.id, value: 'Acme Ltd' },
      ],
    });
  });
});

describe('fieldAccessibleName', () => {
  it('reads the way docs/09 asks', () => {
    expect(fieldAccessibleName(field({ type: 'SIGNATURE', pageNumber: 4 }), 12)).toBe(
      'Signature field, required, page 4 of 12',
    );
    expect(
      fieldAccessibleName(field({ type: 'CHECKBOX', pageNumber: 1, required: false }), 2),
    ).toBe('Tick box field, optional, page 1 of 2');
  });
});
