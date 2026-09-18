import { MAX_TEXT_VALUE_LENGTH, type SigningField } from '@envelope/shared';
import { useId, useState } from 'react';
import { Button } from '../../components/ui/Button';
import { Sheet, SheetActions } from './Sheet';

/**
 * Filling in a text box.
 *
 * Typed into a full-size input here rather than into the box on the page: on a
 * phone the box is often a dozen pixels tall, and iOS zooms the whole page in
 * on any input with text smaller than 16px.
 */
export function TextSheet({
  field,
  value,
  pageCount,
  onSave,
  onClose,
}: {
  /** The field being edited; the sheet is open while there is one. */
  field: SigningField | null;
  value: string;
  pageCount: number;
  onSave: (value: string) => void;
  onClose: () => void;
}) {
  const titleId = useId();
  return (
    <Sheet open={field !== null} onClose={onClose} labelledBy={titleId}>
      {field && (
        <TextForm
          titleId={titleId}
          field={field}
          initial={value}
          pageCount={pageCount}
          onSave={onSave}
          onClose={onClose}
        />
      )}
    </Sheet>
  );
}

function TextForm({
  titleId,
  field,
  initial,
  pageCount,
  onSave,
  onClose,
}: {
  titleId: string;
  field: SigningField;
  initial: string;
  pageCount: number;
  onSave: (value: string) => void;
  onClose: () => void;
}) {
  const inputId = useId();
  const hintId = useId();
  const [text, setText] = useState(initial);
  const [missing, setMissing] = useState(false);

  return (
    <form
      noValidate
      onSubmit={(event) => {
        event.preventDefault();
        if (field.required && text.trim().length === 0) {
          setMissing(true);
          return;
        }
        onSave(text);
      }}
    >
      <div className="space-y-4 px-5 pt-5 pb-4">
        <h2 id={titleId} className="text-lg font-semibold text-slate-900">
          Fill in this box
        </h2>
        <div>
          <label htmlFor={inputId} className="block text-sm font-medium text-slate-800">
            Text for the box on page {field.pageNumber} of {pageCount}
          </label>
          <input
            id={inputId}
            value={text}
            onChange={(event) => {
              setText(event.target.value);
              if (event.target.value.trim()) setMissing(false);
            }}
            maxLength={MAX_TEXT_VALUE_LENGTH}
            required={field.required}
            aria-invalid={missing || undefined}
            aria-describedby={hintId}
            // biome-ignore lint/a11y/noAutofocus: the sheet opens because the signer asked to type here
            autoFocus
            className={`mt-1.5 block w-full rounded-lg border bg-white px-3 py-2.5 text-base text-slate-900 shadow-sm focus:border-brand-600 focus:ring-2 focus:ring-brand-600/30 focus:outline-none ${
              missing ? 'border-red-400' : 'border-slate-300'
            }`}
          />
          <p
            id={hintId}
            className={`mt-1.5 text-xs ${missing ? 'text-red-700' : 'text-slate-500'}`}
          >
            {missing
              ? 'This box is required.'
              : field.required
                ? 'Required.'
                : 'Optional. Leave it empty if it does not apply.'}
          </p>
        </div>
      </div>
      <SheetActions>
        <Button variant="secondary" onClick={onClose}>
          Cancel
        </Button>
        <Button type="submit">Save</Button>
      </SheetActions>
    </form>
  );
}
