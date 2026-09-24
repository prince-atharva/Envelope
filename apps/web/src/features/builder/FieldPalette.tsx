import type { FieldType, RecipientInfo } from '@envelope/shared';
import { type ReactNode, useId } from 'react';
import { FIELD_LABEL, roleNoun } from '../../lib/labels';
import { recipientColor } from './recipient-colors';

interface FieldMeta {
  type: FieldType;
  hint: string;
  icon: ReactNode;
}

const FIELDS: FieldMeta[] = [
  {
    type: 'SIGNATURE',
    hint: 'Where the recipient signs',
    icon: (
      <svg
        className="h-4 w-4"
        fill="none"
        viewBox="0 0 24 24"
        stroke="currentColor"
        strokeWidth={2}
        aria-hidden="true"
      >
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          d="M16.862 4.487l1.687-1.688a1.875 1.875 0 112.652 2.652L10.582 16.07a4.5 4.5 0 01-1.897 1.13L6 18l.8-2.685a4.5 4.5 0 011.13-1.897l8.932-8.931zm0 0L19.5 7.125M18 14v4.75A2.25 2.25 0 0115.75 21H5.25A2.25 2.25 0 013 18.75V8.25A2.25 2.25 0 015.25 6H10"
        />
      </svg>
    ),
  },
  {
    type: 'INITIALS',
    hint: 'Short initial or mark',
    icon: (
      <svg
        className="h-4 w-4"
        fill="none"
        viewBox="0 0 24 24"
        stroke="currentColor"
        strokeWidth={2}
        aria-hidden="true"
      >
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          d="M7 20l4-16m2 16l4-16M6 9h14M4 15h14"
        />
      </svg>
    ),
  },
  {
    type: 'DATE_SIGNED',
    hint: 'Filled in automatically',
    icon: (
      <svg
        className="h-4 w-4"
        fill="none"
        viewBox="0 0 24 24"
        stroke="currentColor"
        strokeWidth={2}
        aria-hidden="true"
      >
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          d="M6.75 3v2.25M17.25 3v2.253M3 18.75V7.5a2.25 2.25 0 012.25-2.25h13.5A2.25 2.25 0 0121 7.5v11.25m-18 0A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75m-18 0v-7.5A2.25 2.25 0 015.25 9h13.5A2.25 2.25 0 0121 11.25v7.5m-9-6h.008v.008H12v-.008zM12 15h.008v.008H12V15zm0 2.25h.008v.008H12v-.008zM9.75 15h.008v.008H9.75V15zm0 2.25h.008v.008H9.75v-.008zM7.5 15h.008v.008H7.5V15zm0 2.25h.008v.008H7.5v-.008zm6.75-4.5h.008v.008h-.008v-.008zm0 2.25h.008v.008h-.008V15zm0 2.25h.008v.008h-.008v-.008zm2.25-4.5h.008v.008H16.5v-.008zm0 2.25h.008v.008H16.5V15z"
        />
      </svg>
    ),
  },
  {
    type: 'TEXT_INPUT',
    hint: 'Text the signer types in',
    icon: (
      <svg
        className="h-4 w-4"
        fill="none"
        viewBox="0 0 24 24"
        stroke="currentColor"
        strokeWidth={2}
        aria-hidden="true"
      >
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          d="M7.5 8.25h9m-9 3H12m-9.75 1.51c0 1.6 1.123 2.994 2.707 3.227 1.129.166 2.27.293 3.423.379.35.026.67.21.865.501L12 21l2.755-4.133a1.14 1.14 0 01.865-.501 48.172 48.172 0 003.423-.379c1.584-.233 2.707-1.626 2.707-3.228V6.741c0-1.602-1.123-2.995-2.707-3.228A48.394 48.394 0 0012 3c-2.392 0-4.744.175-7.043.513C3.373 3.746 2.25 5.14 2.25 6.741v6.018z"
        />
      </svg>
    ),
  },
  {
    type: 'CHECKBOX',
    hint: 'Confirmation or opt-in',
    icon: (
      <svg
        className="h-4 w-4"
        fill="none"
        viewBox="0 0 24 24"
        stroke="currentColor"
        strokeWidth={2}
        aria-hidden="true"
      >
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          d="M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
        />
      </svg>
    ),
  },
];

interface FieldPaletteProps {
  armed: FieldType | null;
  onArm: (type: FieldType | null) => void;
  disabled: boolean;
  recipients?: RecipientInfo[];
  activeRecipientId?: string | null;
  onSelectRecipient?: (id: string) => void;
}

/**
 * The field types that can be placed, and whose they will be.
 *
 * Choosing a type arms it; the next click on a page drops it there. That works
 * with a mouse, a finger and a keyboard alike, which dragging from this list
 * would not: doc 09 asks for a drag, but a drag on its own would leave keyboard
 * users unable to place a field at all.
 */
