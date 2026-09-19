# Phase 3: Signer Portal Plan

| | |
|---|---|
| **Status** | In progress |
| **Version** | 0.1.0 |
| **Last updated** | 18 September 2026 |
| **Audience** | Everyone (Part 1) · Developers (Part 2) |
| **What this doc answers** | What does Phase 3 deliver, how is each part built, and how do we check it? |

---

# PART 1: In Plain Terms

## What Phase 3 Is

Phase 3 is the **signer portal**: weeks 5–6 of the roadmap in
[11-implementation-roadmap.md](11-implementation-roadmap.md). Phase 2 let a sender prepare a document.
Phase 3 lets them **send it**, and lets the people on it **sign it**.

```
   SEND ────────────► the sender presses Send; each signer gets an email with a private link
   AGREE ───────────► the signer opens the link and agrees to sign electronically
   GUIDE ───────────► a Next button walks them from box to box
   SIGN ────────────► they draw or type their signature, fill the boxes, and tap Finish
   DECLINE ─────────► or they say no, with a reason, and the sender is told at once
   TRACK ───────────► the sender sees who has opened and signed, and can send a reminder
```

The signature is captured and stored, but **not yet stamped into the document**. Stamping, the
certificate page and the finished file are Phase 4.

## What You Can Do at the End of Phase 3

1. Open a prepared document, choose **Send for signing**, and confirm.
2. The first signer gets an email. They open it on a phone, tick "I agree to sign electronically", and
   see the document with their boxes highlighted.
3. They tap **Next** to go from box to box, draw or type their signature once, and tap **Finish**.
4. If the sender chose "one after another", the next person gets their email only now. Otherwise
   everyone got theirs at the start.
5. Anyone can **decline** instead. The document stops, and the sender gets an email.
6. The sender's envelope page shows each person as *waiting*, *email sent*, *opened*, *signed* or
   *declined*, with a **Send reminder** button.
7. A signing link works for one person, for one document, until they finish. After that it only
   says "you have already signed".

## Why the Link Is the Risky Part

Signers do not have accounts. The link in their email *is* their identity: anyone holding it can open
the document and sign. So the link is treated like a password:

- **We never store it.** The system keeps only a scrambled fingerprint of it, and checks a link by
  scrambling it again and comparing.
- **It is created at the last possible moment**, inside the step that sends the email, and forgotten
  straight after. It never sits in a queue or a database waiting to be sent.
- **It never appears in a log.** Every log line, error report and audit entry is checked for it by an
  automated test.
- **It stops working** when the person finishes, when anyone declines, and when the document expires.
  A reminder email carries a fresh link, and the old one stops working.

[ADR 0009](adr/0009-store-only-the-hmac-of-signing-tokens.md) records these decisions.

## The Consent Notice Is a Placeholder

Before signing, the signer must agree to sign electronically. The exact wording is a legal matter,
and doc 11 says **we must not write it ourselves**. Until your lawyer's wording arrives, the signing
screen shows placeholder text that begins **"DRAFT — not legally reviewed"**. It lives in one file and
is swapped for the approved text with a one-line change. The exact text each signer saw is stored
with their agreement, so records made before the swap still show what was on screen at the time.

## The Phase 3 Finish Line

From doc 11, Phase 3 is finished when:

- [ ] a signing email is received on a real iPhone, opened, agreed to, signed with a drawn
      signature, and submitted;
- [ ] the values are saved, the link no longer works, and the audit events are written;
- [ ] the signing link appears nowhere in any log or trace.

## Progress

