# Changelog

All notable changes to Envelope by HealthProHub are recorded here.
The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project uses
[Semantic Versioning](https://semver.org/).

## [Unreleased]

Phase 3 (Signer Portal) in progress. See
[docs/14-phase-3-signer-portal-plan.md](docs/14-phase-3-signer-portal-plan.md).
Phase 4 (Sealing Engine) built; the real-phone check and the release are to come. See
[docs/15-phase-4-sealing-engine-plan.md](docs/15-phase-4-sealing-engine-plan.md).
Phase 5 (Envelope Lifecycle) in progress. See
[docs/16-phase-5-envelope-lifecycle-plan.md](docs/16-phase-5-envelope-lifecycle-plan.md).

### Added

- Phase 5 plan (`docs/16`): cancelling, deadlines that pause and can be extended, automatic
  reminders, the "needs attention" dashboard, request limits in Redis, and the nightly audit-chain
  check with alert emails. Doc 11's hardening block is split into Phases 5, 6 and 7.
  - ADR 0013: expiry pauses an envelope, and the sender can extend it. It amends ADR 0009: a link's
    expiry moves with an extension.
  - ADR 0004: the audit hash chain, reserved since doc 05 and written now.
- `@envelope/shared` defines the open and terminal envelope statuses once
  (`OPEN_ENVELOPE_STATUSES`, `TERMINAL_ENVELOPE_STATUSES`, `isOpenEnvelope`, `isTerminalEnvelope`).
  They replace eight local copies in the API and the web app, so a new status is added in one place.
- Database for the envelope lifecycle (docs/16 step 3), in two migrations because Postgres cannot
  use a new enum value in the transaction that adds it:
  - `EnvelopeStatus.EXPIRED`: an overdue envelope pauses. It is neither open nor terminal, and a
    signing link on it is refused as `TOKEN_EXPIRED` (after the already-signed check). The web
    status badge shows it as "Expired".
  - `Envelope.voidedAt`, `voidReason` and `voidedByUserId`; `expiredAt`; `reminderIntervalDays`.
  - `Recipient.expiryWarnedAt`, `moreTimeRequestedAt` and `lastSeenAt`.
  - Checks: a cancelled envelope has a time, and a reason if it was sent; an expired one has a time;
    the reminder interval is 1–30 days. A discarded draft may have no send time. Index
    `(status, expiresAt)` for the expiry sweep.
- Cancel and discard (docs/16 step 4): `POST /v1/envelopes/:id/void`. A sent envelope needs a reason
  and a draft does not. Links stop the moment it commits. Each signer or approver who had been
  emailed gets a `voided` email with the reason and no link, recorded as `EMAIL_SENT`
  (`kind: voided`). The audit event `ENVELOPE_VOIDED` keeps the previous status and the reason's
  length, not the reason. The envelope detail now includes `voidedAt`, `voidReason` and `voidedBy`.
  The web audit list reads "Email sent" for every kind of email.
- Cancel and discard in the web app (docs/16 step 5). The envelope page has **Cancel document** for a
  sent or expired envelope and **Discard draft** for a draft. The cancel dialog names who will be
  emailed and requires the reason they will read; discarding asks for nothing and returns to the
  dashboard. A cancelled envelope shows who cancelled it, when and why. The status badge reads
  "Cancelled" instead of "Voided". Browser test: `e2e/cancel.spec.ts`.
- The maintenance queue and the expiry sweep (docs/16 step 6). The worker registers BullMQ job
  schedulers on a third queue, `maintenance`, one schedule per job id however many workers run
  (`MAINTENANCE_SCHEDULES_ENABLED`, `EXPIRY_SWEEP_EVERY_MS`, default 5 minutes). The sweep claims
  each overdue envelope under its row lock, checks the deadline and the unsigned count again there,
  and pauses it as `EXPIRED` with `ENVELOPE_EXPIRED` (system actor). The sender is emailed once per
  expiry (`expired`). An envelope whose last signature is only waiting for the seal is left alone.
- Extend and resume (docs/16 step 7): `POST /v1/envelopes/:id/extend` with `{ expiresInDays }` and an
  `Idempotency-Key`. One transaction sets the new deadline, moves every unused link's expiry to it,
  clears the "expires soon" markers and records `ENVELOPE_EXTENDED`. An `EXPIRED` envelope reopens
  as `PARTIALLY_SIGNED` or `SENT`. Whoever holds the turn gets an `extended` email with a fresh
  link; on reopening, a `resume` seal job stamps signatures made before the deadline and invites
  whoever is due next. Drafts answer 409 `CONFLICT`, closed envelopes 409 `ENVELOPE_TERMINAL`.
- Ask for more time (docs/16 step 8): `POST /v1/sign/:token/request-more-time`, the one route an
  expired link can use (`TokenGuardianService.resolve(..., { allowExpired: true })`, which still
  refuses a cancelled, declined, finished or unknown link). Once a day per person, claimed on
  `moreTimeRequestedAt`; a repeat answers 200 with `alreadyRequested: true` and emails nobody. It
  records `EXTENSION_REQUESTED` and emails the sender (`more-time-requested`). The expired-link
  screen has an **Ask for more time** button.
- Deadlines on the envelope page (docs/16 step 9). **Give more time** (a dialog with 3, 7, 14 or 30
  days, naming who gets a fresh link) for a sent or expired envelope. An expired envelope shows a
  banner: when the deadline passed, who still has to sign, who asked for more time, and **Give more
  time** or **Cancel document**. People waiting for their turn on a paused envelope read "Waiting
  for their turn", not "Not reached". The envelope detail gains `expiredAt` and each recipient's
  `moreTimeRequestedAt`. Browser test `e2e/expiry.spec.ts` walks the whole path: expire, ask for
  more time, give it, sign with the new link. The browser stack sweeps every 2 seconds.
- Automatic reminders and the "expires soon" email (docs/16 step 10). A second maintenance job,
  `auto-reminders` (every 15 minutes), emails a new link to each person whose turn it is once the
  envelope's interval has passed since they were last emailed, and one "{title} expires in N days"
  email within `EXPIRY_WARNING_HOURS` (48) of the deadline, but never while they have had the
  document open in the last hour (`lastSeenAt`, written by signing reads at most every 10
  minutes). Each is claimed under the envelope lock with a compare-and-set, recorded as
  `REMINDER_SCHEDULED`, and makes the sender's Remind button wait a day. The interval is chosen
  when sending (`reminderIntervalDays`, default `AUTO_REMINDER_DEFAULT_DAYS` = 3; null is off) and
  changed with `PATCH /v1/envelopes/:id/reminders`, from the send dialog and the envelope page.
- Alerts (docs/16 step 11). `AlertService.raise(key, summary, ids)` always logs with `alert: true`
  and, with `ALERT_EMAIL` set, emails at most once per key every `ALERT_EMAIL_MIN_INTERVAL_MINUTES`
  (15), gated in Redis across processes. The worker sends alert emails directly through SMTP, so a
  stuck email queue cannot hold its own alert; the API queues an `alert` job. Raised for a failed
  audit write, a broken audit chain, a seal, email or maintenance job that failed its last attempt,
  and a sealed file that does not match its fingerprint. Alert emails carry ids, codes and counts
  only.
- Fixed: finished maintenance jobs are no longer kept in Redis. A kept job blocked its schedule
  slot, so a restarted worker's first sweep could come many intervals late.
- Remind answers 409 `ENVELOPE_EXPIRED` past the deadline, swept or not, instead of 200 with nothing
  sent. The web app no longer offers Remind there.
- Phase 4 plan (`docs/15`) and four ADRs reserved for it:
  - 0003: a document version per signing round.
  - 0005: signatures burned into the page content. It adds Correction 4: rotated pages need their
    boxes mapped into the page's own space, not just their width and height swapped.
  - 0006: sealing on workers, one envelope at a time, idempotent on the version number.
  - 0007: Object Lock on the final version only, in its own bucket.
- **Locked storage for sealed documents** (migration `sealing_engine`):
  - A separate bucket, `<S3_BUCKET>-sealed`, created with Object Lock by `minio-init`.
  - `StorageService.putSealed()` writes with a retention date: `COMPLIANCE` mode in production
    (enforced at start-up) and `GOVERNANCE` elsewhere, 7 years by default. It returns the object's
    version id, which every read names, so a later write or delete marker on the same key cannot
    change what is served.
  - New settings `S3_SEALED_BUCKET`, `SEALED_RETENTION_MODE` and `SEALED_RETENTION_DAYS`, all
    optional.
  - The health check covers both buckets.
  - `Recipient.servedVersionNumber` and `DocumentVersion.storageVersionId` are new columns.
  - Two new CHECKs: a completed envelope carries its seal, and only the final version has a storage
    version id.
  - Audit actions `VERSION_CREATED`, `ENVELOPE_COMPLETED` and `COMPLETION_SENT`, with their
    wording in the web app.
  - An e2e test shows, against MinIO, that a locked version cannot be deleted and that a forged
    newer version does not change what is read.
- **Stamping signatures and answers into the PDF** (`apps/api/src/sealing/`,
  `PdfSealingService.burnFields`). It writes into the page content, never as annotations (ADR 0005).
  - **Signatures and initials:** the transparent margin is trimmed with `sharp`, and the image is
    kept in proportion, centred in its box.
  - **Text and dates:** in embedded Noto Sans, so Latin, Greek and Cyrillic names all work. Text is
    shrunk to fit, down to 6 pt. Characters the font lacks are drawn as `?`, and only their count is
    logged.
  - **Tick boxes:** a drawn tick.
  - **Forms:** any AcroForm is flattened first.
  - **Rotated and cropped pages are placed correctly.** `@envelope/shared` gains
    `displayedPointToPdf`, which maps a point on the page as displayed into the page's own space for
    `/Rotate` 0, 90, 180 and 270 and any CropBox. Every stamp is drawn at that point, turned with
    the page. Doc 06's reference code only swapped width and height, which placed boxes correctly
    at one corner only (Correction 4).
  - The same inputs give byte-identical output, so a retried seal writes the same file.
  - Tests read every placement back from the saved file and check it to within 0.01 pt, on turned,
    mixed-size and cropped pages.
- **One document version per signature** (ADR 0003, ADR 0006):
  - Finishing queues a `seal` job. On the worker, each signature is stamped onto the newest version,
    stored as `versions/v{n}.pdf` and committed as `DocumentVersion n`, with `VERSION_CREATED` in the
    audit trail.
  - One envelope is stamped by one job at a time, under a per-envelope advisory lock. Rounds commit
    one by one, and retries and duplicate jobs cannot leave a gap or a second copy.
  - **Signers now see every earlier signature.** The signing page serves the newest version.
    `RECIPIENT_SIGNED` records which version and hash the signer was shown, from the new
    `Recipient.servedVersionNumber`.
  - **The next signer is invited once the version before them exists**, not on submit. The routing
    helpers take the set of stamped signers, so a reminder cannot invite anyone early either.
  - A declined or closed envelope is not stamped further.
- **Certificate of Completion, sealing and locking.** Once every signer and approver is in a
  version, the worker:
  - adds a certificate to the end of the document, on US Letter pages in Noto Sans, running onto
    more pages as needed. It lists each party's name, email, role, signing and consent times,
    signature method, the version they were shown, IP address and device, then every version's
    SHA-256 and the event history.
  - stores the result in the locked bucket as the final version;
  - completes the envelope with `finalHash`, `completedFileUrl` and `completedAt`, and writes
    `ENVELOPE_COMPLETED`.

  The certificate's dates come from the records, never the clock, so a retried seal writes the same
  bytes. The final fingerprint is not printed in the file (Correction 3).
- **Completion emails with the finished document.** Every recipient, whatever their role, and the
  sender get it attached, with its SHA-256 and how to check it (Verify, or `sha256sum`).
  - The worker reads the sealed file by its locked version id, and will not send anything whose hash
    is not `finalHash`.
  - Above `COMPLETION_ATTACHMENT_MAX_BYTES` (15 MB), the email carries a private download link
    instead, valid for `COMPLETION_LINK_DAYS` (30). It is served by the new
    `GET /v1/download/:token`. The token is minted by the worker and stored only as an HMAC, in the
    new `CompletionDownload` table, under a label that keeps it apart from signing tokens.
  - Each person is sent one copy, and a sender who is also a recipient gets one email.
  - `COMPLETION_SENT` is recorded for each person.
- **Verify** (`POST /v1/verify` and the public `/verify` page).
  - Anyone uploads a PDF, which is hashed in memory and never stored. The answer says whether it is
    exactly the sealed document or a copy made while signing was under way. A match comes with the
    signers, the version chain and the history.
  - A mismatch says both things it can mean: never signed here, or changed since.
  - A file that matches only an unsigned original says so and reveals nothing about any envelope,
    because originals are often shared templates.
  - Limited to 30 checks a minute per IP. `DocumentVersion.hash` is indexed.
- **The sender's Completed screen.** A completed envelope's page shows:
  - when it was sealed;
  - the finished document's fingerprint, with a copy button;
  - **Download signed document**;
  - how anyone can check a copy.

  The viewer and download show the newest version, so the sender sees the signatures so far while
  people sign. Each version says who signed it, and each person shows when their finished copy was
  emailed. The envelope detail in the API gains `completedAt`, `senderCopySentAt`, `copySentAt` for
  each recipient and `createdByRecipientId` for each version.
- **Phase 4 tests.** One API e2e test runs three signers, one after another, to the sealed v4. It
  covers the whole sprint 8 gate: an unbroken chain, a download that hashes to `finalHash`, Verify
  accepting it and refusing a one-byte change, and the certificate (read back with pdf.js) listing
  every version and event. Both leak audits now cover a completed envelope's seal jobs and download
  links. They also check that the fingerprint of a file that matched nothing on Verify is never
  logged.
- `WEB_HOST` (optional) makes the development web server listen beyond localhost, for trying the
  signing portal on a phone on the same network.
- Phase 3 plan (`docs/14`) and ADR 0009, which records how signing tokens are handled: only their
  HMAC is stored, they are minted inside the email worker so the raw token never reaches Redis or the
  database, every reminder rotates them, and revocation is by envelope and recipient state.
- Database support for sending and signing (migration `signer_portal`):
  - `Envelope.sentAt`.
  - `Recipient.invitedAt`, `notifiedAt`, `lastRemindedAt`, `viewedAt` and `declinedAt`, for the
    sender's progress view and the one-reminder-a-day limit.
  - `Recipient.signatureImageKey`, `signatureMethod`, `initialsImageKey` and `initialsMethod`, with a
    new `SignatureMethod` enum (`DRAWN`, `TYPED`), for the images a signer adopts.
  - CHECK constraints: a sent envelope has `sentAt`; a signed recipient has `signedAt` and a spent
    token; a declined one has a reason; consent is never stored without its verbatim text; an adopted
    image always records how it was made.
- `@envelope/shared` signing module (`signing.ts`): request schemas for send, remind, consent, adopt,
  submit and decline; the signing session types; `SIGNING_TOKEN_PATTERN`; `orderFieldsForSigning`
  (page, then top to bottom, then left to right); and `currentRoutingGroup` /
  `recipientsDueInvitation`, which decide who is emailed at send and after each signature. Only
  SIGNER and APPROVER recipients receive a signing link.
- New limits: 500 KB per signature image, 1000-character decline reason, 500-character text
  values, 14-day default expiry (90 at most), one reminder per recipient per 24 hours.
- New error codes: `CONSENT_TEXT_CHANGED` (409), `INVALID_SIGNATURE_IMAGE` (422),
  `REMINDER_TOO_SOON` (429), `IDEMPOTENCY_KEY_REQUIRED` (400) and `IDEMPOTENCY_KEY_MISMATCH` (422).
  Problem details gain an optional `reason`, which `ENVELOPE_TERMINAL` uses to say whether the
  envelope was cancelled or declined.
- Signing tokens (`apps/api/src/signing/`):
  - `signing-token.ts` mints 256-bit hex tokens, hashes them with HMAC-SHA256 under the new
    `SIGNING_TOKEN_SECRET`, and gives an 8-character `tokenRef`, the only form allowed in logs.
  - `TokenGuardianService.resolve` is the one place a signing link is checked. It refuses in a
    fixed order: unknown → `TOKEN_INVALID`; cancelled or declined → `ENVELOPE_TERMINAL` with a
    reason; already signed → `TOKEN_ALREADY_USED`; expired (link or envelope, whichever is first) →
    `TOKEN_EXPIRED`. Once a link resolves, every later log line of the request names the tenant,
    envelope, recipient and `tokenRef`.
- New settings: `SIGNING_TOKEN_SECRET` (required, at least 32 characters, different from the other
  secrets) and `SIGNING_DEFAULT_EXPIRY_DAYS` (default 14).
- `MAIL_TRANSPORT=file` writes each email as JSON to `MAIL_OUTBOX_DIR` (default `.mail-outbox`,
  gitignored, files readable only by their owner) and sends nothing. The browser tests read signing
  links from it, and it lets you try the signing flow without an SMTP account. It is refused in
  production, as `memory` now is too.

- **Sending:** `POST /envelopes/:id/send` (`apps/api/src/sending/`).
  - It needs an `Idempotency-Key` header. The response is kept in Redis for 24 hours per tenant and
    envelope. A repeat with the same key returns it with `Idempotency-Replayed: true` and sends
    nothing; the same key with a different body returns 422 `IDEMPOTENCY_KEY_MISMATCH`.
  - One transaction claims the draft, re-runs `checkReadyToSend` on the stored data, sets `SENT`,
    `sentAt` and `expiresAt` (`expiresInDays`, default `SIGNING_DEFAULT_EXPIRY_DAYS`), marks whoever
    is due first as invited, and writes `ENVELOPE_SENT`. "Everyone at once" invites every signer and
    approver; "one after another" invites only the first routing group.
  - Refusals list every problem in `errors`: `RECIPIENT_HAS_NO_FIELDS` (docs/08) or the new
    `NOT_READY_TO_SEND`. `checkReadyToSend` now also reports `NO_SIGNERS` when only viewers and
    copy recipients are on the envelope.
- **Invitation emails**, minted and sent by the worker (ADR 0009):
  - The job holds only the envelope and recipient ids.
  - The worker checks the person is still due a link, stores the HMAC of a fresh token, and sends
    the email with one **Review & Sign** (or **Review & Approve**) button, the sender's message, the
    expiry date and a plain-text copy. It then sets `notifiedAt` and writes `EMAIL_SENT` with the
    recipient id.
  - A queued email for someone who has since signed or declined, or on an envelope that has closed
    or expired, is skipped and logged.
  - The worker now connects to the database and the audit trail.
- **The public signer API**, `/sign/:token/...` (`apps/api/src/signing/`). There is no account: the
  token is checked on every request, and every later query is scoped to the one recipient it names.
  - `GET /sign/:token` opens the session. The first visit sets the person to `VIEWED` and writes
    `ENVELOPE_VIEWED` once. Before consent it returns only the title, sender, page count, expiry
    and the notice with its SHA-256. The person's own fields come only after consent, never anyone
    else's.
  - `GET /sign/:token/document` streams the original PDF, and only after consent.
  - `POST /sign/:token/consent` checks the hash of the notice that was shown (a changed notice gets
    409 `CONSENT_TEXT_CHANGED`), stores the verbatim text, and writes `CONSENT_GIVEN` with the IP and
    browser. Repeating it changes nothing.
  - `POST /sign/:token/adopt` ("Adopt & Sign") checks the image is a transparent PNG of at most 500 KB
    and a sensible size, stores it in object storage, and writes `SIGNATURE_ADOPTED` with its method
    (drawn or typed) and SHA-256. Adopting again replaces it and deletes the unused image.
  - `POST /sign/:token/submit` ("Finish", 202):
    - Only the signer's own fields are accepted.
    - It fills signatures and initials from the adopted images, sets `DATE_SIGNED` from the server
      clock, and requires every required field.
    - In one transaction it spends the token, records the IP and browser, moves the envelope to
      `PARTIALLY_SIGNED` and writes `RECIPIENT_SIGNED`.
    - With "one after another", it invites the next group once the current one has finished.
  - `POST /sign/:token/decline` needs a reason and is allowed before consent. It ends the envelope for
    everyone in the same transaction and writes `RECIPIENT_DECLINED`; the reason stays on the
    recipient and out of the audit metadata.
  - Every signing response sends `Cache-Control: no-store` and `Referrer-Policy: no-referrer`.
  - Signing routes are rate-limited per link rather than per address: 60 reads and 10 changes a
    minute, keyed on a hash of the token.
- **Reminders:** `POST /envelopes/:id/remind`, optionally with `recipientIds`.
  - It reminds everyone whose turn it is and who has not finished. Each reminder mints a new link,
    and the old one stops working.
  - One reminder per person per 24 hours; a second gets 429 `REMINDER_TOO_SOON` with
    `Retry-After`. If no email has reached the person, a retry is allowed after 10 minutes, which is
    also how a failed invitation gets re-sent.
  - People not yet due, or already finished, are listed in `skipped` with a reason.
  - Each reminder writes `REMINDER_REQUESTED`.
- **The sender is emailed when someone declines**, with the reason and a link to the envelope.
- `GET /envelopes/:id` now includes `sentAt` and `expiresAt`, and for each recipient their
  progress: `invitedAt`, `notifiedAt`, `lastRemindedAt`, `viewedAt`, `signedAt`, `declinedAt` and
  `declinedReason` (new shared type `RecipientDetail`).
- **Sending from the web app.** The review screen's **Send for signing** is enabled once the draft is
  ready.
  - It opens a dialog that names who is emailed now and who follows one after another, notes who
    only gets the finished copy, and offers link expiry (7, 14 or 30 days) and the message.
  - The dialog keeps one idempotency key while it is open, so a retry cannot send twice.
  - Once sent, the prepare and review pages redirect to the envelope page, which confirms who is
    being emailed.
- **Signing progress** on the envelope page:
  - Each person shows as waiting for their turn, sending email, email sent, opened, signed (or
    approved) or declined, with the time.
  - A decline is shown with its reason.
  - A **Send reminder** button appears for anyone whose turn it is. It becomes "Reminded … ago" while
    the 24-hour limit runs.
  - The page refreshes every 15 seconds while people are signing.
- The audit trail describes every Phase 3 event in plain words.
- `nextReminderAt` moved to `@envelope/shared`, so the reminder button and the API apply the same
  rule.
- The consent notice is a clearly marked **DRAFT placeholder** (`signing/consent-text.ts`), pending
  lawyer-approved wording. The API logs a warning at every start-up until it is replaced, and each
  `CONSENT_GIVEN` event records `draftText: true`.
- Audit actions `ENVELOPE_SENT`, `EMAIL_SENT`, `REMINDER_REQUESTED`, `ENVELOPE_VIEWED`,
  `CONSENT_GIVEN`, `SIGNATURE_ADOPTED`, `RECIPIENT_SIGNED` and `RECIPIENT_DECLINED`. Events from
  sending onwards fill the `recipientId` column, since recipients can no longer be removed.
- The email layout takes its footer as a parameter, so signing emails explain why the recipient got
  them. Subject values have line breaks removed.
- **The signing screens**, at `/sign/:token` (`apps/web/src/features/signing/`). There is no
  account and no sender session: the link in the email is all a signer needs.
  - **Consent:** who sent the document, its title, page count and link expiry, the sender's
    message, and the notice exactly as the server sent it. **Review document** stays disabled until
    "I agree to sign electronically" is ticked. The agreement carries the notice's SHA-256, and if
    the wording changed meanwhile the new text is shown with a request to read it again.
  - **The document** is fetched, and PDF.js loaded, only after consent. The signer's boxes are drawn
    over it, and a bar along the bottom always shows how many required boxes are done, with
    **Start**, then **Next: Signature**, **Next: Tick box** and so on. Next goes through the boxes in
    reading order, scrolls each to the middle of the screen and highlights it briefly. When nothing
    required is left, it becomes **Finish**.
  - **Adopt and sign:** a sheet that slides up from the bottom on a phone. **Type** (the default)
    shows the name in three self-hosted handwriting styles (Dancing Script, Great Vibes, Caveat);
    **Draw** uses `signature_pad` at a pixel ratio of at least 2, with the iOS Safari handling
    (`touch-action: none` and a cancelled `touchmove`) so the page does not scroll under the finger.
    Both produce a transparent PNG cropped to the ink and scaled down if it is over 500 KB. One
    adoption fills every box of that kind the signer taps; tapping a signed box offers to change it,
    and an optional one can be cleared.
  - **Text boxes** are typed into a full-size field in a sheet, because a box on a phone is often a
    few pixels tall and iOS zooms the page in on any smaller input. **Tick boxes** toggle in place.
    Dates show today's date and fill themselves in.
  - **Decline** is available from the consent screen and the document, needs a reason, and says the
    document will close for everyone.
  - **End screens** for every outcome, none of them shown as an error: signed, already signed,
    declined by you, declined by someone else, cancelled by the sender, link expired, link not
    valid (including a malformed one, which never reaches the server), and closed.
  - **Work in progress is kept on the device** after every change and restored on return, with a
    notice. It is keyed by the signer's first field id rather than the link, so the token is never
    stored and a reminder's new link still finds the draft. Drafts are cleared on finishing or
    declining, and removed after 90 days. The adopted images are kept for the tab only.
  - Adopting and finishing retry on a dropped connection or server error after 1, 2 and 4 seconds,
    then offer **Try again**. A finish that already got through is recognised by the "already
    signed" answer to the retry.
  - Every box is a real button or checkbox with a name such as "Signature field, required, page 4 of
    12", has a touch area of at least 44 × 44 px, and says what to do in words as well as colour.
    Progress is announced to screen readers, and animations stop when reduced motion is requested.
- Browser tests for signing (`apps/web/e2e/signing.spec.ts`): typed and drawn signatures, finishing
  and returning to a spent link, a draft restored after reloading, declining before consent, and
  links that are not valid. The helpers read signing links from the test outbox.
- **The signing-link leak audit**, run in two places. Each runs a full flow, collects every link that
  was emailed (including links a reminder replaced), and fails if any of them is found. On failure it
  shows where, with the link itself masked.
  - `apps/api/test/token-leak.e2e.test.ts` covers send and a replayed send, view, the document
    before and after consent, adopt, submit and submitting again, a reminder and the replaced link,
    the per-link rate limit, decline, and links that were never issued. It searches everything handed
    to a logger, every response body and header, every row of every table, and every Redis key and
    value.
  - `apps/web/e2e/token-leak.spec.ts` does the same through the real screens, against the API and
    worker running as real processes. It searches their log files, which include one line per HTTP
    request, as well as the database, Redis, and the `Referer` header of every request the signing
    pages make.
  - Both check first that they found something to search, so neither can pass on an empty log,
    table or cache. Both were shown to fail when a token was planted in each of these places.

### Fixed

- **A signature, decline or link could commit against an envelope that had just closed.** Consent,
  adopt, submit, decline and the invitation mailer checked the envelope only through a relation
  filter, which takes no lock. They now lock the envelope row first
  (`apps/api/src/prisma/envelope-locks.ts`), which also enforces the deadline at commit time, not
  only when the link was checked.
- **Sealing could complete a cancelled envelope.** A stamping round and the final seal now check the
  envelope again under a row lock just before they commit, after the storage work.
- **A person could not be invited again for a day** once an invitation had been skipped: the job id
  was the recipient alone. It now includes when their turn began.
- The sender's reminder button now applies the server's rule that a signature not yet stamped keeps
  the turn, so it is no longer offered for someone the server would skip.
- The "Sent. We are emailing…" notice no longer reappears when a finished envelope's page is
  reloaded.
- nodemailer rewrote attachment objects as it encoded them. The transport now hands it copies.
- **Browser tests no longer touch the developer's setup.** They used to reuse the running `pnpm dev`
  server, so each run wrote test accounts into the dev database and, once `.env` was switched to
  Gmail SMTP, sent real welcome, invitation and reminder emails to made-up addresses, which bounced.
  - Playwright now builds and starts its own isolated stack (`apps/web/e2e/stack`): API, worker and
    web app on ports 4100 and 5174, the `digitalsign_test` database, Redis database 2, file-only
    email in `apps/web/.e2e/outbox`, and logs in `apps/web/.e2e/logs`.
  - The stack refuses to start unless the database is a `*_test` one, email is not SMTP and Redis is
    not database 0.
  - `ENV_FILE=none` makes the API, the worker and the Prisma CLI skip `.env`, so no developer setting
    can leak into a run.
  - The environment check now refuses `MAIL_TRANSPORT=smtp` whenever `NODE_ENV=test`.
  - The web app is served as a production build, so a source change cannot reload a page in the
    middle of a test. That was the cause of occasional blank pages.
  - CI no longer starts `pnpm dev` for the browser tests.
- **The document viewer now fits the page to the screen.** Its resize observer was set up before the
  document had loaded, when there was nothing to observe, so pages kept a width guessed at the first
  render: too narrow on a phone, and never refitted when the window was resized.
- **`vite build` from a plain shell now makes a production build.** Vite took `NODE_ENV=development`
  from the root `.env`, which belongs to the API, and bundled development React: 124 KB instead of
  69 KB gzipped for the main chunk. The web app no longer has Vite load any `.env` file (it uses no
  `VITE_` variables), and `vite.config.ts` reads `API_PORT` and `WEB_PORT` from the root `.env` by
  hand. The browser tests and CI already set `NODE_ENV=production` and were not affected.

### Security

- Logs now redact `rawToken`, `signingUrl` and `SIGNING_TOKEN_SECRET` wherever they appear as keys.
- `/download/<token>` is scrubbed from every logged URL, message and stack trace, like
  `/sign/<token>`, and `downloadUrl` is a redacted key. Download responses send `Cache-Control:
  no-store` and `Referrer-Policy: no-referrer`, and their problem details never echo the token.
- Browser error reports have their stack trace scrubbed before logging. Previously only the message
  and URL were, and a stack from the signing page would have carried the token.
- The signing-link pattern in the scrubber stops at `:` and `)`, so a scrubbed stack frame keeps its
  line and column numbers.
- **The signing token no longer leaves the browser in error reports.** The web app masks
  `/sign/<token>` in the page URL, message and stack before sending a report, as well as the server
  scrubbing it on arrival.
- **No Referer carries the link.** `index.html` sets `strict-origin`, so no page's path is sent from
  the very first request, and the signing page switches to `no-referrer`. Signer API requests also
  send no cookies and no Authorization header, and bypass the HTTP cache.

### Changed

- The builder's signing-order checkbox is now a **Signing order** choice between *Everyone at once*
  and *One after another*, each with a one-line explanation of who is emailed when. With *One after
  another*, each person has Move up and Move down buttons. The review screen names the order, for
  example "One after another: Raj Patel, then Priya Sharma".
- **The web app loads in two parts.** The signer portal and the sender app are separate chunks, and
  the sender's session is restored only in the sender app, so a signer's phone never downloads the
  sender pages or calls `/auth/refresh`. In a production build a signer loads about 131 KB of
  JavaScript (gzipped) before the document and 143 KB with it, plus PDF.js, within docs/09's
  150 KB budget. Before, everyone loaded one 339 KB bundle that included PDF.js.
- On screens narrower than 640 px, the viewer toolbar leaves out First page, Last page and the
  separate Fit Width button (the zoom menu has Fit Width), so it fits across a phone.
- API request ids fall back to `crypto.getRandomValues` where `crypto.randomUUID` is missing, which
  is the case on plain HTTP away from localhost, such as a phone testing against a laptop.
- New `danger` button style, for Decline.
- **Browser tests for iPhone 14 now run on WebKit**, the engine of Safari on iOS, instead of
  Chromium dressed as an iPhone. CI installs WebKit and runs the signing tests and the leak audit on
  it, as well as every test on desktop Chrome.
- **The specification now describes Phase 3 as built.** Doc 03: `VIEWED` is a recipient status
  only, there is no `DELIVERED` step, links are created by the worker, and the next signer is invited
  on submit. Doc 05: the new columns and CHECK constraints. Doc 08: send, remind, every signing
  route, the link check order, and the new error codes. Doc 09: the consent gate, guided
  navigation, signature capture, the saved draft, and every end screen, including the new "this
  link does not work" screen for replaced links. Doc 10: worker minting, revocation by state, the
  handling rules and the leak audit.
- The browser-test stack logs at `debug` by default, so the leak audit searches every line the API
  and worker could write. `E2E_LOG_LEVEL` still overrides it.

## [0.2.0] - 2026-09-18

Phase 2 (Field Builder): recipients, fields placed on the page as ratios, autosave, and a review
screen. See [docs/13-phase-2-field-builder-plan.md](docs/13-phase-2-field-builder-plan.md).

### Added

- `@envelope/shared` coordinates module (`coordinates.ts`), the single place field geometry is
  converted, with 47 unit tests. Both the browser and the server import it; nothing else may do
  this arithmetic (ADR 0002).
  - Conversions: pixels ↔ ratios, points ↔ ratios, ratios → PDF points with the Y axis inverted and
    re-anchored to the bottom-left corner, and aspect-preserving image fitting.
  - Geometry: 6-decimal rounding, 4pt snapping, clamping to the page, per-type minimum sizes (a
    checkbox stays square rather than being forced to 40×15pt) and alignment guides.
  - `validateRatios` returns the same `RATIO_OUT_OF_RANGE` / `FIELD_EXCEEDS_PAGE` codes the API and
    the database use, so a box the builder marks red is one the server would reject.
  - Tests cover the round trip, Y inversion at the top, middle and bottom of a page, A4, US Letter
    and a rotated page, the 0 and 1 boundaries, and **zoom independence**: the same box gives
    identical ratios at 100%, 125%, 200% and 300%.
- `@envelope/shared` draft schemas (`draft.ts`): recipients, fields and envelope settings, plus
  `checkReadyToSend`, which the review screen and the Phase 3 send endpoint both use.
- New limits: 50 recipients and 1000 fields per envelope, and a 2000-character message.
- New error codes: `RECIPIENT_EMAIL_TAKEN` (409) and `DRAFT_REVISION_MISMATCH` (412).
- Draft recipients and fields in the database:
  - `Recipient.tokenHash` and `tokenExpiresAt` are nullable, because a recipient added while
    preparing a draft has no signing token until the envelope is sent (Phase 3).
  - `Recipient` gains `colorIndex` and `createdAt`, and one email may appear only once per envelope.
  - `Envelope` gains `message` and `draftRevision`.
  - A composite foreign key on `DocumentField(recipientId, envelopeId)` makes the database refuse a
    field whose recipient belongs to another envelope (docs/05, invariant 4).
- Draft editing endpoints: `PATCH /envelopes/:id`, `POST`, `PATCH` and `DELETE`
  `/envelopes/:id/recipients[/:recipientId]`, and `PUT /envelopes/:id/fields`, which replaces the
  whole layout in one transaction.
  - Every change first claims the draft in a single statement that checks the tenant, checks the
    envelope is still a draft, checks the caller's `If-Match` revision and bumps it. A stale
    revision is refused with 412 instead of overwriting another tab's work.
  - Pixel coordinates are answered with `INVALID_COORDINATE_SPACE` and the offending path, before
    zod turns them into a generic validation error. Positions are then checked with the shared
    `validateRatios`, so the API refuses exactly what the builder marks red.
  - One bad field rejects the whole request, leaving the saved layout untouched.
  - Changing someone to a CC or VIEWER removes their fields in the same transaction and reports how
    many went.
  - An unchanged layout writes nothing at all: no audit row, no revision bump, so autosave cannot
    flood the audit chain.
  - New audit actions `ENVELOPE_UPDATED`, `RECIPIENT_ADDED`, `RECIPIENT_UPDATED`,
    `RECIPIENT_REMOVED` and `FIELDS_SAVED`. Their metadata holds ids, counts and a layout hash, and
    never a name, an email or a message: the audit trail cannot be edited afterwards.
- `GET /envelopes/:id` now returns recipients, fields, the message, the signing order and the draft
  revision.
- Tenant scoping extended to `Recipient` and `DocumentField`, filtered through their envelope.
  `findUnique`, `update` and `delete` on those models are refused outright, because a unique `where`
  cannot carry the filter.
- The JSON body limit is 1 MB (Express defaults to 100 kB; 1000 fields is about 250 kB).
- `PdfViewer` can draw an overlay on each page: a `renderPageOverlay` prop receives the page's size
  in points and in CSS pixels, plus the pixels-per-point scale, and renders inside the page box.
  `onPageChange` and a `jumpToPage` ref handle come with it.
  - The page's border became a ring and the canvas takes its CSS size from the same calculation the
    wrapper uses, so the canvas, the page and an overlay describe exactly the same rectangle. The
    two copies of that calculation are now one function.
  - The window arrow-key handler stands aside when the event was handled inside an overlay, so
    nudging a field does not also turn the page.
- Browser tests for the builder (desktop Chrome, Pixel 7 and iPhone 14 sizes): place fields for two
  people across pages and reload to find them unmoved; **identical stored ratios whether the work is
  done at 100% or 200%**; correct placement on a landscape page and a page rotated 90°; arrow keys
  nudging a field without turning the page; and a role change to copy-only removing that person's
  fields. A mixed-page fixture PDF was added for the rotation case, and the sign-up and upload steps
  moved into shared helpers.
- Tests: 26 e2e cases covering the endpoints, every validation code, stale revisions, a sent
  envelope, cross-tenant 404s on every new endpoint, audit-chain verification, and checks that no
  name or email reaches a log or the audit trail in clear.

## [0.1.0] - 2026-09-17

Phase 1 (Foundation): accounts, hardened PDF upload with a SHA-256 fingerprint, a tamper-evident
audit trail, email through a background worker, and a web app with a PDF viewer. See
[docs/12-phase-1-foundation-plan.md](docs/12-phase-1-foundation-plan.md).

### Added

- pnpm workspace monorepo: `apps/*` and `packages/*`, Node 22, TypeScript 6 in strict mode.
- Biome 2 for linting and formatting (no ESLint or Prettier). NestJS parameter decorators are
  enabled, `dangerouslySetInnerHTML` is an error, and `console.log` is not allowed.
- `@digitalsign/shared` package: brand constants, upload and password limits, and the full error
  catalog (codes and HTTP statuses) from docs/08 plus the upload-hardening errors.
- Local infrastructure in `docker-compose.yml` (project name pinned to `digitalsign`, ports bound
  to 127.0.0.1): PostgreSQL 16 on 5545, Redis 7 on 6391 (AOF, `noeviction` for BullMQ), and MinIO
  on 9102 (S3 API) and 9103 (console), with `digitalsign-documents` and `digitalsign-test` buckets.
- Postgres init script: creates the restricted runtime role `digitalsign_app` and the
  `digitalsign_test` database.
- `.env.example` documents every variable, including Gmail SMTP with an App Password. There is no
  Mailpit.
- Database schema (Prisma 7 with the `pg` driver adapter) following docs/05, plus `Tenant`,
  `Session` (refresh-token rotation) and `User.role`. All ids are native `uuid` columns.
  Migrations run as the schema owner (`DIRECT_DATABASE_URL`).
- Initial migration with hand-written invariants:
  - field ratio range and stay-on-page CHECKs;
  - positive page numbers, routing orders and page counts;
  - at most one final `DocumentVersion` per envelope;
  - audit hashes must be 64-character hex.
- Runtime role grants: `digitalsign_app` gets CRUD on every table, but only SELECT/INSERT on
  `AuditTrail`. It has no access to the migration ledger.
- AuditTrail foreign keys use `RESTRICT` on delete and update. Postgres runs cascades as the table
  owner, so docs/05's `CASCADE`/`SET NULL` would have let the app remove or rewrite audit rows.
- NestJS 12 API foundation (`apps/api`), served under `/api/v1`, with Swagger UI at `/api/docs`
  (off by default in production).
- Startup config check (zod): the API refuses to boot with a missing or weak setting. Error messages
  name the variable, never its value.
- Structured logging with pino:
  - One line per request: method, route pattern, status, duration, IP, user agent and error code.
    4xx is logged as `warn`, 5xx as `error`.
  - `X-Request-Id` is accepted or generated, returned on every response, and included in every log
    line and error body.
  - Daily-rotated JSON files: `logs/api.<date>.<n>.log`, plus `logs/api-error.<date>.<n>.log` for
    errors only (14 files kept by default).
  - Readable single-line console output in development.
  - Passwords, tokens, cookies, `Authorization` headers, secrets, signing links and URL credentials
    are redacted. A unit test fails if any of them leaks.
  - Also logged: startup config summary (no secrets), dependency checks, slow queries (over
    `DB_SLOW_QUERY_MS`), Redis connection problems (throttled), rate-limit hits, graceful shutdown,
    and fatal crashes. Buffered log lines are flushed before the process exits.
- RFC 7807 `application/problem+json` for every error, built from the shared error catalog.
  Unexpected errors hide their detail from the client and are logged with a stack trace.
- `GET /api/v1/health` (Postgres and Redis, 503 when degraded) and `GET /api/v1/health/live`.
- `POST /api/v1/client-logs`: browser error reports go into the server logs. Limited to 20/min per
  IP and 8 KB per report.
- Global rate limit of 300 requests/min per IP, plus helmet security headers, cookie parsing and
  optional CORS.
- Sender accounts:
  - `POST /api/v1/auth/register` creates a workspace (tenant) and its owner. Limited to 10/hour per
    IP.
  - `POST /api/v1/auth/login` (limited to 10/min per IP), `refresh`, `logout`, and `GET me`.
  - Passwords are hashed with Argon2id (19 MiB, t=2, p=1, OWASP parameters). Old hashes are
    upgraded on login. Unknown emails take the same time and get the same error as wrong
    passwords.
  - Access tokens are 15-minute HS256 JWTs, kept in memory by the browser. Every route requires one
    unless it is marked `@Public()`, and the token's session must still be active.
  - Refresh tokens are 32 random bytes in an httpOnly, SameSite=Strict cookie scoped to
    `/api/v1/auth`. Only an HMAC of the token is stored, and it is rotated on every use.
  - Reusing an old refresh token revokes every session from that login. A 30-second grace window
    lets two tabs refresh at once without logging the user out.
  - Auth events are logged: registration, login success or failure (with the reason), refresh,
    token reuse (warn), logout, and invalid tokens. Emails are partly masked. User and tenant ids
    are attached to the rest of each request's log lines.
- End-to-end test suite (`pnpm --filter @digitalsign/api test:e2e`):
  - Runs against the `digitalsign_test` database, Redis db 1 and the `digitalsign-test` bucket,
    with in-memory email.
  - The schema is applied with `prisma migrate deploy`, and tables are emptied between suites.
    Prisma refuses `migrate reset` when an AI agent runs it, and deploy never drops anything.
  - Tests check what was logged and that no password or token ever reached a logger.
- Document upload (`POST /api/v1/envelopes`, multipart `file` plus optional `title`), following the
  docs/10 upload-hardening pipeline:
  - Size is checked from Content-Length before the body is read, then again by multer (25 MB).
  - The content must start with `%PDF-`. File names and Content-Type are never trusted.
  - Damaged and password-protected PDFs are rejected, as are PDFs with more than 500 pages.
  - Malware scanning sits behind an interface. For now it is a pass-through that logs clearly that
    no scanning happens.
  - Active content is removed: JavaScript, Launch/Submit/Import/remote actions, automatic
    additional actions, embedded files, file attachments and XFA. Web links are kept. Clean files
    are stored byte-for-byte as uploaded.
  - Each step is logged at debug level, and the outcome at info or warn. File names and titles are
    never logged.
  - Uploads are limited to 20 per minute per tenant.
- Envelopes:
  - A draft envelope, DocumentVersion 0 (SHA-256, page count, size) and an `ENVELOPE_CREATED` audit
    event are created in one transaction. If that transaction fails, the stored file is deleted
    again.
  - Documents are stored in S3/MinIO under `tenants/<tenant>/envelopes/<id>/v0-<uuid>.pdf`.
  - `GET /api/v1/envelopes` (newest first, cursor pagination), `GET /:id` (with versions and audit
    trail) and `GET /:id/file?version=` (streamed PDF).
- Tenant isolation: a Prisma extension adds the signed-in tenant to every envelope query and
  refuses to run a query without one or to write another tenant's rows. Other tenants' ids, and
  malformed ids, get the same 404 as ids that do not exist.
- Hash-chained audit trail:
  - `eventHash = SHA-256(prevHash | action | timestamp | canonical payload)`.
  - A per-envelope `sequence` column (second migration) and an advisory lock keep the chain in
    order.
  - `AuditService.verify()` reports the exact broken event and logs it with `alert: true`. A failed
    audit write is also logged as an alert.
- `/health` now also checks object storage.
- Tests: a 12-page upload whose download's SHA-256 matches, sanitising (checked by an independent
  PDF inspector), each rejection path, a 26 MB upload, tenant isolation, cursor paging, the
  per-tenant upload limit, and that the app role cannot update, delete or truncate audit rows.
