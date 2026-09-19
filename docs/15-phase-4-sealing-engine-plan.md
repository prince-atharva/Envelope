# Phase 4: Sealing Engine Plan

| | |
|---|---|
| **Status** | In progress |
| **Version** | 0.1.0 |
| **Last updated** | 19 September 2026 |
| **Audience** | Everyone (Part 1) · Developers (Part 2) |
| **What this doc answers** | What does Phase 4 deliver, how is each part built, and how do we check it? |

---

# PART 1: In Plain Terms

## What Phase 4 Is

Phase 4 is the **sealing engine**: weeks 7–8 of the roadmap in
[11-implementation-roadmap.md](11-implementation-roadmap.md), which calls it *the milestone that
matters*. Phase 3 let people sign. Their signatures were saved, but never put into the document, and
nobody got a finished file. Phase 4 closes that loop.

```
   STAMP ───────────► each person's signature and answers are written into the page itself
   VERSION ─────────► every signature produces a new copy of the document, with its own fingerprint
   CERTIFICATE ─────► after the last signature, a summary page goes on the back
   SEAL ────────────► the finished file is fingerprinted and locked away for good
   DELIVER ─────────► everyone gets an identical copy by email
   VERIFY ──────────► anyone can check a copy against our records, or with one command of their own
```

**From the end of this phase the product is genuinely usable.** You could send a real contract to a
real client and get back a finished document that stands up on its own.

## What You Can Do at the End of Phase 4

1. Send a document to three people, one after another.
2. The second person sees the document **with the first person's signature already on it**, and so
   does the third.
3. When the last person finishes, everyone gets an email with the **finished PDF attached**:
   - signatures and answers exactly where the boxes were;
   - a certificate page at the back saying who signed, when, from where, on what device, and how;
   - the fingerprint of every stage.
4. Your envelope page says **Completed**, lets you download the finished document, and lists every
   version with its fingerprint.
5. Anyone can open **Verify**, drop in a copy, and be told whether it is exactly the document that
   was sealed. Anyone can also check it without us, with one command:
   `sha256sum contract.pdf`.

## Why Each Signature Gets Its Own Version

If three people sign, the second person signs a document that already carries the first person's
signature. That exact file has to be on record, or someone can later say *"I never saw the version
you are showing me."* So every signature produces a new version with its own fingerprint, and the
certificate lists them all. Doc 06 calls this Correction 2.

## Why the Finished File Is Locked

The finished file is stored in a way that **nobody can change or delete**, including us, for seven
years by default. This is called Object Lock. Versions still in progress are not locked, because the
next signature has to be added to them.

## The Phase 4 Finish Line

From doc 11 (the sprint 8 gate), Phase 4 is finished when:

- [ ] a signature lands within 1 point (about a third of a millimetre) of its box, on a rotated page, in a
      document with pages of different sizes;
- [ ] three people signing one after another produce an unbroken chain of versions, then the sealed file;
- [ ] `sha256sum` on the downloaded file matches the fingerprint on record, and Verify agrees;
- [ ] the certificate lists every version and every event;
- [ ] all of this works end to end with a signature made on a real phone.

## Progress

| # | Step | Status |
|---|---|---|
| 1 | This plan and the sealing ADRs | ✅ Done |
| 2 | Database, settings and the locked storage bucket | ✅ Done |
| 3 | Stamping signatures and answers into the page | ✅ Done |
| 4 | One version per signature, in order | ✅ Done |
| 5 | The certificate page, sealing and locking | ✅ Done |
| 6 | Completion emails with the finished copy | ✅ Done |
| 7 | Verify | ✅ Done |
| 8 | The sender's Completed screen | ⬜ |
| 9 | Tests: three signers end to end, and the leak audits | ⬜ |
| 10 | Real-phone check, documentation and release `v0.4.0` | ⬜ |

## What We Need From You

