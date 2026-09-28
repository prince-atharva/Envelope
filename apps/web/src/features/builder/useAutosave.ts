import type { FieldInfo } from '@envelope/shared';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ApiError } from '../../lib/api';
import { useEditorRuntime } from '../embed/editor-runtime';

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
  const runtime = useEditorRuntime();
  const api = runtime.api;
  const [state, setState] = useState<SaveState>('idle');
  const revisionRef = useRef(revision);
  const pendingRef = useRef<FieldInfo[] | null>(null);
  const inFlightRef = useRef<Promise<boolean> | null>(null);
  const mountedRef = useRef(true);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    revisionRef.current = revision;
  }, [revision]);

  const flush = useCallback(async (): Promise<boolean> => {
    if (inFlightRef.current !== null) {
      if (!(await inFlightRef.current)) return false;
    }
    if (!pendingRef.current) return true;
    const run = async () => {
      while (pendingRef.current && mountedRef.current) {
        const fields = pendingRef.current;
        pendingRef.current = null;
        setState('saving');
        try {
          const result = await api.saveFields(envelopeId, fields, revisionRef.current);
          revisionRef.current = result.draftRevision;
          if (!mountedRef.current) return false;
          if (pendingRef.current === null) onSaved(result.fields, result.draftRevision);
          runtime.saved?.(envelopeId, result.draftRevision);
          setState('saved');
        } catch (error) {
          pendingRef.current ??= fields;
          if (mountedRef.current)
            setState(
              error instanceof ApiError && error.code === 'DRAFT_REVISION_MISMATCH'
                ? 'conflict'
                : 'error',
            );
          return false;
        }
      }
      return mountedRef.current;
    };
    const task = run();
    inFlightRef.current = task;
    try {
      return await task;
    } finally {
      if (inFlightRef.current === task) inFlightRef.current = null;
    }
  }, [api, envelopeId, onSaved, runtime]);

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
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
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
