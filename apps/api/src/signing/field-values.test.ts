import { describe, expect, it } from 'vitest';
import { resolveFieldValues, type SignerField } from './field-values';

const SIGNED_AT = new Date('2026-09-18T23:30:00Z');
const adopted = { signatureImageKey: 'sig.png', initialsImageKey: 'ini.png' };

function field(id: string, type: SignerField['type'], required = true): SignerField {
  return { id, type, required, pageNumber: 1 };
}

const all = [
  field('sig', 'SIGNATURE'),
  field('ini', 'INITIALS'),
  field('date', 'DATE_SIGNED'),
  field('text', 'TEXT_INPUT'),
  field('box', 'CHECKBOX'),
];

describe('resolveFieldValues', () => {
  it('fills every field: images, the server date, text and the tick', () => {
    const result = resolveFieldValues(
      all,
      [
        { id: 'text', value: '  Clinic A  ' },
        { id: 'box', value: 'true' },
        { id: 'date', value: '1999-01-01' },
        { id: 'sig', value: 'data:image/png;base64,ignored' },
      ],
      adopted,
      SIGNED_AT,
    );
    expect(result).toEqual({
      ok: true,
      values: [
        { id: 'sig', value: 'sig.png', isCompleted: true },
        { id: 'ini', value: 'ini.png', isCompleted: true },
        // The server's date, whatever the browser sent.
        { id: 'date', value: '2026-09-18', isCompleted: true },
        { id: 'text', value: 'Clinic A', isCompleted: true },
        { id: 'box', value: 'true', isCompleted: true },
      ],
    });
  });

  it('lists every required field left empty', () => {
    const result = resolveFieldValues(
      all,
      [
        { id: 'text', value: '   ' },
        { id: 'box', value: 'false' },
      ],
      { signatureImageKey: null, initialsImageKey: 'ini.png' },
      SIGNED_AT,
    );
    expect(result).toEqual({ ok: false, problem: 'INCOMPLETE', fieldIds: ['sig', 'text', 'box'] });
  });

  it('fills optional fields only when the signer chose to', () => {
    const optional = [
      field('sig', 'SIGNATURE', false),
      field('text', 'TEXT_INPUT', false),
      field('box', 'CHECKBOX', false),
    ];
    const skipped = resolveFieldValues(optional, [], adopted, SIGNED_AT);
    expect(skipped).toEqual({
      ok: true,
      values: [
        { id: 'sig', value: null, isCompleted: false },
        { id: 'text', value: null, isCompleted: false },
        { id: 'box', value: null, isCompleted: false },
      ],
    });

    const chosen = resolveFieldValues(
      optional,
      [{ id: 'sig' }, { id: 'box', value: 'false' }],
      adopted,
      SIGNED_AT,
    );
    expect(chosen.ok && chosen.values.map((v) => v.value)).toEqual(['sig.png', null, 'false']);
  });

  it("refuses ids that are not the signer's own, or that repeat", () => {
    expect(resolveFieldValues(all, [{ id: 'someone-else' }], adopted, SIGNED_AT)).toEqual({
      ok: false,
      problem: 'UNKNOWN_FIELD',
      fieldIds: ['someone-else'],
    });
    expect(
      resolveFieldValues(
        all,
        [
          { id: 'text', value: 'a' },
          { id: 'text', value: 'b' },
        ],
        adopted,
        SIGNED_AT,
      ),
    ).toEqual({ ok: false, problem: 'DUPLICATE_FIELD', fieldIds: ['text'] });
  });
});