| Needed | Why | When |
|---|---|---|
| Two or three real documents, anonymised | Stamping must be tested on the documents you will actually send | During Phase 4 |
| HealthProHub logo and brand colours | The certificate page and emails still use placeholders | During Phase 4 |
| Confirmation that 7 years' retention is right | Locked files cannot be deleted early, even by us | Before real use |
| The lawyer's consent wording | Still a placeholder from Phase 3 | Before real use |

---
---

# PART 2: Technical Detail

> Written for developers. Non-technical readers can stop here.

## Decisions Made Before Starting

| Question | Decision |
|---|---|
| How everyone receives the finished copy | **Attached to the completion email**, identical for everyone. A file over 15 MB is too large to attach and is sent as a private download link valid for 30 days. |
| Who receives it | Every recipient, whatever their role, and the sender |
| How Verify checks a file | **The visitor uploads the PDF** (doc 08). The server hashes it in memory and never stores or logs it. |
| Object Lock | A separate bucket, created with locking on, holding final versions only. `COMPLIANCE` mode in production, `GOVERNANCE` in dev and test. Retention 7 years (docs 01 and 07), set by `SEALED_RETENTION_DAYS`. |
| A declined or voided envelope | Sealing stops. Versions already made are kept. |

## ADRs Written in This Phase

The ADR index reserved these numbers for exactly these decisions:

| ADR | Decision |
|---|---|
| [0003](adr/0003-create-a-document-version-per-signing-round.md) | A `DocumentVersion` per signing round, each with its hash and the recipient who produced it |
| [0005](adr/0005-burn-signatures-into-page-content.md) | Stamp into the page content stream, never as annotations. Includes the rotated-page correction below. |
| [0006](adr/0006-run-sealing-asynchronously-on-workers.md) | Seal on workers, one envelope at a time, idempotent on `(envelopeId, versionNumber)` |
| [0007](adr/0007-apply-object-lock-to-the-final-version-only.md) | Object Lock on the final version only, in its own bucket |

## Corrections and Spec Gaps

| Spec says | Built as | Why |
|---|---|---|
| Doc 06's `burnFields` swaps width and height for `/Rotate 90` and `270` | A new function in `coordinates.ts` maps the box from the displayed page into the page's own space. The image is drawn turned with the page. The CropBox origin is added. | Swapping alone draws in the wrong space. It lands correctly only at the page's bottom-left corner, and the image comes out sideways. Ratios are relative to the page as displayed, with `/Rotate` and the CropBox applied (ADR 0002). |
| `burnFields` receives image data URLs | It receives the adopted images' storage keys, read on the worker | The images are already stored by `POST /sign/:token/adopt` (Phase 3) |
| Standard Helvetica for text | An embedded, subset Unicode font (Noto Sans) | Standard fonts only encode Windows-1252. A name or answer outside it would make `drawText` throw, and the seal would fail. |
| Advance to the next signer on version creation (doc 03) | As specified | Phase 3 advanced on submit because there were no versions. It moves here. |
| Which version a signer attested to is not recorded | The server records the version it last served to the recipient, and `RECIPIENT_SIGNED` carries that number and hash | Makes Correction 2 provable per signer. It is recorded by the server, not claimed by the client. |
| The final hash is on the verification page and in the email | Also on the sender's envelope page | The sender needs it to answer questions about a document |

## Step 2: Database, Settings and Storage

| Change | Reason |
|---|---|
| `Recipient.servedVersionNumber` | The version last served to this signer, copied into `RECIPIENT_SIGNED` |
| `DocumentVersion.storageVersionId`, required on the final version only (CHECK) | The locked bucket is versioned. Reads name this id, so a later write or delete marker on the same key cannot change what is served. |
| CHECK `Envelope_completed_has_seal` | A `COMPLETED` envelope always has `finalHash`, `completedFileUrl` and `completedAt` |
| Audit actions `VERSION_CREATED`, `ENVELOPE_COMPLETED`, `COMPLETION_SENT` | The sealing chain in the audit trail |
| `S3_SEALED_BUCKET` (default `<S3_BUCKET>-sealed`), `SEALED_RETENTION_MODE`, `SEALED_RETENTION_DAYS` (default 2557) | The locked bucket. None is required, so an existing `.env` keeps working. Production refuses `GOVERNANCE`. |
| `minio-init` creates `digitalsign-documents-sealed` and `digitalsign-test-sealed` with `--with-lock` | Object Lock can only be switched on when a bucket is created |

