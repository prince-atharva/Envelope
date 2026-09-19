# 0003. Create a DocumentVersion per Signing Round

**Status:** Accepted
**Date:** 2026-09-19
**Deciders:** Engineering

## Context

With more than one signer, each person after the first signs a document that already carries earlier
signatures. The reference design kept one `originalHash` and one `finalHash` for the envelope. The
file that signer 2 actually saw and agreed to then appears nowhere in the record, and a dispute can
turn on exactly that: *"my client never saw the version you are presenting"* (doc 06, Correction 2).

## Decision

Every completed signing round produces a new `DocumentVersion`:

- **Version 0** is the upload, never changed.
- **Version n** is version n−1 with one recipient's fields stamped in. It records its SHA-256, its
  storage key, its page count and size, and `createdByRecipientId`.
- **The sealed file** is one more version, with the certificate appended and `isFinal = true`. Its
  hash is also kept as `Envelope.finalHash`.
- `(envelopeId, versionNumber)` is unique, and numbers run from 0 without gaps.
- A signer is always served the newest version. The server records which version it served, and
  `RECIPIENT_SIGNED` carries that version's number and hash. So each signer's attestation names an
  exact file.
- When signing is *one after another*, the next group is invited once the previous signer's version
  exists, so they always see that signature.

## Consequences

**Easier:**

- Every file anyone was shown has a fingerprint on record, and the certificate lists them all.
- Verify can recognise an in-progress version as well as the final one.

**Harder:**

- Stamping must happen one signer at a time per envelope, and in order (ADR 0006).
- Storage grows with every signer: one full copy of the document per round.

**Accepted:**

- With *everyone at once*, two people can sign the same version in parallel. Their versions are
  still stamped one after the other. The record shows honestly that the second signer attested to
  the version without the first signature, because that is what they were shown.