| # | Step | Status |
|---|---|---|
| 1 | This plan and ADR 0009 | ✅ Done |
| 2 | A clearer signing-order choice, with reordering | ✅ Done |
| 3 | Database and shared rules for signing | ✅ Done |
| 4 | Signing links: creating, checking and hiding them | ✅ Done |
| 5 | Sending, invitation emails and signing order | ✅ Done |
| 6 | The signer's side of the API | ✅ Done |
| 7 | Reminders, and progress for the sender | ✅ Done |
| 8 | Send dialog and progress screen | ✅ Done |
| 9 | The signing screens | ✅ Done |
| 10 | Browser tests and the link-leak audit | ✅ Done |
| 11 | Real-phone check, documentation and release `v0.3.0` | 🟡 Documentation done; phone check and release to come |

## What We Need From You

| Needed | Why | When |
|---|---|---|
| Lawyer-approved consent wording | Replaces the draft placeholder | Before any real contract is signed |
| A real iPhone and an Android phone | The Phase 3 finish line is a real-iPhone test | Step 11 |
| The Gmail App Password check from Phase 1 | So real invitation emails arrive | Before step 11 |
| HealthProHub logo and brand colours | Emails and the signing screen still use placeholders | During Phase 3 |

---
---

# PART 2: Technical Detail

> Written for developers. Non-technical readers can stop here.

## Decisions Made Before Starting

| Question | Decision |
|---|---|
| Consent wording | Draft placeholder in `apps/api/src/signing/consent-text.ts`, prefixed "DRAFT — not legally reviewed". The verbatim text is stored on consent (doc 07). |
| Who is emailed at send | `sequentialSigning` false: every SIGNER and APPROVER at once. True: the lowest `routingOrder` group; the next group once every SIGNER and APPROVER in the current group has signed. |
| SMS one-time code | Out of scope. Not on the Sprint 5–6 checklist; doc 01 open question 2. |
| VIEWER and CC | Not emailed in Phase 3. They receive the completed copy in Phase 4. |

## ADR 0009: Signing Tokens

[ADR 0009](adr/0009-store-only-the-hmac-of-signing-tokens.md) settles four points the spec leaves open
or contradicts:

1. **Minted in the email worker.** The job carries `{ recipientId, kind }` only. The worker creates
   `randomBytes(32)` hex, stores `HMAC-SHA256(SIGNING_TOKEN_SECRET, raw)` in `Recipient.tokenHash`,
   renders `${APP_URL}/sign/${raw}` into the email, sends it, and drops the raw value. The raw token
   is never in Redis, Postgres, a log or the API process.
2. **Reminders rotate the token.** There is no stored raw token to resend, so a reminder mints a new
   one and the previous link stops resolving.
3. **Revocation is by state.** Doc 10 says decline and void null the hash. Kept instead, so that the
   410 "already signed" and 409 "cancelled" screens of doc 09 can be shown. Decline and void move the
   envelope to a terminal status in the same transaction, which blocks every token on it at once.
4. **One check order** in the Token Guardian: unknown → `TOKEN_INVALID` 401; envelope `DECLINED` or
   `VOIDED` → `ENVELOPE_TERMINAL` 409; signed → `TOKEN_ALREADY_USED` 410; expired →
   `TOKEN_EXPIRED` 401.

## Other Spec Gaps Resolved

| Spec says | Built as | Why |
|---|---|---|
| `GET /sign/:token` returns `documentUrl` while `consentRequired` is true (doc 08) | Fields and the document are withheld until consent; `GET /sign/:token/document` returns 403 `CONSENT_REQUIRED` before it | Doc 07 and doc 09: the gate is a server-side precondition, not a UI overlay |
| Submit carries a data URL per signature field (doc 08) | `POST /sign/:token/adopt` stores one image per kind; submit fills every SIGNATURE and INITIALS field from it | Doc 07 requires Adopt & Sign and Finish to be audited separately, and the body stays under the 1 MB limit |
| Consent stores the verbatim text (doc 07) | The request also sends a SHA-256 of the text it displayed; a mismatch returns 409 `CONSENT_TEXT_CHANGED` | The stored text must be the text the signer saw, even if the wording changes mid-session |
| Envelope-level `VIEWED` state (doc 03) | `VIEWED` is a recipient status only | The `EnvelopeStatus` enum in doc 05 has no `VIEWED` |
| Advance to the next signer on version creation (doc 03, Sprint 7–8) | Advance on submit | There is no version creation until Phase 4, which moves the trigger |
| `SENT → DELIVERED` via a mail-provider webhook | Not implemented | Gmail SMTP has no delivery webhook |

