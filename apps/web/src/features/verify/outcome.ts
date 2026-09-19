import type { VerifyResponse } from '@envelope/shared';

export type Tone = 'verified' | 'partial' | 'unknown';

export interface Outcome {
  tone: Tone;
  title: string;
  body: string;
}

/**
 * What a Verify answer means, in plain words (docs/06 "Verification"). A file
 * that matches nothing is never called fake: the system cannot tell a changed
 * copy from one that was never signed here, and says both.
 */
export function describeOutcome(result: VerifyResponse): Outcome {
  if (!result.verified) {
    return result.reason === 'UNSIGNED_ORIGINAL'
      ? {
          tone: 'unknown',
          title: 'This is an unsigned original',
          body: 'It is a document as it was uploaded for signing, before anyone signed it. Verify only confirms documents that carry signatures.',
        }
      : {
          tone: 'unknown',
          title: 'No match found',
          body: 'This file does not match any document signed here. Either it was not signed with this service, or it has been changed since it was signed, even by a single character.',
        };
  }
  if (result.matched.isFinal) {
    return {
      tone: 'verified',
      title: 'This is the sealed, finished document',
      body: 'This file is exactly the document everyone signed, byte for byte, as sealed and locked when signing finished.',
    };
  }
  const total = result.versionChain.filter((v) => !v.isFinal).length - 1;
  const where = `It is version ${result.matched.versionNumber} of ${total}, a copy made while signing was under way.`;
  switch (result.status) {
    case 'COMPLETED':
      return {
        tone: 'partial',
        title: 'This is an earlier, unfinished copy',
        body: `${where} Signing has since finished: the sealed document is the one to keep.`,
      };
    case 'DECLINED':
    case 'VOIDED':
      return {
        tone: 'partial',
        title: 'This copy was never finished',
        body: `${where} Signing stopped before everyone had signed, so no finished document exists.`,
      };
    default:
      return {
        tone: 'partial',
        title: 'This document is still being signed',
        body: `${where} Not everyone has signed yet.`,
      };
  }
}