`StorageService` gains `putSealed()`, which writes with a retention date and returns the version id,
and `getSealed(key, versionId)`. The health check now covers both buckets. The tests use a one-day
retention.

`apps/api/test/sealed-storage.e2e.test.ts` shows, against MinIO, that:
- the locked version cannot be deleted;
- a forged newer version and a delete marker do not change what is read;
- the retention mode and date are as configured.

The download-link table for the large-file fallback arrives with step 6, where it is used. Its HMAC
is taken with `SIGNING_TOKEN_SECRET` under a separate label (domain separation), so no new secret is
required.

## Step 3: Stamping (`PdfSealingService.burnFields`)

- **Images.** `sharp` trims the transparent edges and reads the real size. `fitPreservingAspect()`
  keeps the proportions, centred in the box (Correction 1).
- **Text and dates.** The largest size that fits the box, but never below 6 pt, in the embedded font.
- **Tick boxes.** A drawn tick, not a letter.
- **Every page is measured on its own:** size, `/Rotate` and CropBox (gotchas 3–5).
- **Forms.** An AcroForm left by the upload sanitiser is flattened before the first stamp (gotcha 8).
- **Tests.** Every geometry test reads the image's placement back from the page content stream (the
  `cm` operator) and checks it to within 1 pt. They cover:
  - 0°, 90°, 180° and 270° pages;
  - mixed page sizes, using `apps/web/e2e/fixtures/mixed-pages.pdf`;
  - a CropBox offset from the MediaBox;
  - wide images in tall boxes, and the reverse.

### Step 3 as built

| File | What it does |
|---|---|
| `packages/shared/src/coordinates.ts` | `normaliseRotation`, `visibleBox`, `displayedPageSize`, `displayedPointToPdf` and `pdfPointToDisplayed`: Correction 4, with the rest of the coordinate arithmetic |
| `apps/api/src/sealing/pdf-sealing.service.ts` | `burnFields(source, fields, images)`. Every item is drawn at `displayedPointToPdf(...)`, turned by the page's `/Rotate`. Images and the font are embedded once per document. |
| `apps/api/src/sealing/fonts.ts`, `apps/api/assets/fonts/` | Noto Sans Regular and Bold, with `OFL.txt` |
| `apps/api/test/helpers/pdf-placements.ts` | Reads images, text and lines back out of a page's content stream, with the matrix or points that place them |

Decisions made while building it:

| Question | Decision | Why |
|---|---|---|
| Tick boxes | Two drawn strokes, not a letter "X" | Each end point is mapped on its own, so a rotated page needs nothing more, and no glyph is needed |
| Text too wide for its box | Shrunk down to 6 pt, then drawn in full, overflowing, with a warning in the log | The page must show what the signer entered, never a truncated version |
| Characters the font lacks | Drawn as `?`; the log records how many, never the text | A stray character must not fail the whole seal |
| Metadata | Loaded with `updateMetadata: false` | No new producer or date, so the same inputs give the same bytes, and a retried seal writes exactly the same file |
| Forms | Flattened when the document has AcroForm fields; a failure to flatten is logged, and stamping goes on | The stamp does not depend on it |

The tests read every placement back from the saved file and check it to within 0.01 pt:
- 0°, 90°, 180° and 270° pages, with one case worked out by hand;
- the mixed-pages fixture;
- an offset CropBox;
- text reading left to right on turned pages;
- ticks inside their box;
- Latin, Greek and Cyrillic names;
- a flattened form;
- identical output on a second run.

A rendered 90° page was also checked by eye. The fonts sit outside `src`, so a production image must
copy `apps/api/assets` (Phase 5).

## Step 4: One Version per Signature

