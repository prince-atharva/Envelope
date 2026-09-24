import type { SignatureKind, SigningField } from '@envelope/shared';
import type { CSSProperties, ReactNode } from 'react';
import type { PageRenderInfo } from '../../components/pdf/PdfViewer';
import { CheckIcon } from '../../components/ui/icons';
import {
  type Adopted,
  type FieldValues,
  fieldAccessibleName,
  isFilled,
  SIGNED_MARK,
} from './signing-state';

interface SigningFieldLayerProps {
  page: PageRenderInfo;
  /** This page's fields only. */
  fields: readonly SigningField[];
  pageCount: number;
  values: FieldValues;
  adopted: Adopted;
  images: Partial<Record<SignatureKind, string>>;
  /** The field Next last brought into view. */
  currentId: string | null;
  /** Required fields the server said were still empty. */
  missing: ReadonlySet<string>;
  /** Today's date as it will appear, for DATE_SIGNED boxes. */
  today: string;
  onActivate: (field: SigningField) => void;
}

/** Text inside a box scales with the box, within readable limits. */
function fontSizeFor(heightPx: number): number {
  return Math.min(16, Math.max(9, heightPx * 0.5));
}

/**
 * The signer's own boxes over one page (docs/09). Positions are the stored
 * ratios as percentages of the page, so they follow every zoom level without
 * any arithmetic here.
 *
 * Every box is a real button, so the whole document can be signed from a
 * keyboard, and each is named the way docs/09 asks: "Signature field,
 * required, page 4 of 12". Colour is never the only cue: an empty required box
 * also says what to do in words.
 */
export function SigningFieldLayer({
  page,
  fields,
  pageCount,
  values,
  adopted,
  images,
  currentId,
  missing,
  today,
  onActivate,
}: SigningFieldLayerProps) {
  return (
    <>
      {fields.map((field) => {
        const filled = isFilled(field, values, adopted);
        const heightPx = field.ratioHeight * page.cssHeight;
        const style: CSSProperties = {
          left: `${field.ratioX * 100}%`,
          top: `${field.ratioY * 100}%`,
          width: `${field.ratioWidth * 100}%`,
          height: `${field.ratioHeight * 100}%`,
          fontSize: `${fontSizeFor(heightPx)}px`,
        };
        const name = fieldAccessibleName(field, pageCount);

        if (field.type === 'DATE_SIGNED') {
          return (
            <div
              key={field.id}
              role="img"
              aria-label={`${name}, filled in automatically: ${today}`}
              data-signing-field={field.id}
              className="absolute flex items-center overflow-hidden rounded-sm border border-slate-300/80 bg-slate-50/70 px-1 leading-none whitespace-nowrap text-slate-800"
              style={style}
            >
              {today}
            </div>
          );
        }

        const state = filled
          ? 'border border-emerald-600/70 bg-emerald-50/40 text-emerald-900 shadow-2xs'
          : missing.has(field.id)
            ? 'border-2 border-red-600 bg-red-100/90 text-red-900 shadow-xs'
            : field.required
              ? 'border-2 border-amber-500 bg-amber-100/90 text-amber-950 shadow-xs hover:border-amber-600'
              : 'border-2 border-dashed border-sky-600 bg-sky-50/80 text-sky-950 hover:border-sky-700';
        // Thin, and outside the box: a tick box on a phone is only a few
        // pixels wide, and a thick ring would cover it.
        const current =
          field.id === currentId ? 'ring-2 ring-brand-600 ring-offset-2 ring-offset-white' : '';
        const className = `absolute flex items-center justify-center overflow-visible rounded-sm leading-none transition-colors before:absolute before:top-1/2 before:left-1/2 before:h-[max(100%,44px)] before:w-[max(100%,44px)] before:-translate-x-1/2 before:-translate-y-1/2 before:content-[''] hover:brightness-95 focus-visible:outline-3 focus-visible:outline-offset-1 focus-visible:outline-brand-700 ${state} ${current}`;

        if (field.type === 'CHECKBOX') {
          const checked = values[field.id] === 'true';
          // A real checkbox, filling the box; the label around it carries the
          // look and the 44px touch area.
          return (
            <label key={field.id} className={`${className} cursor-pointer`} style={style}>
              <input
                type="checkbox"
                checked={checked}
                onChange={() => onActivate(field)}
                aria-label={name}
                data-signing-field={field.id}
                className="absolute inset-0 h-full w-full cursor-pointer appearance-none rounded-sm focus-visible:outline-3 focus-visible:outline-offset-1 focus-visible:outline-brand-700"
              />
              {checked && <Tick />}
            </label>
          );
        }

        let content: ReactNode;
        let description: string;
        const value = values[field.id];
        if (field.type === 'TEXT_INPUT') {
          const text = value?.trim() ?? '';
          content = text ? (
            <span className="w-full truncate px-1 text-left text-slate-900">{text}</span>
          ) : (
            <Prompt>{field.required ? 'Type here' : 'Optional text'}</Prompt>
          );
          description = text ? `filled in: ${text}` : 'empty';
        } else {
          const image = images[field.type];
          const signed = value === SIGNED_MARK && filled;
          content = signed ? (
            image ? (
              <img src={image} alt="" className="h-full w-full object-contain" draggable={false} />
            ) : (
              <span className="px-1 font-medium text-emerald-800">Signed</span>
            )
          ) : (
            <Prompt>
              {field.type === 'SIGNATURE' ? (
                <span className="inline-flex items-center gap-1">
                  <svg
                    className="w-3.5 h-3.5 shrink-0 text-amber-800"
                    fill="none"
                    viewBox="0 0 24 24"
                    stroke="currentColor"
                    strokeWidth={2}
                    aria-hidden="true"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      d="M16.862 4.487l1.687-1.688a1.875 1.875 0 112.652 2.652L6.832 19.82a4.5 4.5 0 01-1.897 1.13l-2.685.8.8-2.685a4.5 4.5 0 011.13-1.897L16.863 4.487zm0 0L19.5 7.125"
                    />
                  </svg>
                  <span>Sign here</span>
                </span>
              ) : (
                'Initial'
              )}
            </Prompt>
          );
          description = signed ? 'signed' : 'not signed yet';
        }

        return (
          <button
            key={field.id}
            type="button"
            aria-label={`${name}, ${description}`}
            data-signing-field={field.id}
            className={className}
            style={style}
            onClick={() => onActivate(field)}
          >
            {content}
            {filled && (
              <span
                className="absolute -top-1.5 -right-1.5 h-3.5 w-3.5 rounded-full bg-emerald-600 text-white flex items-center justify-center shadow-2xs pointer-events-none"
                aria-hidden="true"
              >
                <CheckIcon className="h-2.5 w-2.5" strokeWidth={3.5} />
              </span>
            )}
          </button>
        );
      })}
    </>
  );
}

function Prompt({ children }: { children: ReactNode }) {
  return <span className="truncate px-1 font-semibold">{children}</span>;
}

function Tick() {
  return (
    <svg
      viewBox="0 0 24 24"
      className="pointer-events-none h-[80%] w-[80%] text-slate-900"
      fill="none"
      stroke="currentColor"
      strokeWidth="3"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M5 13l4 4L19 7" />
    </svg>
  );
}