## Step 2: Signing-Order Choice

`RecipientPanel` replaces the checkbox with a **Signing order** choice: *Everyone at once* or *One
after another*, each with a one-line explanation. With *One after another*, the list is numbered and
each person has Move up and Move down buttons, which swap `routingOrder` through the existing
`PATCH /envelopes/:id/recipients/:recipientId`. The review screen summarises the order by name.

## Step 3: Database and Shared Module

| Change | Reason |
|---|---|
| `Envelope.sentAt` | When the envelope left `DRAFT` |
| `Recipient.invitedAt`, `notifiedAt`, `lastRemindedAt`, `viewedAt`, `declinedAt` | Progress for the sender, and the 24-hour reminder limit |
| `Recipient.signatureImageKey`, `signatureMethod`, `initialsImageKey`, `initialsMethod`; enum `SignatureMethod { DRAWN, TYPED }` | The adopted images, and how each was made (doc 00: "how they signed") |
| CHECK: `SIGNED` ⇒ `signedAt` and `tokenUsedAt` set | A signed recipient always has evidence and a spent token |
| CHECK: `DECLINED` ⇒ `declinedReason` set | Doc 03: decline requires a reason |
| CHECK: `consentGivenAt` and `consentText` both set or both null | Consent is never recorded without its text |

`packages/shared/src/signing.ts` adds the request schemas (send, remind, consent, adopt, submit,
decline), the session types, `SIGNING_TOKEN_PATTERN`, `orderFieldsForSigning` (page, then `ratioY`,
doc 09) and the routing-group helpers. New limits and error codes go in `limits.ts` and `errors.ts`.

## Step 4: Token Service and Redaction

`apps/api/src/signing/signing-token.service.ts` provides `mint`, `hash`, `ref` (an 8-character hash
prefix, the only form allowed in logs) and `resolve`. Public routes use the raw `PrismaService`,
because the tenant client requires a signed-in tenant; `resolve` sets the CLS `tenantId` once the
token is known, so later log lines carry it.

New settings: `SIGNING_TOKEN_SECRET`, `SIGNING_DEFAULT_EXPIRY_DAYS`, and `MAIL_TRANSPORT=file` with
`MAIL_OUTBOX_DIR` for browser tests (refused in production). The redaction list gains `rawToken` and
`signingUrl`, and the client-log endpoint scrubs stack traces.

## Step 5: Sending

| Method | Route |
|---|---|
| POST | `/envelopes/:id/send` |

- Requires `Idempotency-Key`. The response is kept in Redis for 24 hours per tenant and key; a replay
  returns it with `Idempotency-Replayed: true`, and the same key with a different body returns 422.
- One transaction locks the draft, runs `checkReadyToSend` on database data, sets `SENT`, `sentAt`
  and `expiresAt`, marks the first routing group `SENT`, and writes `ENVELOPE_SENT`.
- Invitation jobs are queued after commit. The worker checks that the envelope and recipient are still
  active, mints the token, sends, sets `notifiedAt` and writes `EMAIL_SENT`.

## Step 6: Signer API

| Method | Route | Audit |
|---|---|---|
| GET | `/sign/:token` | `ENVELOPE_VIEWED` on first view |
| GET | `/sign/:token/document` | — |
| POST | `/sign/:token/consent` | `CONSENT_GIVEN` |
| POST | `/sign/:token/adopt` | `SIGNATURE_ADOPTED` |
| POST | `/sign/:token/submit` | `RECIPIENT_SIGNED` |
| POST | `/sign/:token/decline` | `RECIPIENT_DECLINED` |