- **Queueing.** Submit queues a `seal` job carrying `{ envelopeId }`.
- **Serialising.** The worker locks the envelope row. It then stamps every signer who has signed but
  has no version yet, in the order they signed.
- **Each round:**
  1. Load the latest version.
  2. Stamp this signer's fields.
  3. Store the result at `tenants/{t}/envelopes/{e}/versions/v{n}.pdf`.
  4. Insert `DocumentVersion n`, then write `VERSION_CREATED`.
  5. Invite the next group if signing is *one after another*.
- **Idempotency.** The unique `(envelopeId, versionNumber)` is the commit point. A retry that
  finds the version already inserted moves on. A retry that fails before the insert overwrites the
  same key.
- **Signers see the latest version.** `GET /sign/:token/document` serves the newest version and
  records its number on the recipient.

### Step 4 as built

| File | What it does |
|---|---|
| `apps/api/src/sealing/seal-queue.service.ts` | Queues `{ envelopeId, recipientId }` on the new `seal` queue, one job per signature (`jobId: seal-<recipientId>`) |
| `apps/api/src/sealing/sealing.service.ts` | `catchUp(envelopeId)` runs rounds until nothing is left. Each round takes `pg_advisory_xact_lock`, stamps the oldest unstamped signature onto the newest version, stores `versions/v{n}.pdf`, inserts the row, writes `VERSION_CREATED` and invites whoever is now due. |
| `apps/api/src/sealing/seal.processor.ts` | The worker, concurrency 2, 5 attempts with backoff. A permanent failure is logged with `alert: true`, because the next signer waits for it. |
| `packages/shared/src/signing.ts` | `currentRoutingGroup` and `recipientsDueInvitation` take the set of stamped signers. One after another, a group keeps the turn until its signatures are stamped. |

Decisions made while building it:

| Question | Decision | Why |
|---|---|---|
| Row lock or advisory lock | Advisory, per envelope, per round | A long stamp must not hold up a decline or a page load. Each round commits its version, so progress survives a failure. |
| Where the next invitation comes from | The seal worker, after the version commits | The next signer must see the signature before theirs. A reminder uses the same rule, so it cannot invite anyone early either. |
| What a signer attests to | `servedVersionNumber`, set when the document is served, copied with the hash into `RECIPIENT_SIGNED` | Recorded by the server. It is frozen once they have signed. |
| Test envelopes without an upload | The helper stores a real PDF and writes version 0 | Every suite's envelopes can be stamped, and the upload rate limit is not touched |

`test/sealing.e2e.test.ts` shows:
- three signers one after another make v0 to v3, each signer's stored hash matching the version they
  were served;
- each invitation comes after the version before it, and each file carries one more set of signatures;
- two simultaneous signers are stamped in turn;
- a second run does nothing, and a declined envelope stops.

The web app's progress list does not yet know about stamping. For the few seconds before a version
exists, it may offer a reminder that the server then skips as `NOT_THEIR_TURN`. Step 8 fixes this.

## Step 5: Certificate, Seal and Lock

When every signer and approver has a version, `sealFinal()` appends the certificate. It holds:
- the envelope's id and title;
- each signer's name, email, signing time (UTC), IP address, device, method (drawn or typed) and
  consent time;
- the hash of every version from v0 to vN;
- the event history.

It runs onto more pages as needed. The result is stored in the sealed bucket as version N+1, with
`isFinal = true`. The envelope then gets:
- `finalHash`, `completedFileUrl` and `completedAt`;
- status `COMPLETED`;
- the audit event `ENVELOPE_COMPLETED`.

The final hash is not printed in the file (Correction 3).

### Step 5 as built

