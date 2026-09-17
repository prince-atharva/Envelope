import type { FieldInfo } from '@envelope/shared';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ApiError, api } from '../../lib/api';

export type SaveState = 'idle' | 'saving' | 'saved' | 'error' | 'conflict';

const DEBOUNCE_MS = 1000;

/**
 * Saves the field layout a moment after the last change.
 *
 * One request at a time: a save that starts while another is in flight waits,
 * so the server never receives two layouts out of order. The revision the
 * server returns is kept for the next request's `If-Match`, which is what turns
 * a second tab's edit into a visible conflict rather than silent data loss.
 */
export function useAutosave(
  envelopeId: string,
  revision: number,
  onSaved: (fields: FieldInfo[], revision: number) => void,
) {
  const [state, setState] = useState<SaveState>('idle');
  const revisionRef = useRef(revision);
  const pendingRef = useRef<FieldInfo[] | null>(null);
  const inFlightRef = useRef(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    revisionRef.current = revision;
  }, [revision]);

  const flush = useCallback(async () => {
    if (inFlightRef.current) return;
    const fields = pendingRef.current;
    if (!fields) return;

    pendingRef.current = null;
    inFlightRef.current = true;
    setState('saving');

    try {
      const result = await api.saveFields(envelopeId, fields, revisionRef.current);
      revisionRef.current = result.draftRevision;
      onSaved(result.fields, result.draftRevision);
      setState('saved');
    } catch (error) {
      // 412: someone else changed the draft. Anything we send now would
      // overwrite their work, so stop and let the page offer a reload.
      setState(
        error instanceof ApiError && error.code === 'DRAFT_REVISION_MISMATCH'
          ? 'conflict'
          : 'error',
      );
      pendingRef.current = fields;
    } finally {
      inFlightRef.current = false;
      if (pendingRef.current && state !== 'conflict') void flush();
    }
  }, [envelopeId, onSaved, state]);

  const save = useCallback(
    (fields: FieldInfo[]) => {
      pendingRef.current = fields;
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(() => void flush(), DEBOUNCE_MS);
    },
    [flush],
  );

  /** Sends straight away, for a Save button or before leaving the page. */
  const saveNow = useCallback(
    (fields: FieldInfo[]) => {
      pendingRef.current = fields;
      if (timerRef.current) clearTimeout(timerRef.current);
      return flush();
    },
    [flush],
  );

  useEffect(() => {
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, []);

  // Warns before the tab closes with a save still pending or failed.
  useEffect(() => {
    const unsaved = () => pendingRef.current !== null || state === 'error' || state === 'conflict';
    const handler = (event: BeforeUnloadEvent) => {
      if (!unsaved()) return;
      event.preventDefault();
    };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [state]);

  return { state, save, saveNow, revision: revisionRef };
}
