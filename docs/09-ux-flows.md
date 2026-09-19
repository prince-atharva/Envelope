# User Experience Flows

| | |
|---|---|
| **Status** | Draft for client review |
| **Version** | 1.0.0 |
| **Last updated** | 10 September 2026 |
| **Audience** | Everyone (Part 1) · Design and engineering (Part 2) |
| **What this doc answers** | What does each person actually see and do? |

---

# PART 1 — In Plain Terms

## Two Users, Opposite Needs

The platform has two completely different kinds of user, and designing for one at the expense of the other is the most common way these products fail.

**The sender** uses it constantly. They will send hundreds of documents. They want speed, shortcuts, and everything visible at once. Hand-holding slows them down and eventually annoys them.

**The signer** has never seen it before and will probably never see it again. They may be on a phone, on a train, in a hurry, with one bar of signal. They want to be told exactly what to do and then be finished.

Optimise the sender's screens for **repetition**. Optimise the signer's screens for **the very first time, forever**.

## The Sender's Journey

```
   1. UPLOAD          Drag the PDF in. It appears on screen.

   2. ADD PEOPLE      Type names and emails. Choose whether they
                      sign in order or all at once.

   3. PLACE THE BOXES Drag a signature box onto the page where it
                      belongs. Each person gets their own colour so
                      you can see at a glance who signs where.

   4. SET THE RULES   Deadline. Optional message.

   5. REVIEW          One screen showing exactly what will be sent
                      to whom.

   6. SEND            Done. The dashboard now tracks it.
```

Step 5 exists for one reason: sending a contract to the wrong person is embarrassing and cannot be undone. One deliberate pause before an irreversible action is worth the extra click.

## The Signer's Journey — The Critical Path

This is where documents are won or lost. Every extra step costs completed signatures.

```
   1. THE EMAIL       "Priya has sent you a document to sign."
                      One clear button.

   2. THE NOTICE      Confirm you are happy to sign electronically.
                      One tick box. (Legally required.)

   3. THE DOCUMENT    The contract, scrollable, with a clear
                      "Start" button pointing to the first box.

   4. THE SIGNATURE   Tap the box. Draw with a finger, or type
                      your name and pick a style.

   5. REVIEW          "You have completed 3 of 3 fields."

   6. FINISH          One button.

   7. DONE            "Signed. Your copy is on its way."
                      Download link right there.
```

Seven steps. Two of them are legally required and cannot be removed. The rest are as few as we could make them.

> **The rule that governs every design decision on this path:** if a step can be removed without breaking the law or the product, remove it. Signers abandon documents, and they abandon them at whichever step confuses them.

## Guiding Someone Through a Long Document

A signature box on page 34 of a 40-page contract is a real problem. Nobody scrolls looking for it, and if they cannot find it they give up.

So the system leads them. A floating button always shows what is left and jumps straight to the next thing:

```
   ┌──────────────────────────────────────┐
   │  ...contract text...                 │
   │                                      │
   │                                      │
   │              ┌────────────────────┐  │
   │              │  NEXT: Signature   │  │  ← always visible,
   │              │  1 of 3      ─────►│  │    jumps to the next
   │              └────────────────────┘  │    required box
   └──────────────────────────────────────┘
```

They never scroll hunting for anything. Tap, sign, tap, sign, finish.

## Signing on a Phone

Most people sign on phones, so this is the primary case rather than an afterthought.

When they tap a signature box, a panel slides up from the bottom — thumb-reachable, not stretched across the top of the screen.

```
   ┌─────────────────────────┐
   │                         │
   │   (document behind)     │
   │                         │
   ├─────────────────────────┤
   │   Draw your signature   │
   │  ┌───────────────────┐  │
   │  │                   │  │  ← draw with a finger
   │  │      ~~~~~~~      │  │
   │  │                   │  │
   │  └───────────────────┘  │
   │   [ Clear ]  [ Type ]   │
   │                         │
   │   [   Adopt & Sign  ]   │
   └─────────────────────────┘
```

Two details that matter more than they sound:

**The page must not scroll while they draw.** Getting this wrong on an iPhone means the document slides around under their finger and the signature is unusable. It needs specific handling and testing on real devices.

**Typing must be as good an option as drawing.** Drawing with a fingertip is genuinely awkward, and many people prefer to type their name and choose a handwriting style. Both produce an equally valid signature, and neither should feel like the lesser option.

## What Happens When Things Go Wrong

Every one of these needs a clear screen, not an error message.

| Situation | What they see |
|---|---|
| **They want to refuse** | A "Decline" option, always visible. They give a reason. The sender is told immediately. |
| **The link has expired** | A plain explanation and a button to request a new one. Not "401 Unauthorized". |
| **They already signed** | "You have already signed this document," with a download link. Not an error. |
| **The sender cancelled it** | "This document has been cancelled by the sender." |
| **Someone else declined** | "This document is no longer available for signature." |
| **They lost signal mid-signing** | Their work is held locally and restored when they return. |

The expired-link and already-signed cases deserve particular care. Both are completely normal, both happen often, and both are usually handled as technical errors — which makes an ordinary situation feel like something broke.

---
---

# PART 2 — Technical Detail

> Written for design and engineering. Non-technical readers can stop here.

## Sender Studio — Field Placement

The most technically delicate screen in the product.

```
┌──────────────────────────────────────────────────────────────┐
│  Consulting Agreement — Acme Corp          [Review] [Send]   │
├────────────┬─────────────────────────────────────────────────┤
│ RECIPIENTS │                                                 │
│            │   ┌───────────────────────────────────────┐     │
│ ● Priya  1 │   │  PAGE 4 of 12                         │     │
│ ● Raj    2 │   │                                       │     │
│ ○ Sam   CC │   │  ...the parties agree...              │     │
│            │   │                                       │     │
│ FIELDS     │   │  Client Signature:                    │     │
│ ┌────────┐ │   │  ┌───────────────┐  ┌──────────┐      │     │
│ │Signature│ │   │  │ ● Sign here  │  │ ● Date   │      │     │
│ ├────────┤ │   │  └───────────────┘  └──────────┘      │     │
│ │Initials│ │   │      ↑ Raj (blue)       ↑ Raj         │     │
│ ├────────┤ │   │                                       │     │
│ │  Date  │ │   └───────────────────────────────────────┘     │
│ ├────────┤ │                                                 │
│ │  Text  │ │      ◄  Page 4 of 12  ►      Zoom: [100% ▼]     │
│ └────────┘ │                                                 │
└────────────┴─────────────────────────────────────────────────┘
```

### Overlay architecture

```
   ┌─────────────────────────────────────┐
   │  Field overlay (absolute, z-index 2)│  ← draggable divs, pointer-events
   ├─────────────────────────────────────┤
   │  PDF.js canvas (z-index 1)          │  ← rendered page
   ├─────────────────────────────────────┤
   │  Page container (position: relative) │  ← positioning context
   └─────────────────────────────────────┘
```

The overlay MUST be dimensionally identical to the canvas and share its positioning context. Any padding, border, or margin between them introduces a constant offset that is invisible in review and systematically misplaces every field.

### The conversion chokepoint

```typescript
// Container dimensions come from the PDF.js viewport, NOT from
// getBoundingClientRect() on a wrapper — wrappers pick up padding,
// borders, and scrollbar width.
const viewport = page.getViewport({ scale });

const ratios = pixelsToRatios(
  { left: box.offsetLeft, top: box.offsetTop,
    width: box.offsetWidth, height: box.offsetHeight },
  viewport.width,
  viewport.height,
);
```

`pixelsToRatios` is imported from `src/lib/coordinates.ts` — the single implementation shared with the server. See [06-signing-and-document-sealing.md](06-signing-and-document-sealing.md).

**Zoom independence test:** place a field at 100%, change zoom to 200%, and the stored ratios must be byte-identical. Any drift means a pixel measurement leaked into the path. This belongs in the automated suite, not manual QA.

### Placement behaviour

