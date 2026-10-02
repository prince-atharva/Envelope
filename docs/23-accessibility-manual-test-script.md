# Accessibility Manual Test Script

| | |
|---|---|
| **Status** | Ready to run. Written for Phase 11 step 12 ([docs/22](22-phase-11-signing-options-branding-reports-accessibility-plan.md)); not yet run on real devices |
| **Version** | 1.0.0 |
| **Last updated** | 1 October 2026 |
| **Audience** | The product owner (Part 1) · Testers and developers (Part 2) |
| **What this doc answers** | What do we check by hand with a screen reader, because automated tools cannot certify it? |

---

# PART 1: In Plain Terms

Automated checks (axe, the keyboard-only spec, the size and reflow checks) catch a lot, but they cannot
tell whether a screen reader says something sensible. This script is how a person checks that, on real
devices, with the same assistive technology a signer would use.

**You will need:** one device per row below, a test workspace with a sent document, and about 45
minutes per device. Use a test workspace and a test mailbox, never real patient documents.

| Device | Screen reader | Browser |
|---|---|---|
| iPhone | VoiceOver | Safari |
| Android phone | TalkBack | Chrome |
| Windows PC | NVDA | Firefox or Chrome |
| Mac (optional) | VoiceOver | Safari |

**How to record a result:** for each step write Pass, or Fail with what was said and what you expected.
A fail on a step marked **(must)** blocks calling the signing journey accessible. Send the sheet back and
the failures become fixes in the same phase.

**The journey, in one line:** open the emailed link, agree to sign electronically, find each box, sign,
tick, finish, and hear that it worked.

---

# PART 2: Technical Detail

> Written for testers and developers. Non-technical readers can stop here.

## Before You Start

1. Sign in as the sender. Send a document with one signature box and one tick box to a test mailbox
   (tick "Let signers pass it to someone else" for step 9).
2. Open the signing link from the email on the device under test. Do not use the sender's browser
   session.
3. Turn the screen reader on first, then open the link, so the page load is announced.

## The Script

| # | Step | Expected | |
|---|---|---|---|
| 1 | Open the link | The page title says what the page is; the first heading read is "Agreement to sign electronically" | (must) |
| 2 | Move through the page from the top | Logo or workspace name is read once, with its text alternative; no unlabelled "button" or "link" | |
| 3 | Reach the consent checkbox | Read as a checkbox named "I agree to sign electronically", with its state | (must) |
| 4 | Activate "Review document" | Focus lands somewhere sensible in the document view; the change of screen is announced or evident | (must) |
| 5 | Find the page area | The canvas is described as "Page N of the document" and says its text is not available; it does not read as an empty image | |
| 6 | Jump between the fields (rotor, headings or the Tab key) | Each box is read as "Signature field, required, page N of M, not signed yet" or "Tick box field, required, ..."; order is top to bottom | (must) |
| 7 | Activate the signature box | A dialog opens and is announced as "Adopt your signature"; focus is inside it; Escape closes it and focus returns to the box | (must) |
| 8 | Adopt the typed signature | The name field is labelled "Your full name"; the "Adopt and sign" button is reachable and announces the result | (must) |
| 9 | If delegation is on: open "Pass to someone else" | The dialog explains what will happen; both fields are labelled; an error on an empty field is read when it appears | |
| 10 | Check the tick box | Read as checked; the progress text ("1 of 2 required boxes done") is announced without moving focus | (must) |
| 11 | Activate "Finish" | The end screen is announced; its heading is "Signed"; nothing else is needed to learn it worked | (must) |
| 12 | Open the old link again | The page says it was already used, in words, not just colour | |
| 13 | Zoom the page to 200% and rotate the phone | Nothing is cut off; no sideways scrolling outside the document area | |
| 14 | Turn on "reduce motion" in the device settings and reopen the link | Sheets and spinners do not slide or spin | |

## In-Person Hand-Over (after Phase 11 step 5)

| # | Step | Expected | |
|---|---|---|---|
| 15 | As the sender, press "Sign in person" | The dialog says you will be signed out; the confirm button is clearly named | |
| 16 | On the signing page | The banner naming the host is read near the top, before the document | |
| 17 | After signing | The hand-back screen has a "sign in" link that is reachable and named | |

## Sender Screens (spot checks)

| # | Screen | Check |
|---|---|---|
| 18 | Dashboard | Table or list rows are read with their status, not only a coloured badge |
| 19 | Send dialog | Focus enters on open and returns to "Send for signing" on close |
| 20 | Settings, Branding | The colour field announces its error ("too light for white text"); the logo button states Upload or Replace |
| 21 | Reports | Tiles are read as label then value; the charts have a table view ("View the numbers as tables") that reads as real tables |

## Recording Results

Copy the tables into a file named `docs/23-results-<device>-<date>.md`, add Pass or Fail and notes, and
commit it with the fixes. Anything failed and not fixed in this phase goes into the next plan's
"Deliberate Simplifications" with its step number.
