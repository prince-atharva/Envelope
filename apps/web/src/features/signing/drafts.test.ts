import type { SigningField } from '@envelope/shared';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  clearDraft,
  draftKey,
  loadAdoptedImages,
  loadDraft,
  pruneDrafts,
  saveAdoptedImage,
  saveDraft,
} from './drafts';
import { SIGNED_MARK } from './signing-state';

const DAY = 24 * 3600 * 1000;
const NOW = Date.UTC(2026, 8, 18);

function field(id: string, type: SigningField['type']): SigningField {
  return {
    id,
    type,
    pageNumber: 1,
    required: true,
    ratioX: 0,
    ratioY: 0,
    ratioWidth: 0.1,
    ratioHeight: 0.1,
  };
}

const sign = field('b-sign', 'SIGNATURE');
const tick = field('c-tick', 'CHECKBOX');
const text = field('a-text', 'TEXT_INPUT');
const date = field('d-date', 'DATE_SIGNED');
const fields = [sign, tick, text, date];

afterEach(() => {
  localStorage.clear();
  sessionStorage.clear();
  vi.restoreAllMocks();
});

describe('draftKey', () => {
  it('is the lowest field id, whatever order the fields come in', () => {
    expect(draftKey(fields)).toBe('a-text');
    expect(draftKey([...fields].reverse())).toBe('a-text');
  });

  it('is null for someone with no fields', () => {
    expect(draftKey([])).toBeNull();
  });
});

describe('saving and restoring', () => {
  it('restores what was saved', () => {
    const values = { [sign.id]: SIGNED_MARK, [tick.id]: 'true', [text.id]: 'Acme' };
    saveDraft('a-text', values, NOW);
    expect(loadDraft('a-text', fields, NOW + DAY)).toEqual(values);
  });

  it('never stores anything that looks like a signing link or token', () => {
    saveDraft('a-text', { [text.id]: 'Acme' }, NOW);
    const stored = Object.keys(localStorage).join(' ');
    expect(stored).not.toMatch(/sign\/|[0-9a-f]{64}/);
  });

  it('drops values that no longer fit their field, and fields that are not the signer’s', () => {
    localStorage.setItem(
      'envelope.signing-draft.a-text',
      JSON.stringify({
        savedAt: NOW,
        values: {
          [sign.id]: 'data:image/png;base64,AAAA',
          [tick.id]: 'yes',
          [text.id]: 'x'.repeat(501),
          [date.id]: '2020-01-01',
          'someone-else': 'true',
        },
      }),
    );
    expect(loadDraft('a-text', fields, NOW)).toEqual({});
  });

  it('ignores a draft older than any link can live', () => {
    saveDraft('a-text', { [text.id]: 'Acme' }, NOW);
    expect(loadDraft('a-text', fields, NOW + 91 * DAY)).toEqual({});
  });

  it('ignores something unreadable rather than failing', () => {
    localStorage.setItem('envelope.signing-draft.a-text', '{not json');
    expect(loadDraft('a-text', fields, NOW)).toEqual({});
  });

  it('removes the draft when everything has been cleared', () => {
    saveDraft('a-text', { [text.id]: 'Acme' }, NOW);
    saveDraft('a-text', {}, NOW);
    expect(localStorage.getItem('envelope.signing-draft.a-text')).toBeNull();
  });

  it('keeps working when storage refuses to save', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('Quota exceeded', 'QuotaExceededError');
    });
    expect(() => saveDraft('a-text', { [text.id]: 'Acme' }, NOW)).not.toThrow();
    expect(() =>
      saveAdoptedImage('a-text', 'SIGNATURE', 'data:image/png;base64,AA=='),
    ).not.toThrow();
  });
});

describe('adopted images', () => {
  it('keeps PNG data URLs for this tab only, and ignores anything else', () => {
    saveAdoptedImage('a-text', 'SIGNATURE', 'data:image/png;base64,AA==');
    sessionStorage.setItem('envelope.signing-adopted.a-text.INITIALS', 'javascript:alert(1)');
    expect(loadAdoptedImages('a-text')).toEqual({ SIGNATURE: 'data:image/png;base64,AA==' });
    expect(localStorage.length).toBe(0);
  });
});

describe('clearDraft', () => {
  it('forgets the values and the adopted images', () => {
    saveDraft('a-text', { [text.id]: 'Acme' }, NOW);
    saveAdoptedImage('a-text', 'SIGNATURE', 'data:image/png;base64,AA==');
    clearDraft('a-text');
    expect(loadDraft('a-text', fields, NOW)).toEqual({});
    expect(loadAdoptedImages('a-text')).toEqual({});
  });
});

describe('pruneDrafts', () => {
  it('removes old and unreadable drafts and leaves everything else alone', () => {
    saveDraft('old', { x: 'true' }, NOW - 100 * DAY);
    saveDraft('fresh', { x: 'true' }, NOW - DAY);
    localStorage.setItem('envelope.signing-draft.broken', 'nope');
    localStorage.setItem('unrelated', 'keep me');

    pruneDrafts(NOW);

    expect(Object.keys(localStorage).sort()).toEqual(['envelope.signing-draft.fresh', 'unrelated']);
  });
});