| File | What it does |
|---|---|
| `apps/api/src/sealing/certificate.ts` | `certificateBlocks(data)` decides what the certificate says, as plain blocks (title, field, table row). `drawCertificate()` lays them out on Letter pages, wraps long values, starts a page when one is full, repeats the table header on a new page and adds "Page x of y" footers. |
| `apps/api/src/sealing/pdf-sealing.service.ts` | `appendCertificate(source, data)`: the certificate pages after the last page, in embedded Noto Sans Regular and Bold |
| `apps/api/src/sealing/sealing.service.ts` | `sealFinal(envelopeId)`, called by `catchUp` once nothing is left to stamp. Under the same advisory lock it checks that every signer and approver is in a version, appends the certificate, writes the file to the locked bucket with `putSealed`, inserts the final `DocumentVersion` with `storageVersionId`, completes the envelope and writes `ENVELOPE_COMPLETED`. |
| `apps/api/src/storage/storage.service.ts` | `sealedVersionKey()`: `tenants/{t}/envelopes/{e}/sealed.pdf` in the locked bucket |
| `apps/api/src/envelopes/envelopes.service.ts` | The sender's download reads a final version with `getSealed(key, storageVersionId)` |

The certificate shows:
- the document, the file name, the envelope id, the sender, and when it was sent and when everyone had signed;
- for each signer and approver, in signing order: name, email, role, signing time, consent time, signature method (drawn or typed), the version they were shown, IP address and full user agent;
- v0…vN, each with its SHA-256, who produced it and when;
- every audit event up to sealing, with its number, time, event, who and IP address.

Decisions made while building it:

| Question | Decision | Why |
|---|---|---|
| Where the certificate's dates come from | The records only: signing times, version times, event times. Nothing reads the clock. | A retry after a failure draws exactly the same page, so it writes the same bytes. The unit test checks this. |
| A retry after the file is locked but before the commit | It stores the file again. The first copy stays as an unreferenced locked version with the same bytes. | A locked version cannot be removed, and reads always name the recorded `storageVersionId` (ADR 0007). No second `DocumentVersion` row can appear: the unique `(envelopeId, versionNumber)` and the `COMPLETED` status prevent it. |
| `Envelope.completedAt` | The time of sealing | The certificate prints when the last person signed ("Signed by all"). The envelope records when the sealed file came into being. |
| Device | The full user agent, wrapped | It is the evidence as recorded. Turning it into "Safari on iPhone" would be a guess. |
| Characters the fonts lack | `?`, counted in the log, as in stamping. Only characters that both Regular and Bold contain are drawn. | Names and emails never go to the log |
| `CatchUpResult` | Gains `sealed: { versionNumber, sha256 }` when a run seals | Step 6 queues the completion emails from it |
| Sealing result for an envelope still waiting | `catchUp` still reports `nothing to stamp`, and `sealFinal` reports `waiting for signatures` | Existing callers and logs keep their meaning |

Tests:
- Unit tests in `pdf-sealing.service.test.ts` check that:
  - the certificate pages follow the document, whose pages keep their size and rotation;
  - a long history runs onto more pages;
  - every party, version fingerprint and event is printed;
  - Latin, Greek and Cyrillic names are drawn, and what the font lacks is marked without logging names;
  - a second run gives identical bytes;
  - wrapping keeps every line inside its column.
- `test/sealing.e2e.test.ts` checks that:
  - two signers make v0–v2 and then the sealed v3;
  - the envelope is `COMPLETED` with `finalHash` equal to the SHA-256 of the file read by its version id from the locked bucket, in `GOVERNANCE` mode with a retention date;
  - the sender's download matches the hash;
  - `ENVELOPE_COMPLETED` is written once, and a second run does nothing;
  - an approver is waited for, and a CC is not.

## Step 6: Completion Emails

One `completed` job per person. The finished PDF is attached, with its SHA-256 and a line on how to
check it. The worker checks the attachment's size, and above 15 MB sends a download link instead. The
link's token is created in the worker and only its HMAC is stored. It works for 30 days, and never in
a log.

### Step 6 as built