- All routes are public, send `Cache-Control: no-store` and `Referrer-Policy: no-referrer`, and are
  rate-limited per token rather than per IP (doc 08): 60 reads and 10 writes a minute.
- Adopted images must be PNG with an alpha channel and at most 500 KB. They are stored at
  `tenants/{t}/envelopes/{e}/signatures/{recipientId}/{kind}-{uuid}.png`.
- Submit claims the recipient with a guarded update, checks that every field belongs to them, and
  discards any client value for `DATE_SIGNED`. It returns 202, because sealing is asynchronous.
- Decline is allowed before consent and ends the envelope.

## Step 7: Reminders and Progress

`POST /envelopes/:id/remind` reminds everyone whose turn it is and who has not signed, at most once
per recipient per 24 hours; a recipient whose invitation was never delivered is exempt. The worker
rotates the token. The envelope detail response gains each recipient's progress.

## Steps 8 and 9: Web

The review screen's **Send for signing** opens a confirm dialog that names who is emailed now. The
envelope page shows recipient progress and a reminder button.

The signer portal lives in `apps/web/src/features/signing/`, on a lazy-loaded `/sign/:token` route
outside the sender's `AuthProvider`. PDF.js loads only after consent. Draw uses `signature_pad` at a
device pixel ratio of at least 2; Type renders self-hosted script fonts through the same canvas, so
both produce the same transparent PNG. The canvas sets `touch-action: none` and cancels `touchmove`
for iOS Safari. Text and checkbox values are kept in `localStorage` until submit.

### Step 9 as built

| File | What it does |
|---|---|
| `main.tsx`, `SenderApp.tsx` | Two lazy chunks behind one router: `/sign/:token` and everything else. Only the sender app mounts `AuthProvider`. |
| `SigningPage.tsx` | Loads the session, shows consent or the document, and turns every refusal into an end screen. A malformed token never reaches the server. |
| `ConsentScreen.tsx` | The notice as sent, the tick box, and the agreement with the notice's hash. |
| `SigningWorkspace.tsx` | Lazy: the document, the boxes, the Next/Finish bar, the sheets, the draft. PDF.js is in this chunk, so it loads only after consent. |
| `SigningFieldLayer.tsx` | The signer's boxes over one page, positioned by ratio as percentages. |
| `AdoptSheet.tsx`, `SignaturePadCanvas.tsx`, `signature-image.ts` | Type or draw, then a transparent PNG cropped to the ink and kept under 500 KB. |
| `TextSheet.tsx`, `DeclineDialog.tsx`, `Sheet.tsx` | Text entry, decline, and the bottom sheet they share. |
| `signing-state.ts`, `drafts.ts`, `end-states.ts`, `signing-api.ts` | Progress and Next order, the saved draft, refusal → screen, and the API client with retries. |

Decisions made while building it:

| Question | Decision | Why |
|---|---|---|
| What the draft is keyed by | The signer's lowest field id, not a hash of the token (docs/09 says token hash) | The token is then never stored anywhere, and a reminder's new link still finds the draft |
| How text boxes are filled | In a sheet with a full-size input, not in the box | A box on a phone is often ~11px tall, and iOS zooms the page in on inputs under 16px |
| Signature boxes | Each box is tapped, and the adopted image goes into the tapped ones | The signer's intent is recorded box by box, as on paper; the server still fills every required one |
| Type or draw first | Type is the default tab | Typing is the keyboard-accessible path and must not feel secondary (docs/09) |
| Referrer | `strict-origin` in `index.html` for the whole app, `no-referrer` on the signing page | The first requests of a signing page load before any script runs. A global `no-referrer` would turn the sender's POST `Origin` header into `null` |
| Cookies on signer requests | `credentials: 'omit'` | A sender signed in on the same browser must not lend their session to a link |
| Retries | Adopt and submit retry transient failures after 1, 2 and 4 s; a submit answered 410 counts as done | docs/09, "Offline resilience" |
| Error reports | The web app masks `/sign/<token>` in URL, message and stack before sending | Belt and braces with the server's scrubbing |

