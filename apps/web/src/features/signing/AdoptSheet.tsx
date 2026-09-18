import '@fontsource/caveat/400.css';
import '@fontsource/dancing-script/400.css';
import '@fontsource/great-vibes/400.css';
import type { SignatureKind, SignatureMethod } from '@envelope/shared';
import { useMutation } from '@tanstack/react-query';
import { useId, useRef, useState } from 'react';
import { Alert } from '../../components/ui/Alert';
import { Button } from '../../components/ui/Button';
import { ApiError } from '../../lib/api';
import { describeError } from '../../lib/errors';
import { reportError } from '../../lib/logger';
import { type EndState, endStateFor } from './end-states';
import { Sheet, SheetActions } from './Sheet';
import { SignaturePadCanvas, type SignaturePadHandle } from './SignaturePadCanvas';
import {
  cropToInk,
  INK_COLOUR,
  initialsOf,
  renderTypedSignature,
  SIGNATURE_FONTS,
  type SignatureFont,
  toSignaturePng,
} from './signature-image';
import { isTransient, signingApi, withBackoff } from './signing-api';

export interface Adoption {
  kind: SignatureKind;
  method: SignatureMethod;
  /** The PNG data URL, for showing in the boxes on this page. */
  image: string;
}

interface AdoptSheetProps {
  open: boolean;
  kind: SignatureKind;
  token: string;
  recipientName: string;
  /** Offered when the sheet was opened from an optional box that is already signed. */
  onRemove?: () => void;
  onClose: () => void;
  onAdopted: (adoption: Adoption) => void;
  onEnd: (state: EndState) => void;
}

/**
 * "Adopt and sign" (docs/07, docs/09 "Signature capture"): type a name in a
 * handwriting style, or draw it. Typing comes first and is just as valid:
 * drawing with a fingertip is awkward, and typing is the only way to sign from
 * a keyboard.
 *
 * One adoption per kind. It goes into every box of that kind the signer taps,
 * and adopting again replaces it everywhere.
 */
export function AdoptSheet(props: AdoptSheetProps) {
  const titleId = useId();
  return (
    <Sheet open={props.open} onClose={props.onClose} labelledBy={titleId}>
      <AdoptForm {...props} titleId={titleId} />
    </Sheet>
  );
}

class NothingToAdopt extends Error {}