| Behaviour | Specification |
|---|---|
| Drag from palette | Ghost preview follows the cursor; drops at the cursor position |
| Recipient colour | Assigned on add, consistent everywhere, WCAG AA against white |
| Snapping | 4pt grid; hold `Alt` to bypass |
| Alignment guides | Appear when edges align with another field within 3pt |
| Resize | Corner handles; minimum 40×15pt for a legible signature |
| Multi-select | Shift-click, drag as a group |
| Copy to page | Right-click → "Copy to all pages" for initials |
| Keyboard | Arrows nudge 1pt, Shift+arrows 10pt, Delete removes |
| Validation | Overflowing the page edge shows a red border and blocks send |

## Signer Portal

Optimised for first-time use on a mobile browser over a poor connection.

### Performance budget

| Metric | Target | Why |
|---|---|---|
| JS bundle (gzipped) | < 150 KB excluding PDF.js | Signers on 3G |
| Time to interactive | < 2.5s on 4G, mid-range Android | Abandonment rises sharply past 3s |
| First page rendered | < 1.5s | Perceived responsiveness |
| Lighthouse mobile | > 90 | Proxy for the above |

PDF.js is code-split and loaded after the consent gate, since the document is not visible until consent is given anyway.

> **As built (Phase 3).** Measured in a production build: before consent a signer loads about
> 131 KB of JavaScript (gzipped), 143 KB once the signing workspace loads, plus 132 KB of PDF.js.
> The signer portal and the sender app are separate lazy chunks, and a signer's browser never
> loads the sender pages or calls `/auth/refresh`. Time to interactive and Lighthouse have not been
> measured yet.

### Consent gate

```
   ┌────────────────────────────────────────┐
   │  Priya Sharma has sent you a document  │
   │  to sign.                              │
   │                                        │
   │  Consulting Agreement — Acme Corp      │
   │  12 pages · Expires 24 September       │
   │                                        │
   │  ┌──────────────────────────────────┐  │
   │  │ By checking this box you agree   │  │  ← verbatim from
   │  │ to sign electronically...        │  │    JurisdictionPolicy,
   │  │ [full disclosure text]           │  │    stored on consent
   │  └──────────────────────────────────┘  │
   │                                        │
   │  ☐ I agree to sign electronically      │
   │                                        │
   │        [  Review Document  ]           │
   └────────────────────────────────────────┘
```

The document is **not fetched** until consent is recorded — the gate is a server-side precondition, not a UI overlay. Rendering the document behind a dismissible modal would let a determined user read and sign without consenting, which defeats the legal purpose.

> **As built (Phase 3).** The notice is shown exactly as the server sent it. Until the lawyer's
> wording arrives it is a placeholder that begins "DRAFT — not legally reviewed". The sender's
> message, if any, is shown above it. **Review document** stays disabled until the box is ticked.
> The agreement carries the SHA-256 of the notice on screen. If the wording changed in the
> meantime, the new text is shown with a request to read it again. **Decline to sign** is available
> here, before consent.

### Guided navigation

```typescript
// Ordered by page, then by vertical position down the page.
// Reading order, not creation order — senders place fields in
// whatever sequence occurred to them.
const nextField = fields
  .filter(f => f.required && !f.isCompleted)
  .sort((a, b) =>
    a.pageNumber - b.pageNumber || a.ratioY - b.ratioY
  )[0];
```

The floating action button shows `NEXT: {type} — {n} of {total}` and scrolls the field to centre-viewport with a brief highlight pulse. When none remain it becomes `FINISH`.