- Email through a BullMQ queue and a separate worker process (`apps/api/src/worker.ts`):
  - The API only adds jobs. The worker renders and sends them over real SMTP (Gmail by default)
    with pooled connections and required STARTTLS.
  - At startup the worker checks the SMTP login and logs a clear error for bad credentials (for
    example Gmail's 535 "Username and Password not accepted", with a reminder that Gmail needs an
    App Password). The password is never logged.
  - Failed sends are retried 5 times with exponential backoff (10s, 20s, 40s, 80s). Each retry is
    logged as `warn`, and a job that fails permanently is logged as `error` with `alert: true`.
  - Every log line written during a job carries the job id and the id of the API request that
    queued it, so API and worker logs can be matched.
- Welcome email on sign-up. It is branded, every user-supplied value is HTML-escaped, and there is
  one per user (idempotent job id). If the queue is unavailable, registration still succeeds and
  the failure is logged as an error.
- `MAIL_TRANSPORT=memory` keeps sent messages in memory for tests, so no real email is sent.
  `QUEUE_PREFIX` and `EMAIL_RETRY_BASE_DELAY_MS` are configurable.
- `pnpm --filter @digitalsign/api dev` now compiles once and runs the API and the worker together.
  `start:worker` runs the built worker.
- Tests: an e2e suite runs the real worker in the test process and covers delivery, request-id
  propagation, retries, permanent failure alerts and a queue outage during sign-up. A unit test
  covers the template and its HTML escaping.

