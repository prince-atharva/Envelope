import type { ReactNode } from 'react';
import { Button } from './Button';
import { DialogShell } from './DialogShell';

export interface Confirmation {
  title: string;
  body: ReactNode;
  /** Label for the button that goes ahead. */
  confirmLabel: string;
  destructive?: boolean;
  onConfirm: () => void;
}

/**
 * A confirmation the product owns, rather than `window.confirm`.
 *
 * The native one cannot be styled, cannot carry the recipient's colour or field
 * count, reads as "localhost says" in Chrome, and blocks the page thread. This
 * takes a `pending` object so a caller can stash "what the person was about to
 * do" and clear it either way.
 */
export function ConfirmDialog({
  pending,
  onCancel,
}: {
  pending: Confirmation | null;
  onCancel: () => void;
}) {
  return (
    <DialogShell
      open={pending !== null}
      onClose={onCancel}
      title={pending?.title ?? ''}
      actions={
        <>
          <Button variant="secondary" size="sm" onClick={onCancel}>
            Keep as it is
          </Button>
          <Button
            variant={pending?.destructive ? 'danger' : 'primary'}
            size="sm"
            onClick={() => {
              pending?.onConfirm();
              onCancel();
            }}
          >
            {pending?.confirmLabel ?? 'Continue'}
          </Button>
        </>
      }
    >
      <div className="text-sm text-slate-600">{pending?.body}</div>
    </DialogShell>
  );
}
