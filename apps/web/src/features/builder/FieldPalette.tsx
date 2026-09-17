import type { FieldType } from '@envelope/shared';

const FIELDS: { type: FieldType; label: string; hint: string }[] = [
  { type: 'SIGNATURE', label: 'Signature', hint: 'Where they sign' },
  { type: 'INITIALS', label: 'Initials', hint: 'Short mark, often per page' },
  { type: 'DATE_SIGNED', label: 'Date', hint: 'Filled in automatically' },
  { type: 'TEXT_INPUT', label: 'Text', hint: 'They type something' },
  { type: 'CHECKBOX', label: 'Tick box', hint: 'Agree or confirm' },
];

interface FieldPaletteProps {
  armed: FieldType | null;
  onArm: (type: FieldType | null) => void;
  disabled: boolean;
}

/**
 * The field types that can be placed.
 *
 * Choosing a type arms it; the next click on a page drops it there. That works
 * with a mouse, a finger and a keyboard alike, which dragging from this list
 * would not: doc 09 asks for a drag, but a drag on its own would leave keyboard
 * users unable to place a field at all.
 */
export function FieldPalette({ armed, onArm, disabled }: FieldPaletteProps) {
  return (
    <section aria-labelledby="palette-heading" className="space-y-2">
      <h2
        id="palette-heading"
        className="text-xs font-semibold uppercase tracking-wide text-slate-500"
      >
        Fields
      </h2>
      {disabled ? (
        <p className="text-sm text-slate-500">Add someone first, then place their fields.</p>
      ) : (
        <p className="text-xs text-slate-500">Pick a field, then click the page where it goes.</p>
      )}
      <ul className="space-y-1.5">
        {FIELDS.map((field) => {
          const isArmed = armed === field.type;
          return (
            <li key={field.type}>
              <button
                type="button"
                disabled={disabled}
                aria-pressed={isArmed}
                onClick={() => onArm(isArmed ? null : field.type)}
                className={`flex w-full flex-col rounded-lg border px-3 py-2 text-left transition disabled:cursor-not-allowed disabled:opacity-50 ${
                  isArmed
                    ? 'border-brand-700 bg-brand-50 ring-1 ring-brand-700'
                    : 'border-slate-200 bg-white hover:border-slate-300 hover:bg-slate-50'
                }`}
              >
                <span className="text-sm font-medium text-slate-900">{field.label}</span>
                <span className="text-xs text-slate-500">{field.hint}</span>
              </button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