- Sender web app (`apps/web`): React 19, Vite 8, Tailwind CSS 4, React Router and TanStack Query.
  - `lib/api.ts`: the access token is kept in memory, `X-Request-Id` goes out with every call, a
    401 triggers one silent refresh shared between callers, problem+json bodies become `ApiError`,
    and uploads report progress.
  - `lib/auth.tsx`: the session is restored from the refresh cookie on load; cached data is cleared
    on logout.
  - `lib/logger.ts`: browser errors from the error boundary, `window.onerror` and
    `unhandledrejection` are reported to `POST /client-logs`, de-duplicated and capped, with query
    strings stripped from URLs.
  - Pages: `/login`, `/register`, `/dashboard` (infinite list, empty state), `/dashboard/new`
    (drag and drop, PDF and 25 MB checks before upload, progress bar) and
    `/dashboard/envelopes/:id` (fingerprint with copy button, versions, audit timeline, viewer,
    download).
  - `components/pdf/PdfViewer`: pdf.js 6 with pages rendered only near the screen, high-DPI canvases
    capped for mobile GPUs, fit-width plus 50–200% zoom, focal-point wheel and pinch zoom, page
    navigation and keyboard shortcuts.
  - Branding: logo, favicon, page titles and placeholder brand colours.
- Playwright tests (`apps/web/e2e`): sign-up, login and logout; and upload → 12 pages rendered →
  zoom, on desktop Chrome and at Pixel 7 and iPhone 14 sizes.

