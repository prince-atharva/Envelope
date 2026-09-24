import type { ReactNode } from 'react';
import { useDocumentTitle } from '../../lib/use-document-title';
import type { EndState } from './end-states';
import { MoreTimeRequest } from './MoreTimeRequest';
import { SigningFrame } from './SigningFrame';

type Tone = 'done' | 'neutral' | 'stopped';

interface Screen {
  tone: Tone;
  title: string;
  body: ReactNode;
}

const DONE_FOLLOW_UP =
  'You can close this page. Once everyone has signed, the completed document will be emailed to you.';

function screenFor(state: EndState): Screen {
  switch (state.kind) {
    case 'signed':
      return {
        tone: 'done',
        title: state.approved ? 'Approved' : 'Signed',
        body: `${state.message} You can close this page.`,
      };
    case 'already-signed':
      return {
        tone: 'done',
        title: 'You have already signed this document',
        body: `There is nothing more to do. ${DONE_FOLLOW_UP}`,
      };
    case 'you-declined':
      return {
        tone: 'neutral',
        title: 'You declined this document',
        body: state.justNow
          ? 'The sender has been told, along with your reason. You can close this page.'
          : 'It can no longer be signed. If this was a mistake, contact the sender.',
      };
    case 'declined-by-other':
      return {
        tone: 'stopped',
        title: 'This document is no longer available for signature',
        body: 'Someone declined to sign it, so it has been closed. The sender has been told.',
      };
    case 'cancelled':
      return {
        tone: 'stopped',
        title: 'This document has been cancelled by the sender',
        body: 'There is nothing for you to do. Contact the sender if you have questions.',
      };
    case 'expired':
      return {
        tone: 'stopped',
        title: 'This signing link has expired',
        body: 'Links stop working after a set time, to keep documents safe. Anything you already did is kept, and you can ask the sender for more time.',
      };
    case 'invalid':
      return {
        tone: 'stopped',
        title: 'This link does not work',
        body: 'It may have been replaced by a newer email, such as a reminder. Use the link in the most recent email about this document, or ask the sender to send it again.',
      };
    case 'closed':
      return {
        tone: 'stopped',
        title: 'This document is no longer open for signing',
        body: 'Contact the sender if you think this is a mistake.',
      };
  }
}

const ICONS: Record<Tone, { className: string; path: string }> = {
  done: { className: 'bg-emerald-100 text-emerald-700', path: 'M5 13l4 4L19 7' },
  neutral: { className: 'bg-slate-100 text-slate-600', path: 'M6 12h12' },
  stopped: { className: 'bg-amber-100 text-amber-700', path: 'M12 8v5m0 3.5v.5' },
};

/**
 * Where every visit to a signing link can end (docs/09, "Edge-Case Screens").
 * A plain explanation, never an error code: finishing, or finding the link
 * already used, is a normal outcome.
 */
export function EndScreen({ state, token }: { state: EndState; token?: string }) {
  const screen = screenFor(state);
  const icon = ICONS[screen.tone];
  useDocumentTitle(screen.title);
  return (
    <SigningFrame>
      <div
        className="flex flex-col items-center gap-4 py-4 text-center"
        data-end-state={state.kind}
      >
        <span
          className={`flex h-14 w-14 items-center justify-center rounded-full ${icon.className}`}
        >
          <svg
            viewBox="0 0 24 24"
            className="h-7 w-7"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.5"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <path d={icon.path} />
          </svg>
        </span>
        <h1 className="text-xl font-semibold text-slate-900">{screen.title}</h1>
        <p className="max-w-md text-sm text-slate-600">{screen.body}</p>
        {state.kind === 'expired' && token && <MoreTimeRequest token={token} />}
      </div>
    </SigningFrame>
  );
}
