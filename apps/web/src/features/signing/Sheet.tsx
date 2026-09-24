import { type ReactNode, useEffect, useRef } from 'react';

/**
 * A modal panel that slides up from the bottom on a phone, where a thumb can
 * reach it, and sits in the middle of larger screens (docs/09, "Signing on a
 * Phone"). A native <dialog>: focus is trapped, Escape closes it, and the rest
 * of the page is inert while it is open.
 *
 * The contents are mounted only while it is open, so each opening starts
 * fresh and nothing inside (a drawing canvas, say) measures itself while
 * hidden.
 */
export function Sheet({
  open,
  onClose,
  labelledBy,
  className = 'sm:max-w-lg',
  children,
}: {
  open: boolean;
  onClose: () => void;
  labelledBy: string;
  className?: string;
  children: ReactNode;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    else if (!open && dialog.open) dialog.close();
  }, [open]);

  return (
    <dialog
      ref={dialogRef}
      aria-labelledby={labelledBy}
      onClose={onClose}
      className={`signing-sheet mx-0 mt-auto mb-0 max-h-[92dvh] w-full max-w-full overflow-y-auto rounded-t-2xl bg-white p-0 shadow-xl backdrop:bg-slate-900/50 sm:m-auto sm:rounded-2xl ${className}`}
    >
      {open && children}
    </dialog>
  );
}

/** Buttons along the bottom of a sheet, clear of the iPhone home indicator. */
export function SheetActions({ children }: { children: ReactNode }) {
  return (
    <div className="flex flex-col-reverse gap-2 border-t border-slate-200 px-5 pt-4 pb-[max(1rem,env(safe-area-inset-bottom))] sm:flex-row sm:justify-end">
      {children}
    </div>
  );
}