function AdoptForm({
  kind,
  token,
  recipientName,
  onRemove,
  onClose,
  onAdopted,
  onEnd,
  titleId,
}: AdoptSheetProps & { titleId: string }) {
  const initials = kind === 'INITIALS';
  const nameId = useId();
  const [method, setMethod] = useState<SignatureMethod>('TYPED');
  const [text, setText] = useState(initials ? initialsOf(recipientName) : recipientName);
  const [font, setFont] = useState<SignatureFont>(SIGNATURE_FONTS[0].family);
  const [hasInk, setHasInk] = useState(false);
  const padRef = useRef<SignaturePadHandle>(null);
  const noun = initials ? 'initials' : 'signature';

  const adopt = useMutation({
    mutationFn: async (): Promise<Adoption> => {
      const canvas =
        method === 'TYPED'
          ? await renderTypedSignature(text, font)
          : (() => {
              const drawn = padRef.current?.canvas();
              return drawn ? cropToInk(drawn) : null;
            })();
      if (!canvas) throw new NothingToAdopt();
      const image = toSignaturePng(canvas);
      await withBackoff(() => signingApi.adopt(token, { kind, method, image }));
      return { kind, method, image };
    },
    onSuccess: onAdopted,
    onError: (error) => {
      const end = endStateFor(error);
      if (end) {
        onEnd(end);
        return;
      }
      // A refused image is our bug, not the signer's; so is a canvas that failed.
      if (
        !(error instanceof NothingToAdopt) &&
        (!(error instanceof ApiError) ||
          isTransient(error) ||
          error.code === 'INVALID_SIGNATURE_IMAGE')
      ) {
        reportError(error, 'signing:adopt');
      }
    },
  });

  let failure: { message: string; reference?: string } | null = null;
  if (adopt.error instanceof NothingToAdopt) {
    failure = {
      message: method === 'TYPED' ? `Type your ${noun} first.` : `Draw your ${noun} first.`,
    };
  } else if (adopt.error && !endStateFor(adopt.error)) {
    failure =
      adopt.error instanceof ApiError
        ? describeError(adopt.error)
        : {
            message: `Your ${noun} could not be prepared. Please try again, or try the other way.`,
          };
  }

  const ready = method === 'TYPED' ? text.trim().length > 0 : hasInk;

  return (
    <form
      noValidate
      onSubmit={(event) => {
        event.preventDefault();
        adopt.mutate();
      }}
    >
      <div className="space-y-4 px-5 pt-5 pb-4">
        <div>
          <h2 id={titleId} className="text-lg font-semibold text-slate-900">
            {initials ? 'Adopt your initials' : 'Adopt your signature'}
          </h2>
          <p className="mt-1 text-sm text-slate-600">
            It goes into every {noun} box you tap on this document.
          </p>
        </div>

        <fieldset>
          <legend className="sr-only">How to make your {noun}</legend>
          <div className="grid grid-cols-2 gap-1 rounded-lg bg-slate-100 p-1">
            {(
              [
                ['TYPED', 'Type'],
                ['DRAWN', 'Draw'],
              ] as const
            ).map(([value, label]) => (
              <label
                key={value}
                className={`flex min-h-11 cursor-pointer items-center justify-center rounded-md text-sm font-medium has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-brand-600 ${
                  method === value ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-600'
                }`}
              >
                <input
                  type="radio"
                  name="adopt-method"
                  value={value}
                  checked={method === value}
                  onChange={() => {
                    setMethod(value);
                    adopt.reset();
                  }}
                  className="sr-only"
                />
                {label}
              </label>
            ))}
          </div>
        </fieldset>

        {method === 'TYPED' ? (
          <div className="space-y-4">
            <div>
              <label htmlFor={nameId} className="block text-sm font-medium text-slate-800">
                {initials ? 'Your initials' : 'Your full name'}
              </label>
              <input
                id={nameId}
                value={text}
                onChange={(event) => {
                  setText(event.target.value);
                  adopt.reset();
                }}
                maxLength={initials ? 6 : 80}
                autoComplete={initials ? 'off' : 'name'}
                autoCapitalize="words"
                className="mt-1.5 block w-full rounded-lg border border-slate-300 bg-white px-3 py-2.5 text-base text-slate-900 shadow-sm focus:border-brand-600 focus:ring-2 focus:ring-brand-600/30 focus:outline-none"
              />
            </div>
            <fieldset className="space-y-2">
              <legend className="text-sm font-medium text-slate-800">Style</legend>
              {SIGNATURE_FONTS.map((option) => (
                <label
                  key={option.family}
                  className={`flex min-h-16 cursor-pointer items-center gap-3 rounded-lg border px-3 py-2 has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-brand-600 ${
                    font === option.family
                      ? 'border-brand-600 bg-brand-50 ring-1 ring-brand-600'
                      : 'border-slate-200 hover:bg-slate-50'
                  }`}
                >
                  <input
                    type="radio"
                    name="adopt-font"
                    value={option.family}
                    checked={font === option.family}
                    onChange={() => setFont(option.family)}
                    className="h-4 w-4 accent-brand-700"
                  />
                  <span className="sr-only">{option.label}</span>
                  <span
                    aria-hidden="true"
                    className="min-w-0 flex-1 truncate text-3xl leading-normal"
                    style={{ fontFamily: `"${option.family}", cursive`, color: INK_COLOUR }}
                  >
                    {text.trim() || (initials ? 'AB' : 'Your name')}
                  </span>
                </label>
              ))}
            </fieldset>
          </div>
        ) : (
          <div className="space-y-2">
            <p className="text-sm text-slate-600">
              Draw your {noun} in the box with your finger, a stylus or the mouse.
            </p>
            <SignaturePadCanvas
              ref={padRef}
              label={`Drawing area for your ${noun}`}
              onChange={(ink) => {
                setHasInk(ink);
                adopt.reset();
              }}
            />
            <div className="flex justify-end">
              <Button variant="ghost" onClick={() => padRef.current?.clear()} disabled={!hasInk}>
                Clear
              </Button>
            </div>
          </div>
        )}

        {failure && <Alert reference={failure.reference}>{failure.message}</Alert>}
      </div>

      <SheetActions>
        {onRemove && (
          <Button variant="ghost" onClick={onRemove} className="sm:mr-auto">
            Remove from this box
          </Button>
        )}
        <Button variant="secondary" onClick={onClose}>
          Cancel
        </Button>
        <Button type="submit" loading={adopt.isPending} disabled={!ready}>
          Adopt and sign
        </Button>
      </SheetActions>
    </form>
  );
}
