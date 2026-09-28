import type { FieldInfo } from '@envelope/shared';
import { act, cleanup, renderHook } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '../../lib/api';
import { EditorRuntimeContext } from '../embed/editor-runtime';
import { useAutosave } from './useAutosave';

afterEach(cleanup);
const fields = [{ id: 'field' }] as FieldInfo[];
function setup(saveFields: ReturnType<typeof vi.fn>) {
  const saved = vi.fn();
  const wrapper = ({ children }: { children: ReactNode }) => (
    <EditorRuntimeContext.Provider
      value={{
        api: { saveFields } as never,
        embedded: true,
        canSend: true,
        detail: () => '',
        prepare: () => '',
        review: () => '',
      }}
    >
      {children}
    </EditorRuntimeContext.Provider>
  );
  return { ...renderHook(() => useAutosave('envelope', 0, saved), { wrapper }), saved };
}
describe('editor save drain', () => {
  it('waits for the in-flight save and then persists the latest layout', async () => {
    let resolve!: (value: unknown) => void;
    const save = vi
      .fn()
      .mockImplementationOnce(
        () =>
          new Promise((r) => {
            resolve = r;
          }),
      )
      .mockResolvedValueOnce({ fields, draftRevision: 2 });
    const { result, saved } = setup(save);
    let first!: Promise<boolean>;
    let second!: Promise<boolean>;
    act(() => {
      first = result.current.saveNow(fields);
    });
    const latest = [{ id: 'latest' }] as FieldInfo[];
    act(() => {
      second = result.current.saveNow(latest);
    });
    expect(save).toHaveBeenCalledTimes(1);
    await act(async () => {
      resolve({ fields, draftRevision: 1 });
      await first;
      await second;
    });
    expect(save).toHaveBeenCalledTimes(2);
    expect(save.mock.calls[1]).toEqual(['envelope', latest, 1]);
    expect(saved).toHaveBeenCalledTimes(1);
  });
  it('stops on stale revisions instead of automatically retrying', async () => {
    const save = vi
      .fn()
      .mockRejectedValue(
        new ApiError({ status: 412, code: 'DRAFT_REVISION_MISMATCH', title: 'Changed' }),
      );
    const { result, saved } = setup(save);
    await act(async () => {
      expect(await result.current.saveNow(fields)).toBe(false);
    });
    expect(result.current.state).toBe('conflict');
    expect(save).toHaveBeenCalledOnce();
    expect(saved).not.toHaveBeenCalled();
  });
});