### Changed

- The product is now **Envelope by HealthProHub** (previously "Digital Sign"). The workspace
  packages are `@envelope/api`, `@envelope/web` and `@envelope/shared`. Infrastructure identifiers
  keep the old name on purpose: the `digitalsign_app` role, the `digitalsign` Compose project, the
  bucket names and the `urn:digitalsign:error:` problem type.
- Documentation: ADR 0012 records the NestJS + React/Vite and Biome decisions, docs 03 and 04 point
  at it, the docs index drops links to a HealthProHub integration folder that was never written,
  and the repository README now covers setup, commands, logging and the naming rule.
- Continuous integration: GitHub Actions runs Biome, typecheck, unit tests, a migration drift
  check, the API e2e suite, Playwright and the build. Services come from `docker compose`, because
  Postgres needs the repository's init script.
  - A `digitalsign_shadow` database is created for Prisma. The drift check compares the migration
    folder with `schema.prisma` and fails on any difference. `SHADOW_DATABASE_URL` configures it.
  - CI starts the app and waits for the API's health endpoint before Playwright runs, because Vite
    answers long before the API has compiled and the first test signs up immediately.

### Fixed

- The builder reloaded its own saved layout after every autosave, which cleared the selection and
  stopped the arrow keys working mid-edit. A save now records its own result as already loaded.
- Arrow keys nudged the selected field *and* turned the page, because the viewer's key handler runs
  before the builder's. The builder now listens in the capture phase.
- Playwright waits for the API's health endpoint before the first test: Vite answers within a second
  or two while the API is still compiling, and the first test failed with a proxy error.
- `pnpm-lock.yaml` still referred to `@digitalsign/shared` after the package rename, so
  `pnpm install --frozen-lockfile` failed. The lockfile is regenerated.
- `pnpm lint` failed on the web app. Biome now parses Tailwind CSS directives (`@theme`,
  `@apply`), the favicon has a `<title>`, and two files are formatted.