| File | What it does |
|---|---|
| `apps/api/src/sealing/sealing.service.ts` | Once `catchUp` seals an envelope, it queues one `completed` job for each recipient and one for the sender. A failure to queue fails the seal job, and the retry queues them again. |
| `apps/api/src/mail/completion.mailer.ts` | Worker side: reads the sealed file by its version id and checks that its SHA-256 equals `finalHash`, then attaches it. Above the size limit it mints a download token instead. Writes `COMPLETION_SENT` with `delivery: attachment` or `link`. |
| `apps/api/src/mail/templates.ts` | `renderCompletedEmail()`: the fingerprint, how to check it (the Verify page or `sha256sum`), and for the sender a link to the envelope. `signedFilename()`: `agreement.pdf` becomes `agreement (signed).pdf`. |
| `apps/api/src/completion/` | `GET /v1/download/:token` (doc 08) |
| `apps/api/prisma/migrations/20260919140000_completion_downloads` | `CompletionDownload`: the envelope, the recipient (null for the sender), the token's HMAC, the expiry, and a download count |
| `apps/api/src/signing/signing-token.ts` | `mintDownloadToken`, `hashDownloadToken`: the HMAC is taken under the label `completion-download`, so a download token never passes for a signing token |

Decisions made while building it:

| Question | Decision | Why |
|---|---|---|
| Sending each person their copy once | The mailer skips anyone who already has a `COMPLETION_SENT` event. Job ids are also fixed (`completed-<envelope>-<recipient or sender>`). | Neither a retried seal job nor a duplicate queue entry can send a second copy. A crash after sending but before the event is recorded can, as with invitations. |
| The sender is also a recipient | Only the recipient's copy is sent | One email, not two |
| Where the link points | `APP_URL/api/v1/download/<token>`, the API through the web app's `/api` | No web page is needed to download. An error comes back as problem JSON; a "request a new link" page is Phase 5. |
| Single use | No. The link can be used until it expires, and each use is counted. | Mail scanners open links before people do |
| Attachment or link | Decided by `DocumentVersion.sizeBytes` against `COMPLETION_ATTACHMENT_MAX_BYTES` (15 MB by default). The link lasts `COMPLETION_LINK_DAYS` (30 by default). | Both can be configured, so tests can take the link path |
| nodemailer and attachments | The transport gives nodemailer copies of the attachment objects | nodemailer rewrites attachment objects as it encodes them. This showed up as a wrong fingerprint in the test mailbox. |
| The `file` transport (browser tests, trying the app locally) | Each attachment is written next to the message's JSON as its own file | The JSON stays readable and the PDF can be opened. The browser helpers read only `.json` files. |

Logs record the delivery method, the size, `tokenRef` for a link, and a masked address. They never
record the token, the link or the name. `/download/<token>` is scrubbed from every logged URL,
message and stack trace, like `/sign/<token>`.

Tests:
- Unit tests check the email template (attachment, link and sender versions, and escaping), the file name, the download token's separate label and URL, and redaction of `/download/` paths.
- `test/sealing.e2e.test.ts` checks that both signers and the sender each get the sealed file attached, and that its SHA-256 equals `finalHash`. It also checks that the fingerprint is in the text, that `COMPLETION_SENT` is recorded for each person, and that nothing is sent twice.
- `test/completion.e2e.test.ts` runs with a 1,000-byte limit, so every copy goes out as a link. It checks that:
  - each person gets their own link, and only the HMACs are stored;
  - the link expires after 30 days;
  - the download matches `finalHash`, is private, and can be used again with each use counted;
  - a second job is skipped;
  - unknown, malformed, signing-token and expired links are refused (404 and 410), without the token appearing in the response;
  - a sender who is also a recipient gets one copy.

## Step 7: Verify

`POST /v1/verify` is public and accepts a PDF of up to 25 MB, limited to 30 a minute per IP.
- The file is hashed in memory and never stored or logged.
- A match against `Envelope.finalHash` or any `DocumentVersion.hash` returns the title, the signers,
  the version chain, which version matched, and the completion time.
- Otherwise it returns `NOT_FOUND`. That means *either* the file was never sealed here, *or* it has
  been changed since. The answer says both honestly (doc 06).

A public **Verify** page in the web app sends the file and shows the answer.

### Step 7 as built

