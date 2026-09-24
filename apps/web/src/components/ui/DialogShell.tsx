import { type FormEvent, type ReactNode, useEffect, useId, useRef } from 'react';

export interface DialogShellProps {
  open: boolean;
  onClose: () => void;
  /** Shown as the dialog's heading and used as its accessible name. */
  title: ReactNode;
  /** Runs once each time the dialog opens: clear inputs, reset a mutation. */
  onOpen?: () => void;
  /** Submitting the form. Given one, the body is wrapped in a <form>. */
  onSubmit?: () => void;
  /** Buttons for the footer row, in reading order. */
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
}

/**
 * One modal shell for the whole sender app.
 *
 * Cancel, Extend and Send each carried a byte-identical <dialog> and an
 * identical showModal/close effect. A native <dialog> is what makes the focus
 * trap, the inert page behind and Escape-to-close work without a line of our
 * own code, so everything modal goes through here rather than a positioned div.
 *
 * `noValidate` is deliberate: the dialogs show their own messages next to the
 * field rather than a browser bubble that screen readers handle inconsistently.
 */
export function DialogShell({
  open,
  onClose,
  title,
  onOpen,
  onSubmit,
  actions,
  children,
  className = '',
}: DialogShellProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  // Kept in a ref so a caller passing an inline arrow does not re-run the
  // effect on every render and reset the form under the reader's hands.
  const onOpenRef = useRef(onOpen);
  onOpenRef.current = onOpen;

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (open && !dialog.open) {
      onOpenRef.current?.();
      dialog.showModal();
    } else if (!open && dialog.open) {
      dialog.close();
    }
  }, [open]);

  function handleSubmit(event: FormEvent) {
    event.preventDefault();
    onSubmit?.();
  }

  const body = (
    <>
      <h2 id={titleId} className="text-lg font-semibold text-slate-900">
        {title}
      </h2>
      {children}
      {/* Phones stack the buttons full width, main action on top; wider
          screens put them in a row on the right. */}
      {actions && (
        <div className="flex flex-col-reverse gap-2 pt-1 sm:flex-row sm:flex-wrap sm:justify-end">
          {actions}
        </div>
      )}
    </>
  );

  return (
    <dialog
      ref={dialogRef}
      aria-labelledby={titleId}
      onClose={onClose}
      className={`m-auto w-[calc(100%-2rem)] max-w-lg rounded-2xl bg-white p-0 shadow-xl backdrop:bg-slate-900/40 ${className}`}
    >
      {onSubmit ? (
        <form method="dialog" noValidate className="space-y-4 p-6" onSubmit={handleSubmit}>
          {body}
        </form>
      ) : (
        <div className="space-y-4 p-6">{body}</div>
      )}
    </dialog>
  );
}