Measured in a production build: before consent a signer loads ~131 KB of JavaScript (gzipped), ~143 KB
with the workspace, plus 132 KB of PDF.js, within the 150 KB budget.

## Step 10: Tests

- API e2e: send, idempotency, the consent gate, adopt validation, submit, decline, both signing
  orders, reminders and token rotation, expiry, rate limits and tenant isolation.
- **Token-leak audit:** after a full flow, the raw token must not appear in captured logs, log
  files, any database row, any Redis key or any error body.
- Playwright: draw and type signing, decline, draft restore and the already-signed screen, on
  desktop Chrome and on iPhone 14 **under WebKit**.

### Step 10 as built

The API cases were written with each API step, in `apps/api/test/signing.e2e.test.ts`. Step 10 added
the leak audit, in two places. Each one runs a full flow, collects every link that was emailed
(including links that a reminder replaced), and searches for them:

| Audit | Flow | Searched |
|---|---|---|
| `apps/api/test/token-leak.e2e.test.ts` | Send and a replayed send; view; document before and after consent; adopt both kinds; submit, then submit again; reminder; the replaced link, then its rate limit; decline; links that were never issued | Everything handed to a logger (before redaction); every response body and header; every row of every table; every Redis key and value |
| `apps/web/e2e/token-leak.spec.ts` | The same, through the real screens, with the API and worker running as real processes, logging at `debug` | Their log files, which include one line per HTTP request; the database; Redis; the `Referer` header of every request the signing pages make |

Each audit first checks that it has something to search. For example, the log files must contain
`/sign/[redacted]` request lines, and the database must contain the token's HMAC. So neither can
pass on an empty log, table or cache. Both were run once with a token planted in each place, and
failed each time. The failure names the place and shows an excerpt with the link masked.

The `mobile-iphone14` project now runs on WebKit. CI installs WebKit, runs every test on desktop
Chrome, and runs the signing tests and the audit on iPhone 14. Drawing is tested with mouse pointer
events. Real touch drawing is part of the step 11 phone check.

**Still to run locally:** the WebKit run. The development machine lacks WebKit's system libraries, and
installing them needs `sudo`
(`sudo pnpm --filter @envelope/web exec playwright install-deps webkit`). Desktop Chrome and Pixel 7
pass: 36 of 36.

## Open Points Found in Step 9

- ~~**Local `vite build` makes a development React build.**~~ Fixed after step 10. Vite took
  `NODE_ENV=development` from the root `.env`, which belongs to the API, so a build run from a plain
  shell bundled development React (124 KB instead of 69 KB gzipped for the main chunk). The web app
  now loads no `.env` file through Vite (`envDir: false`; it uses no `VITE_` variables), and
  `vite.config.ts` reads `API_PORT` and `WEB_PORT` from that file by hand.
- **The web host's access log will contain `/sign/<token>`.** The page's own URL is requested from
  whatever serves the web app. The production hosting config (Phase 5) must drop or scrub that path
  from access logs, and send `Referrer-Policy: no-referrer` for `/sign/*` as a header as well.

## Deliberate Simplifications

| Simplification | Planned fix |
|---|---|
| Consent wording is a draft placeholder | The lawyer's text, before real use |
| Signatures are stored, not stamped into the PDF; the envelope never reaches `COMPLETED` | Phase 4 |
| Later signers see the original PDF, not earlier signatures | Phase 4, a document version per signing round |
| VIEWER and CC are not emailed | Phase 4, completion emails |
| The expired-link screen says to contact the sender; there is no "request a new link" | Phase 5, with the expiry sweeper |
| Rate limits are held in memory; reminders are manual | Phase 5 |
| No SMS one-time code | Later, if required |
| No delivery confirmation | When a mail provider with webhooks is chosen |