> **As built (Phase 3).** Ties on the same line are broken left to right (`orderFieldsForSigning`
> in `@envelope/shared`). The server returns the fields in that order too. The button sits in a bar
> along the bottom that always shows how many required boxes are done ("1 of 2 required boxes
> done"). It reads **Start**, then **Next: Signature**, **Next: Tick box** and so on, then
> **Finish**.

### Signature capture

| Requirement | Implementation |
|---|---|
| Library | `signature_pad` — variable-width Bézier |
| Resolution | Canvas backing store at `devicePixelRatio × 2`, minimum 2× |
| Format | Transparent PNG. **Never JPEG** — no alpha, produces a white box over the document. |
| Payload cap | 500 KB; downscale before upload if exceeded |
| Typed alternative | Canvas render in an embedded script face, exported identically — one downstream pipeline |
| Persistence | Adopted signature held in `sessionStorage` for reuse across fields in the same session |

> **As built (Phase 3).**
>
> - **Type is the default tab.** It shows the name in three self-hosted handwriting fonts (Dancing
>   Script, Great Vibes, Caveat), so no request goes to a third party.
> - **Adopting sends the image to the server** (`POST /sign/:token/adopt`), one per kind, and a
>   copy stays in `sessionStorage` to show in the boxes for this tab. Which boxes were tapped is part
>   of the saved draft, and the session says which kinds the server holds, so a signer who comes
>   back finds those boxes still signed.
> - **Each signature box is tapped.** The adopted image goes into the boxes the signer taps, which
>   records their intent box by box, as on paper. Tapping a signed box offers to change the
>   signature, and an optional box can be cleared. On submit the server fills every required box of
>   that kind.
> - The PNG is cropped to the ink before upload, and scaled down only if it is over 500 KB.
> - **Text boxes are filled in a sheet** with a full-size input, not typed into the box. A box on a
>   phone is often about 11 px tall, and iOS zooms the page in on any input under 16 px. Tick boxes
>   toggle in place. Date boxes show today's date, and the server sets the real value.

**iOS Safari — mandatory handling:**

```css
canvas.signature-pad {
  touch-action: none;          /* stop the page panning while drawing */
  -webkit-user-select: none;
}
```

```javascript
canvas.addEventListener('touchmove', e => e.preventDefault(), { passive: false });
```

Without both, the page scrolls under the finger and the captured stroke is unusable. This MUST be verified on a real iOS device — desktop emulation does not reproduce it, and iOS Safari is the single most common signing environment.

### Offline resilience

Field values are written to `localStorage` on every change, keyed by token hash. On reload, unsent work is restored with a notice. Cleared on successful submit.

Submission uses exponential backoff with a clear retry affordance — never a silent failure. A signer who loses signal mid-flow and returns to an empty form will not start again.

> **As built (Phase 3).**
>
> - **The draft is keyed by the signer's lowest field id, not by a hash of the token.** The token
>   is then never stored anywhere, even hashed, and a reminder's new link still finds the draft.
> - Drafts are cleared on finishing or declining, and removed after 90 days.
> - Adopting and finishing retry a dropped connection or a server error after 1, 2 and 4 seconds,
>   then offer **Try again**.
> - A finish that got through but whose answer was lost is recognised: the retry is answered
>   `410 TOKEN_ALREADY_USED`, which counts as done.

## Accessibility — WCAG 2.2 AA

| Requirement | Implementation |
|---|---|
| Keyboard-only signing | Full journey navigable by keyboard; typed signature is the accessible path — drawing cannot be made keyboard-accessible, so typing MUST be equally prominent, never a fallback |
| Focus indicators | Visible on all interactive elements, 3:1 contrast minimum |
| Screen readers | Fields labelled `"Signature field, required, page 4 of 12"`; live region announces progress |
| Colour independence | Recipient colours paired with name labels — never colour alone |
| Contrast | 4.5:1 text, 3:1 UI components |
| Touch targets | Minimum 44×44 CSS px |
| Motion | Honour `prefers-reduced-motion` on scroll and highlight animations |
| Zoom | Usable to 200% without horizontal scrolling |

Typed signatures being equally prominent is both an accessibility requirement and a conversion improvement. Many sighted users with a mouse also find drawing awkward.

## Edge-Case Screens

| State | Response | HTTP |
|---|---|---|
| Expired token | Explanation plus "Request a new link" | `401 TOKEN_EXPIRED` |
| Already signed | Confirmation plus download link — **not an error** | `410 TOKEN_ALREADY_USED` |
| Envelope voided | "Cancelled by the sender" | `409 ENVELOPE_TERMINAL` |
| Another recipient declined | "No longer available for signature" | `409 ENVELOPE_TERMINAL` |
| Not yet your turn (sequential) | "You will be notified when it is your turn" | `403` |
| Decline flow | Confirmation → required reason → confirmation screen | `200` |
| Delegation | Name and email of the delegate; both parties notified; fully audited | `200` |

`410` for already-signed rather than `401` exists so the portal can distinguish "you are done" from "something is wrong". Conflating them turns a success into an apparent failure.

### As built (Phase 3)

Every screen is shown calmly, as an ordinary situation rather than an error. A refusal can come on
any request, not only the first: someone else may decline while this person is halfway through.

| State | Heading on screen | HTTP |
|---|---|---|
| Just signed | "Signed", with the server's message | `202` |
| Already signed | "You have already signed this document". No download link until the finished copy exists (Phase 4) | `410 TOKEN_ALREADY_USED` |
| You declined, now or earlier | "You declined this document" | `200`, then `409 ENVELOPE_TERMINAL` with `reason: YOU_DECLINED` |
| Another recipient declined | "This document is no longer available for signature" | `409 ENVELOPE_TERMINAL`, `reason: DECLINED` |
| Envelope voided | "This document has been cancelled by the sender" | `409 ENVELOPE_TERMINAL`, `reason: VOIDED` |
| Expired | "This signing link has expired", that anything already done is kept, and **Ask for more time**, which emails the sender (once a day; built in Phase 5) | `401 TOKEN_EXPIRED` |
| **Link replaced, or never issued** | "This link does not work". It explains that a newer email, such as a reminder, may have replaced the link, and asks the signer to use the most recent one | `401 TOKEN_INVALID` |
| Closed for any other reason | "This document is no longer open for signing" | `409 ENVELOPE_TERMINAL` |

- **The replaced-link screen is new.** Every reminder creates a new link and stops the old one
  (ADR 0009). An old email is therefore an ordinary way to arrive at a dead link, and the screen
  says so.
- A link that is not even shaped like a token gets the same screen without asking the server.
- **Not yet your turn** cannot happen: with *one after another*, a person is emailed only when their
  turn comes, so they have no link before then.
- Delegation is not built.

## In-Person Signing

Sender hosts the session on their own device — common for retail, onboarding, and field sales.

```
   Sender authenticated  →  "Sign in person"  →  hands device to signer
                                                        │
                              signer completes consent + fields
                                                        │
                         device returns to sender's session
```

Requirements: the signer never sees the sender's dashboard; the audit records both the hosting sender and the in-person signer; `signedFromIp` is the sender's device, which MUST be labelled as in-person in the audit so the IP is not later misread as the signer's own location.

## Sender Dashboard

```
┌───────────────────────────────────────────────────────────────┐
│  Documents                              [+ New]  [Templates]  │
├───────────────────────────────────────────────────────────────┤
│  [All] [Action needed 3] [Waiting 7] [Completed] [Cancelled]  │
├───────────────────────────────────────────────────────────────┤
│  Consulting Agreement — Acme      ●●○  2 of 3   2d   [Remind] │
│  NDA — Beta Industries            ●●●  Complete  1d   [View]  │
│  Offer Letter — J. Chen           ○○   Not viewed 4d [Remind] │
└───────────────────────────────────────────────────────────────┘
```

Sorted by "needs attention": unviewed longest first, then partially signed, then complete. The default view answers *"what should I chase today?"* rather than *"what did I send most recently?"*

## Email Templates

| Email | Subject | Primary action |
|---|---|---|
| Invitation | `{sender} has sent you a document to sign` | **Review & Sign** |
| Reminder | `Reminder: {title} awaits your signature` | **Review & Sign** |
| Completed | `Completed: {title}` | **Download** |
| Declined (to sender) | `{recipient} declined {title}` | View reason |
| Voided (to recipients) | `{title} has been cancelled` | — |
| Expiring soon | `{title} expires in 2 days` | **Review & Sign** |

Requirements: single primary call to action; plain-text alternative; sender name in the subject (recognition drives open rate); **no raw token in any logged or tracked URL**; correct SPF, DKIM, and DMARC from day one — a signature invitation in a spam folder is a lost document.
