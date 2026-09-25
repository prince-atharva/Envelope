import { useEffect, useState } from 'react';
import { useParams } from 'react-router';
import { PublicFrame } from '../../components/layout/PublicFrame';
import { Alert } from '../../components/ui/Alert';
import { Button } from '../../components/ui/Button';
import { TopProgressBar } from '../../components/ui/Skeletons';
import { useDocumentTitle } from '../../lib/use-document-title';
import { renewDownloadLink } from './download-api';

type State = 'loading' | 'downloaded' | 'expired' | 'invalid' | 'error';
type RenewState = 'idle' | 'sending' | 'sent' | 'error';

function filenameFrom(disposition: string | null): string {
  const match = disposition ? /filename\*?=(?:UTF-8'')?"?([^;"]+)"?/i.exec(disposition) : null;
  return match?.[1] ? decodeURIComponent(match[1]) : 'document.pdf';
}

/**
 * `/download/:token` (docs/17 step 10): the page a completion email's link
 * opens. Fetches the file itself, from the browser, rather than being the
 * file: an already-expired link then reads as a "send me a new link" screen
 * instead of raw JSON from the API.
 */
export default function DownloadPage() {
  useDocumentTitle('Download document');
  const { token = '' } = useParams<{ token: string }>();
  const [state, setState] = useState<State>('loading');
  const [renewState, setRenewState] = useState<RenewState>('idle');

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch(`/api/v1/download/${encodeURIComponent(token)}`, {
          credentials: 'omit',
          cache: 'no-store',
          referrerPolicy: 'no-referrer',
        });
        if (cancelled) return;
        if (res.ok) {
          const blob = await res.blob();
          const url = URL.createObjectURL(blob);
          const a = document.createElement('a');
          a.href = url;
          a.download = filenameFrom(res.headers.get('Content-Disposition'));
          document.body.appendChild(a);
          a.click();
          document.body.removeChild(a);
          setTimeout(() => URL.revokeObjectURL(url), 10_000);
          setState('downloaded');
          return;
        }
        setState(res.status === 410 ? 'expired' : 'invalid');
      } catch {
        if (!cancelled) setState('error');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [token]);

  async function renew() {
    setRenewState('sending');
    try {
      await renewDownloadLink(token);
      setRenewState('sent');
    } catch {
      setRenewState('error');
    }
  }

  if (state === 'loading') return <TopProgressBar />;

  if (state === 'downloaded') {
    return (
      <PublicFrame>
        <h1 className="text-lg font-semibold text-slate-900">Your download has started</h1>
        <p className="mt-2 text-sm text-slate-600">
          If nothing happened, check your browser's downloads, or reload this page to try again.
        </p>
      </PublicFrame>
    );
  }

  if (state === 'invalid' || state === 'error') {
    return (
      <PublicFrame>
        <h1 className="text-lg font-semibold text-slate-900">This link is not valid</h1>
        <p className="mt-2 text-sm text-slate-600">
          {state === 'error'
            ? 'We could not reach the server. Check your connection and reload this page.'
            : 'Ask the sender for a copy of the document.'}
        </p>
      </PublicFrame>
    );
  }

  return (
    <PublicFrame>
      <h1 className="text-lg font-semibold text-slate-900">This link has expired</h1>
      <p className="mt-2 text-sm text-slate-600">
        Download links last a limited time. We can send a fresh one to the same email address.
      </p>
      {renewState === 'sent' ? (
        <Alert tone="success">A new link is on its way. Check your email, including spam.</Alert>
      ) : (
        <>
          <Button
            onClick={() => void renew()}
            loading={renewState === 'sending'}
            className="mt-4 w-full"
          >
            Send me a new link
          </Button>
          {renewState === 'error' && (
            <Alert>That did not work. Please wait a moment and try again.</Alert>
          )}
        </>
      )}
    </PublicFrame>
  );
}
