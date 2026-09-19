import { describe, expect, it } from 'vitest';
import { downloadName } from './document-files';

describe('downloadName', () => {
  it('keeps the original name for the original', () => {
    expect(downloadName('Lease.pdf', { versionNumber: 0, isFinal: false })).toBe('Lease.pdf');
  });

  it('marks the sealed document as signed, as the completion email does', () => {
    expect(downloadName('Lease.PDF', { versionNumber: 3, isFinal: true })).toBe(
      'Lease (signed).pdf',
    );
  });

  it('numbers a copy made during signing', () => {
    expect(downloadName('Lease.pdf', { versionNumber: 2, isFinal: false })).toBe('Lease (v2).pdf');
    expect(downloadName('.pdf', { versionNumber: 1, isFinal: false })).toBe('document (v1).pdf');
  });
});