export function FieldPalette({
  armed,
  onArm,
  disabled,
  recipients = [],
  activeRecipientId,
  onSelectRecipient,
}: FieldPaletteProps) {
  const headingId = useId();
  const activeRecipient = recipients.find((r) => r.id === activeRecipientId);
  const color = activeRecipient ? recipientColor(activeRecipient.colorIndex) : null;

  return (
    <section aria-labelledby={headingId} className="space-y-3.5">
      {/* Whose fields the next placements are */}
      {recipients.length > 0 && onSelectRecipient && (
        <div className="rounded-xl border border-slate-200/90 bg-slate-50/70 p-3 space-y-1.5 shadow-2xs">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold uppercase tracking-wider text-slate-500">
              Assign fields to
            </span>
            {color && (
              <span
                className={`text-xs font-semibold text-white px-2 py-0.5 rounded-full ${color.swatch}`}
              >
                {activeRecipient?.name}
              </span>
            )}
          </div>

          {recipients.length === 1 ? (
            <div className="flex items-center gap-2 p-1.5 rounded-lg bg-white border border-slate-200 text-xs">
              {color && <span className={`h-2.5 w-2.5 rounded-full shrink-0 ${color.swatch}`} />}
              <span className="font-semibold text-slate-800 truncate">{activeRecipient?.name}</span>
              <span className="text-xs text-slate-400 truncate">({activeRecipient?.email})</span>
            </div>
          ) : (
            <div className="relative">
              <select
                aria-label="Assign fields to recipient"
                value={activeRecipientId ?? ''}
                onChange={(e) => onSelectRecipient(e.target.value)}
                className="w-full appearance-none rounded-lg border border-slate-300 bg-white py-1.5 pl-3 pr-8 text-xs font-semibold text-slate-800 shadow-2xs focus:border-brand-600 focus:outline-none focus:ring-1 focus:ring-brand-600 cursor-pointer"
              >
                {recipients.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.name} ({roleNoun(r.role)})
                  </option>
                ))}
              </select>
              <div className="pointer-events-none absolute inset-y-0 right-0 flex items-center pr-2.5 text-slate-400">
                <svg
                  className="h-3.5 w-3.5"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                  strokeWidth={2}
                  aria-hidden="true"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d="M19.5 8.25l-7.5 7.5-7.5-7.5"
                  />
                </svg>
              </div>
            </div>
          )}
        </div>
      )}

      <div className="space-y-1">
        <div className="flex items-center justify-between">
          <h2 id={headingId} className="text-xs font-bold uppercase tracking-wider text-slate-700">
            Fields
          </h2>
          {armed && (
            <span className="inline-flex items-center gap-1 text-xs font-semibold text-brand-700 bg-brand-50 px-2 py-0.5 whitespace-nowrap rounded-full border border-brand-200/80 animate-pulse">
              <span className="h-1.5 w-1.5 rounded-full bg-brand-600" />
              Click page to place
            </span>
          )}
        </div>
        {disabled ? (
          <p className="text-xs text-slate-500">
            Add at least one signer before placing fields on the document.
          </p>
        ) : (
          <p className="text-xs text-slate-500">
            Select a field type, then click anywhere on the page to place it.
          </p>
        )}
      </div>

      <ul className="space-y-1.5">
        {FIELDS.map((field) => {
          const isArmed = armed === field.type;
          return (
            <li key={field.type}>
              <button
                type="button"
                disabled={disabled}
                aria-pressed={isArmed}
                aria-label={FIELD_LABEL[field.type]}
                onClick={() => onArm(isArmed ? null : field.type)}
                className={`group flex w-full items-center gap-3 rounded-xl border p-2.5 text-left transition-all cursor-pointer disabled:cursor-not-allowed disabled:opacity-50 ${
                  isArmed
                    ? 'border-brand-600 bg-brand-50/80 ring-2 ring-brand-600/30 shadow-xs'
                    : 'border-slate-200/90 bg-white hover:border-slate-300 hover:bg-slate-50/80 shadow-2xs'
                }`}
              >
                <div
                  className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg transition-colors ${
                    isArmed
                      ? 'bg-brand-600 text-white'
                      : 'bg-slate-100 text-slate-600 group-hover:bg-slate-200 group-hover:text-slate-900'
                  }`}
                >
                  {field.icon}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center justify-between">
                    <span className="truncate text-xs font-bold text-slate-800">
                      {FIELD_LABEL[field.type]}
                    </span>
                    {isArmed && <span className="text-xs font-semibold text-brand-700">Armed</span>}
                  </div>
                  <span className="block truncate text-xs text-slate-500">{field.hint}</span>
                </div>
              </button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
