import type { ReactNode } from 'react';
import { PublicFrame } from '../../components/layout/PublicFrame';

/** The card every signer screen before and after the document sits in. */
export function SigningFrame({ children }: { children: ReactNode }) {
  return <PublicFrame>{children}</PublicFrame>;
}
