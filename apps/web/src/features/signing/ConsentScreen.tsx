import type { SigningSession } from '@envelope/shared';
import { useMutation } from '@tanstack/react-query';
import { useId, useState } from 'react';
import { Alert } from '../../components/ui/Alert';
import { Button } from '../../components/ui/Button';
import { ApiError } from '../../lib/api';
import { describeError } from '../../lib/errors';
import { formatDate, pluralize } from '../../lib/format';
import { reportError } from '../../lib/logger';
import { useDocumentTitle } from '../../lib/use-document-title';
import { DeclineDialog } from './DeclineDialog';
import { type EndState, endStateFor } from './end-states';
import { SigningFrame } from './SigningFrame';
import { isTransient, signingApi } from './signing-api';

/**
 * The agreement to sign electronically (docs/07, docs/09 "Consent gate").
 *
 * The notice is shown exactly as the server sent it, and its hash goes back
 * with the agreement, so what is stored is provably what was on screen. The
 * document itself is not fetched until the server has recorded consent: the
 * gate is on the server, not a dismissible overlay.
 */
export function ConsentScreen({
  token,
  session,
  onAgreed,
  onNoticeChanged,
  onEnd,
}: {
  token: string;
  session: SigningSession;
  /** Fetches the session again, now with the fields. The button spins until it is back. */
  onAgreed: () => Promise<unknown>;
  /** The wording changed after it was shown: fetch the session again for the new text. */
  onNoticeChanged: () => void;
  onEnd: (state: EndState) => void;
}) {
  const checkboxId = useId();
  const noticeId = useId();
  const [agreed, setAgreed] = useState(false);
  const [noticeChanged, setNoticeChanged] = useState(false);
  const [declineOpen, setDeclineOpen] = useState(false);
  useDocumentTitle(session.envelopeTitle);

  const consent = useMutation({
    mutationFn: () =>
      signingApi.consent(token, { agreed: true, consentTextHash: session.consentTextHash ?? '' }),
    onSuccess: onAgreed,
    onError: (error) => {
      if (error instanceof ApiError && error.code === 'CONSENT_TEXT_CHANGED') {
        setAgreed(false);
        setNoticeChanged(true);
        onNoticeChanged();
        return;
      }
      const end = endStateFor(error);
      if (end) onEnd(end);
      else if (isTransient(error)) reportError(error, 'signing:consent');
    },
  });

  const failure =
    consent.error &&
    !endStateFor(consent.error) &&
    !(consent.error instanceof ApiError && consent.error.code === 'CONSENT_TEXT_CHANGED')
      ? describeError(consent.error)
      : null;

  return (
    <SigningFrame>
      <div className="space-y-5">
        <div className="space-y-1">
          <p className="text-sm text-slate-600">
            Hello {session.recipientName}. {session.senderName} has sent you a document to sign.
          </p>
          <h1 className="text-xl font-semibold break-words text-slate-900">
            {session.envelopeTitle}
          </h1>
          <p className="text-sm text-slate-500">
            {pluralize(session.pageCount, 'page')} · Link expires {formatDate(session.expiresAt)}
          </p>
        </div>

        {session.message && (
          <figure className="rounded-lg border-l-4 border-brand-600 bg-brand-50 px-4 py-3">
            <figcaption className="text-xs font-medium text-brand-900">
              Message from {session.senderName}
            </figcaption>
            <blockquote className="mt-1 text-sm whitespace-pre-line break-words text-slate-800">
              {session.message}
            </blockquote>
          </figure>
        )}

        {noticeChanged && (
          <Alert tone="info">
            The notice below has been updated since you opened this page. Please read it again
            before agreeing.
          </Alert>
        )}

        <section aria-labelledby={noticeId} className="space-y-2">
          <h2 id={noticeId} className="text-sm font-semibold text-slate-900">
            Agreement to sign electronically
          </h2>
          <div
            // Focusable so the notice can be scrolled from the keyboard (docs/09).
            // biome-ignore lint/a11y/noNoninteractiveTabindex: a scrollable region must take focus to be scrolled without a mouse
            tabIndex={0}
            role="document"
            aria-labelledby={noticeId}
            data-testid="consent-notice"
            className="max-h-64 overflow-y-auto rounded-lg border border-slate-200 bg-slate-50 px-4 py-3 text-sm whitespace-pre-line text-slate-700"
          >
            {session.consentText}
          </div>
        </section>

        <form
          className="space-y-4"
          onSubmit={(event) => {
            event.preventDefault();
            if (agreed) consent.mutate();
          }}
        >
          <div className="flex items-start gap-3">
            <input
              id={checkboxId}
              type="checkbox"
              checked={agreed}
              onChange={(event) => setAgreed(event.target.checked)}
              className="mt-0.5 h-5 w-5 shrink-0 rounded border-slate-400 accent-brand-700"
            />
            <label htmlFor={checkboxId} className="text-sm font-medium text-slate-900">
              I agree to sign electronically
            </label>
          </div>

          {failure && <Alert reference={failure.reference}>{failure.message}</Alert>}

          <div className="flex flex-col gap-2 sm:flex-row-reverse sm:justify-between">
            <Button type="submit" disabled={!agreed} loading={consent.isPending}>
              Review document
            </Button>
            <Button variant="ghost" onClick={() => setDeclineOpen(true)}>
              Decline to sign
            </Button>
          </div>
        </form>
      </div>

      <DeclineDialog
        open={declineOpen}
        token={token}
        senderName={session.senderName}
        onClose={() => setDeclineOpen(false)}
        onEnd={onEnd}
      />
    </SigningFrame>
  );
}
