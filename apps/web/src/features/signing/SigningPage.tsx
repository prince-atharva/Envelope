import { SIGNING_TOKEN_PATTERN } from '@envelope/shared';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { lazy, Suspense, useCallback, useEffect, useState } from 'react';
import { useParams } from 'react-router';
import { Alert } from '../../components/ui/Alert';
import { Button } from '../../components/ui/Button';
import { FullPageSpinner } from '../../components/ui/Spinner';
import { describeError } from '../../lib/errors';
import { reportError } from '../../lib/logger';
import { ConsentScreen } from './ConsentScreen';
import { EndScreen } from './EndScreen';
import { type EndState, endStateFor } from './end-states';
import { SigningFrame } from './SigningFrame';
import { isTransient, signingApi, signingKeys } from './signing-api';

// The document viewer, PDF.js and the signature pad arrive only after consent,
// which is also the first moment the document can be fetched (docs/09).
const SigningWorkspace = lazy(() => import('./SigningWorkspace'));

/**
 * Keeps the link out of the Referer header of everything this page loads
 * (docs/10). index.html already trims every referrer to the origin; the
 * signing page goes further and sends none at all.
 */
function useNoReferrer(): void {
  useEffect(() => {
    let meta = document.querySelector<HTMLMetaElement>('meta[name="referrer"]');
    const created = !meta;
    if (!meta) {
      meta = document.createElement('meta');
      meta.name = 'referrer';
      document.head.append(meta);
    }
    const previous = meta.content;
    meta.content = 'no-referrer';
    return () => {
      if (created) meta.remove();
      else meta.content = previous;
    };
  }, []);
}

/**
 * /sign/:token, the whole signer portal (docs/09, "The Signer's Journey").
 *
 * No account and no sender session: the token in the path is the only
 * credential, checked by the server on every request. This page walks the
 * signer from the notice to the finished signature, and turns every refusal
 * into a plain screen rather than an error.
 */
export default function SigningPage() {
  const { token = '' } = useParams();
  const queryClient = useQueryClient();
  const wellFormed = SIGNING_TOKEN_PATTERN.test(token);
  const [ended, setEnded] = useState<EndState | null>(wellFormed ? null : { kind: 'invalid' });
  useNoReferrer();

  const session = useQuery({
    queryKey: signingKeys.session(token),
    queryFn: () => signingApi.session(token),
    enabled: ended === null,
    staleTime: Number.POSITIVE_INFINITY,
    retry: (failures, error) => failures < 2 && isTransient(error),
  });

  const refreshSession = useCallback(
    () => queryClient.invalidateQueries({ queryKey: signingKeys.session(token) }),
    [queryClient, token],
  );

  const end = useCallback(
    (state: EndState) => {
      setEnded(state);
      // Nothing about this link is needed any more.
      queryClient.removeQueries({ queryKey: signingKeys.all(token) });
    },
    [queryClient, token],
  );

  useEffect(() => {
    if (session.error && isTransient(session.error)) {
      reportError(session.error, 'signing:session');
    }
  }, [session.error]);

  const finished = ended ?? endStateFor(session.error);
  if (finished) return <EndScreen state={finished} token={wellFormed ? token : undefined} />;

  if (session.isPending) return <FullPageSpinner label="Opening your document…" />;

  if (session.isError) {
    const failure = describeError(session.error);
    return (
      <SigningFrame>
        <div className="space-y-4 text-center">
          <h1 className="text-lg font-semibold text-slate-900">We could not open this document</h1>
          <Alert reference={failure.reference}>{failure.message}</Alert>
          <Button onClick={() => void session.refetch()} loading={session.isFetching}>
            Try again
          </Button>
        </div>
      </SigningFrame>
    );
  }

  if (session.data.consentRequired) {
    return (
      <ConsentScreen
        token={token}
        session={session.data}
        onAgreed={refreshSession}
        onNoticeChanged={() => void refreshSession()}
        onEnd={end}
      />
    );
  }

  return (
    <Suspense fallback={<FullPageSpinner label="Opening your document…" />}>
      <SigningWorkspace token={token} session={session.data} onEnd={end} />
    </Suspense>
  );
}
