import {
  MAX_EXPIRY_DAYS,
  MAX_TEXT_VALUE_LENGTH,
  PNG_DATA_URL_PREFIX,
  type SignatureKind,
  type SigningField,
} from '@envelope/shared';
import { type FieldValues, SIGNED_MARK } from './signing-state';

/**
 * Work in progress on a signing page, kept on this device until it is sent
 * (docs/09, "Offline resilience"). A signer who loses signal or reloads the
 * page comes back to what they had filled in.
 *
 * Keyed by the signer's first field id rather than by the link, for two
 * reasons: the token must never be written anywhere (docs/10), and a reminder
 * sends a new link, which should still find the draft. A field id belongs to
 * exactly one signer on one envelope, so it names this signer's work and
 * nobody else's.
 *
 * Every storage call is guarded. Private browsing on iOS, a full quota or
 * storage turned off must never stop someone from signing; they only lose the
 * draft.
 */

const DRAFT_PREFIX = 'envelope.signing-draft.';
const ADOPTED_PREFIX = 'envelope.signing-adopted.';
/** No link lives longer than this, so no draft needs to either. */
const MAX_DRAFT_AGE_MS = MAX_EXPIRY_DAYS * 24 * 3600 * 1000;

interface StoredDraft {
  savedAt: number;
  values: Record<string, string>;
}

/** The storage key for this signer's draft, or null if they have no fields. */
export function draftKey(fields: readonly SigningField[]): string | null {
  const first = fields.map((field) => field.id).sort()[0];
  return first === undefined ? null : first;
}

function isStoredDraft(value: unknown): value is StoredDraft {
  if (typeof value !== 'object' || value === null) return false;
  const draft = value as Partial<StoredDraft>;
  return (
    typeof draft.savedAt === 'number' &&
    typeof draft.values === 'object' &&
    draft.values !== null &&
    Object.values(draft.values).every((entry) => typeof entry === 'string')
  );
}

/** Whether a stored value still fits its field. Anything else is dropped, not trusted. */
function fits(field: SigningField, value: string): boolean {
  switch (field.type) {
    case 'SIGNATURE':
    case 'INITIALS':
      return value === SIGNED_MARK;
    case 'CHECKBOX':
      return value === 'true' || value === 'false';
    case 'TEXT_INPUT':
      return value.length <= MAX_TEXT_VALUE_LENGTH;
    case 'DATE_SIGNED':
      return false;
  }
}

function readJson(storage: Storage, key: string): unknown {
  try {
    const raw = storage.getItem(key);
    return raw === null ? null : (JSON.parse(raw) as unknown);
  } catch {
    return null;
  }
}

/** The saved values for these fields, or an empty object if there is no usable draft. */
export function loadDraft(
  key: string,
  fields: readonly SigningField[],
  now = Date.now(),
): Record<string, string> {
  const stored = readJson(localStorage, DRAFT_PREFIX + key);
  if (!isStoredDraft(stored) || now - stored.savedAt > MAX_DRAFT_AGE_MS) return {};
  const values: Record<string, string> = {};
  for (const field of fields) {
    const value = stored.values[field.id];
    if (value !== undefined && fits(field, value)) values[field.id] = value;
  }
  return values;
}

export function saveDraft(key: string, values: FieldValues, now = Date.now()): void {
  try {
    if (Object.keys(values).length === 0) {
      localStorage.removeItem(DRAFT_PREFIX + key);
      return;
    }
    const draft: StoredDraft = { savedAt: now, values: { ...values } };
    localStorage.setItem(DRAFT_PREFIX + key, JSON.stringify(draft));
  } catch {
    // Full or unavailable: signing still works, only the draft is lost.
  }
}

/** Forgets the draft and the adopted images: after Finish or Decline, or when the link is dead. */
export function clearDraft(key: string): void {
  try {
    localStorage.removeItem(DRAFT_PREFIX + key);
    for (const kind of ['SIGNATURE', 'INITIALS'] as const) {
      sessionStorage.removeItem(`${ADOPTED_PREFIX}${key}.${kind}`);
    }
  } catch {
    // Nothing to do: storage is unavailable, so nothing was saved either.
  }
}

/** Removes drafts older than any link can live, so abandoned ones do not pile up. */
export function pruneDrafts(now = Date.now()): void {
  try {
    const stale: string[] = [];
    for (let index = 0; index < localStorage.length; index += 1) {
      const key = localStorage.key(index);
      if (!key?.startsWith(DRAFT_PREFIX)) continue;
      const stored = readJson(localStorage, key);
      if (!isStoredDraft(stored) || now - stored.savedAt > MAX_DRAFT_AGE_MS) stale.push(key);
    }
    for (const key of stale) localStorage.removeItem(key);
  } catch {
    // Storage unavailable: there is nothing to prune.
  }
}

/**
 * The adopted signature and initials, as images, for showing in the boxes.
 *
 * The server keeps the real ones; these copies only let a reload in the same
 * tab show them again. Session storage, so they go when the tab closes
 * (docs/09, "Signature capture").
 */
export function loadAdoptedImages(key: string): Partial<Record<SignatureKind, string>> {
  const images: Partial<Record<SignatureKind, string>> = {};
  try {
    for (const kind of ['SIGNATURE', 'INITIALS'] as const) {
      const image = sessionStorage.getItem(`${ADOPTED_PREFIX}${key}.${kind}`);
      if (image?.startsWith(PNG_DATA_URL_PREFIX)) images[kind] = image;
    }
  } catch {
    // Unavailable: the boxes show a plain "Signed" instead of the image.
  }
  return images;
}

export function saveAdoptedImage(key: string, kind: SignatureKind, image: string): void {
  try {
    sessionStorage.setItem(`${ADOPTED_PREFIX}${key}.${kind}`, image);
  } catch {
    // Too large for what is left of the quota, or unavailable. Only the preview is lost.
  }
}