| File | What it does |
|---|---|
| `apps/api/src/verify/` | `POST /v1/verify`. The public route reuses the upload size guard and error mapping. Multer keeps the file in memory. It is limited to 30 requests a minute per IP and answers with `Cache-Control: no-store`. |
| `packages/shared/src/verify.ts` | `VerifyResponse` and the wording for both kinds of no-match answer |
| `apps/api/prisma/migrations/20260919160000_verify_by_hash` | An index on `DocumentVersion.hash`, because a lookup covers every tenant |
| `apps/web/src/features/verify/` | The `/verify` page, public like `/sign`. `describeOutcome()` turns an answer into plain words. |
| `apps/web/src/components/layout/PublicFrame.tsx` | The card that public pages sit in, now shared by the signer portal and Verify |

Decisions made while building it:

| Question | Decision | Why |
|---|---|---|
| A match on version 0, the unsigned original | `verified: false`, reason `UNSIGNED_ORIGINAL`, and nothing about any envelope | An original is often a shared template. Answering with an envelope would show anyone holding a blank form who signed it, with their emails and IPs. |
| Which versions are reported on | v1…vN and the sealed file | Anyone holding one has already seen the signatures on it. It is also what the certificate prints. |
| No match | `200`, `verified: false`, `NO_MATCHING_DOCUMENT`, with both possible meanings (doc 08). The page never says "fake". | The system cannot tell a changed copy from one that was never signed here |
| A copy made during signing | Found as "version n of N", with what became of the envelope: finished, stopped, or still being signed | The sealed file is the one to keep, and the page says so |
| Not a PDF | 415 `UNSUPPORTED_FILE_TYPE` if `%PDF-` is missing from the first 1 KB | Nothing else is checked: a damaged PDF is still worth hashing |
| What is logged | The outcome, size and duration. Envelope id and version only on a match. | The fingerprint of an unknown file could identify a private document, so it is never logged |
| The same bytes in two envelopes (possible only in theory for signed versions) | The sealed one first, then the newest | Deterministic |
| Recording a check in the audit trail | No | An anonymous visitor would be writing into someone else's evidence chain |

Tests:
- `test/verify.e2e.test.ts` covers:
  - the sealed file, with its signers, version chain and events;
  - a copy with one byte changed, which is not matched;
  - an in-progress v1, found as that version;
  - v0, which gets `UNSIGNED_ORIGINAL` with no envelope id;
  - a PDF never seen before;
  - a file that is not a PDF, a missing file and an oversized one;
  - the 30-a-minute limit.
- `apps/web/src/features/verify/outcome.test.ts` checks every outcome's wording, including that a mismatch is never called fake.
- `apps/web/e2e/verify.spec.ts` (Chromium and Pixel) covers:
  - one person signs in the browser, and the PDF attached to their completion email is confirmed as sealed, with the email's fingerprint;
  - an unknown PDF;
  - an unsigned upload.

## Step 9: Tests

- **API e2e.** Three signers, one after another, produce v0…v3 and then the sealed v4. Each
  version's hash matches its stored file, and `sha256` of the download equals `finalHash`. Verify
  finds the final file, rejects a copy with one byte changed, and finds an in-progress version.
- **Parallel signing.** Two signers finishing at once are stamped one after the other, with no gap
  and no duplicate version.
- **Certificate.** A long event history overflows onto a second page.
- **Leak audits.** Both audits are extended to seal jobs and to the download-link token.
- **Browser.** The whole flow, ending with the downloaded file's hash compared with the value on the
  envelope page.

## Deliberate Simplifications

| Simplification | Planned fix |
|---|---|
| No PAdES digital signature inside the PDF; integrity rests on SHA-256 and the locked copy | Tier 2 is deferred (ADR 0010) |
| The certificate page is US Letter whatever the document's page size | If customers ask |
| Text in scripts that Noto Sans lacks (Devanagari, for example) is drawn as `?` on the page and logged. The stored value keeps the original. | Add fonts per script when a customer needs one |
| Void, the expiry sweeper and scheduled reminders are not built | Phase 5 |
| The download link for large files cannot be renewed | Phase 5, with "request a new link" |
