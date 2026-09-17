# How It Works — The Plain English Guide

| | |
|---|---|
| **Status** | Draft for client review |
| **Version** | 1.0.0 |
| **Last updated** | 10 September 2026 |
| **Audience** | Everyone. No technical knowledge needed. |
| **What this doc answers** | What are we building, how does it work, and can I trust it? |

> **Read this one first.** There is no code in this document and no technical language. If you read only one file in this whole folder, read this one. It takes about ten minutes and by the end you will understand the entire product.

---

## 1. What Are We Building?

Today, getting a contract signed usually looks like this:

```
   Print it   →   Sign it   →   Scan it   →   Email it back   →   Hope it arrived
   
   Time: 2 days.  Cost: paper, ink, a scanner, and a lot of chasing.
```

We are replacing all of that with a link.

```
   Upload it   →   Send a link   →   They sign on their phone   →   Done
   
   Time: 4 minutes.  Cost: a fraction of a rupee.
```

That is the whole idea. You upload a document, mark where people need to sign, and send it. They get an email, tap the link, sign with their finger or mouse, and everyone instantly gets the finished, signed copy back.

If you have ever used DocuSign or Adobe Sign, this is that — except you own it, your documents stay on your own systems, and you are not paying a fee every single time you send something.

---

## 2. Walk Me Through It

The clearest way to explain this is to follow two real people through it from start to finish.

Meet **Priya**, who runs a consulting firm and needs a client to sign a service agreement.
Meet **Raj**, her client, who is out of the office and only has his phone.

### Step 1 — Priya uploads the document

Priya logs in and uploads her contract. It is an ordinary PDF, exactly the file she already has on her computer. Nothing about it needs to be special or prepared in advance.

```
   ┌─────────────────────────┐
   │                         │
   │   service-agreement     │   ← Priya drags her file in.
   │        .pdf             │      The system shows it on screen,
   │                         │      page by page, just like a PDF reader.
   └─────────────────────────┘
```

The moment the file arrives, the system takes a **fingerprint** of it. We will come back to what that means in section 3 — for now, just know that a record is made of exactly what this document looked like before anyone touched it.

### Step 2 — Priya marks where Raj needs to sign

Priya now sees her contract on screen. On the left is a small toolbar with items she can drag onto the page: a signature box, a date box, a text box, an initials box.

She drags a signature box onto page 4, right above the line that says *Client Signature*. She drags a date box next to it. She types in Raj's name and email address and assigns those boxes to him.

```
   ┌───────────────────────────────────────────┐
   │  PAGE 4 of 6                              │
   │                                           │
   │  ...the parties agree to the terms above. │
   │                                           │
   │  Client Signature:                        │
   │  ┌ ─ ─ ─ ─ ─ ─ ─ ─ ┐   ┌ ─ ─ ─ ─ ┐        │
   │  │  Sign here      │   │  Date   │        │  ← Priya dragged these
   │  │  → Raj          │   │  → Raj  │        │     into place
   │  └ ─ ─ ─ ─ ─ ─ ─ ─ ┘   └ ─ ─ ─ ─ ┘        │
   │                                           │
   └───────────────────────────────────────────┘
```

This step sounds simple, and for Priya it is. Behind the scenes it is genuinely the hardest part of the whole system, and section 4 explains why.

### Step 3 — Priya clicks Send

An email goes to Raj. It contains a link, and that link is unique to him — it is effectively a **one-time key** that opens this one document, for this one person, and nobody else.

Priya's dashboard now shows the contract as *Sent*, and she can see its status change as things happen.

### Step 4 — Raj opens it on his phone

Raj is on a train. He opens the email and taps the link.

He does **not** have to create an account. He does not have to download an app, remember a password, or install anything. The document opens in his phone's browser.

Before he can sign, he sees a short notice asking him to confirm he is happy to do this electronically rather than on paper, with a box to tick. This is not us being cautious for no reason — it is a legal requirement in the United States and elsewhere, and section 5 explains why it matters.

```
   ┌─────────────────────────┐
   │  ☑ I agree to sign this │
   │    document             │
   │    electronically.      │
   │                         │
   │   [  Continue  ]        │
   └─────────────────────────┘
```

At the moment he opens it, the system quietly writes down that the document was viewed, from what internet connection, on what kind of device, and at exactly what second. Priya sees "Viewed" appear on her dashboard.

### Step 5 — Raj signs

The system scrolls him straight to the box Priya marked and highlights it. He taps it, and a panel opens where he can either draw his signature with his finger or type his name and pick a handwriting style.

He draws it, taps **Adopt & Sign**, then taps **Finish**.

```
   ┌─────────────────────────┐
   │   Draw your signature   │
   │                         │
   │      ____               │
   │     / __ \  ____        │   ← drawn with a fingertip
   │    / /_/ / / __ \       │
   │    \____/ /_/ /_/       │
   │                         │
   │  [ Clear ]  [ Adopt ]   │
   └─────────────────────────┘
```

### Step 6 — The document is finished and sealed

This all happens in a few seconds, without Raj or Priya doing anything.

The signature Raj drew is **baked into the page itself** — like ink soaking into paper, not a sticker sitting on top that could be peeled off later. It becomes part of the document.

Then an extra page is added to the very back of the contract: a **Certificate of Completion**. It is a plain, readable summary of everything that happened — who signed, when, from where, on what device, and the document's fingerprints at each stage.

Finally, the completed file is locked away in storage that only opens one way. Once it is in, nobody can change it. Not Raj, not Priya, not us.

```
   Original contract  (6 pages)
   + Raj's signature burned into page 4
   + Certificate of Completion            (page 7)
   ────────────────────────────────────────────────
   = Final sealed contract  (7 pages)  → locked
```

### Step 7 — Everyone gets their copy

Priya and Raj both receive an email with the finished document. They get **identical** copies — this is also a legal requirement, not a nicety.

Total elapsed time from Priya clicking Send: about four minutes, most of which was Raj reading the contract.

---

## 3. How Do We Know Nobody Cheated?

This is the question that actually matters. A signed contract is only worth something if you can defend it when someone disputes it. Here is how we do that, in four parts.

### Part 1 — The one-time key

The link in Raj's email is not a simple web address that anyone could guess. It is a long random string, generated fresh, sent to Raj's email address and nowhere else.

Three things make it safe:

- **It cannot be guessed.** There are more possible combinations than there are atoms in the observable universe. Someone trying random guesses would still be trying when the sun burns out.
- **It stops working once used.** After Raj signs, the key is dead. Nobody can reuse the link.
- **It expires.** Even if nobody uses it, it stops working after a set period.

There is one more protection worth mentioning because it is unusual and it is genuinely good practice: **we do not store the key itself.** Our database keeps only a scrambled version of it, in a way that cannot be reversed. So even in the worst case — someone steals our entire database — they still cannot work out any signing links from it. The keys exist only in the emails they were sent to.

### Part 2 — The security-camera log

Every single thing that happens is written down permanently, the way a security camera records a building:

| What happened | What we record |
|---|---|
| Document created | Who, when |
| Email sent | To whom, when |
| Link opened | From what internet connection, what device, what browser, exact time |
| Agreement to sign electronically | The exact wording they were shown, and when they ticked it |
| Signed | Who, when, how they signed (drawn or typed) |
| Completed | When, and the document's fingerprint |

This log can only ever be added to. There is no way to edit an entry or delete one — not through the app, and not by anyone with access to the database either, because the entries are chained together in a way where changing one would visibly break the chain. If a line is altered, it shows.

### Part 3 — The document fingerprint

This is the part that sounds technical but is genuinely simple, and it is the strongest evidence we have.

There is a well-known mathematical technique that reads a file and produces a short code from it — a **fingerprint**. It has one property that makes it enormously useful: *change literally anything in the file and the fingerprint changes completely.*

Add a comma. Change a single digit in a price. Delete a space. The fingerprint does not change slightly — it becomes something totally different and unrecognisable.

```
   The contract, untouched              →   e3b0c442 98fc1c14 9afbf4c8 996fb924
   
   The same contract, with "10,000"
   quietly changed to "100,000"         →   a591a6d4 0bf42040 4a011733 cfb7b190
                                            ↑
                                            completely different — no resemblance
```

So here is the proof: we record the fingerprint of the finished contract and store it. Years later, if there is a dispute, anyone can take the copy they were sent and check its fingerprint. If it matches what we recorded, the document is provably unaltered. If it does not match, someone tampered with it.

Nobody has to trust us for this. The technique is a public standard, and anyone's IT person can check a file's fingerprint themselves in a few seconds with tools already on their computer. That independence is the whole point.

### Part 4 — The certificate stapled to the back

All of the above is summarised on that final page added to the contract. It travels with the document forever. Anyone who opens the PDF — a judge, an auditor, the other party's lawyer — sees the full story without needing access to our system at all.

---

## 4. The One Genuinely Hard Problem

It is worth understanding this, because it is where most cheaply-built signature systems fail, and it explains why this is a real engineering project rather than a weekend job.

**The problem:** Raj signed on a phone. Priya placed the box on a laptop. Someone else might use a large desktop monitor, or zoom in to 200%, or turn their tablet sideways.

Every one of those screens is a different size and shape. But the signature has to land in *exactly* the same physical spot on the actual document, every single time. A signature that drifts onto the wrong line — or off the page entirely — makes the contract worthless.

There is a second twist that makes it harder. Screens and PDF files do not just use different units of measurement — **they start counting from opposite corners.** A screen measures downward from the top-left. A PDF file measures upward from the bottom-left.

```
        A SCREEN                          A PDF FILE
                                    
   (0,0) ──────────►                       ▲
     │                                     │
     │    [signature]                      │    [signature]
     │                                     │
     ▼                              (0,0) ─┴──────────►
     
   starts top-left,                  starts bottom-left,
   counts downward                   counts upward
```

Get this backwards and every signature lands mirrored to the wrong half of the page.

**Our solution:** we never record positions in screen measurements at all. We record them as a **percentage of the page**.

Instead of storing *"420 pixels across, 890 pixels down"* — which means nothing on a different screen — we store *"62% across, 74% down."*

A percentage means the same thing everywhere. Sixty-two percent across an A4 page is the same physical spot whether you are looking at a phone, a projector, or the printed sheet. Then, when the signature is placed into the real document, that percentage is converted into the document's own measurements and flipped the right way up.

This is why signatures land perfectly on every device. It is a small idea, applied with discipline in exactly one place in the system, and it is the difference between a product that works and one that embarrasses you in front of a client.

---

## 5. Is This Legally Valid?

Yes. Electronic signatures have been legally binding for over two decades across every major market.

The law asks three questions, and the system is designed around answering all three.

**Did they mean to sign?**
Raj did not sign by accident. He had to actively draw or type his signature, then deliberately tap a button labelled *Adopt & Sign*, then tap *Finish*. Each of those actions is recorded with a timestamp.

**Did they agree to do this electronically instead of on paper?**
This is the one most people miss, and it is a hard legal requirement in the United States. Raj was shown a clear notice and had to tick a box before he could proceed. We store the exact wording he was shown — not just the fact that he agreed, but *what* he agreed to. If the wording ever changes, old records still show the old wording, which is what makes it defensible.

**Can you prove nothing changed afterwards?**
That is the fingerprint, the permanent log, and the one-way storage, all covered in section 3.

Here is where it stands by region:

| Where | Status |
|---|---|
| **United States** | Legally binding since 2000. Electronic signatures have the same force as ink for almost all business contracts. |
| **European Union** | Legally binding and explicitly admissible as evidence in court. There is a higher tier available for exceptional cases — see the note below. |
| **India** | Legally recognised. There is a distinct government-backed route using Aadhaar for certain document types, which we can add later if needed. |
| **UK, Canada, Australia, Singapore** | All recognise electronic signatures under equivalent national laws. |

**Two things to be aware of, stated plainly:**

*First*, some documents still require ink on paper or a notary, no matter what technology you use. Wills, certain property transfers, some family-law documents, and a few financial instruments are the common examples, and the exact list varies by country. This is a limit of the law, not of our system. The platform will let you block those document types so nobody sends one by mistake.

*Second*, Europe offers a higher tier called a *qualified* signature, where each signer holds a government-recognised digital identity. It is required only for a narrow set of high-value cases. It costs meaningfully more to build and run because it means contracting with a licensed provider. We have deliberately left it out of the first version, designed the system so it can be added later without rework, and documented what it would take. For everyday business contracts, what we are building is sufficient.

> This document explains how the system is designed to meet legal requirements. It is engineering analysis, not legal advice. Before launching in a new country, have a lawyer there review it.

---

## 6. What Does It Cost To Run?

The commercial case is the strongest argument for building this rather than renting it.

| Documents per month | Running this platform | Enterprise DocuSign |
|---|---|---|
| 1,000 | **~$60 – $85 / month** | roughly $10,000 – $20,000 / year |
| 50,000 | **~$395 – $545 / month** | roughly $75,000 – $150,000 / year |

At high volume the difference is not a percentage — it is two orders of magnitude. At 50,000 documents a month you are comparing roughly **$6,000 a year against $75,000 or more.**

That gap exists because commercial platforms charge per document sent, while your own infrastructure costs are driven by storage and computing power, which barely move as volume grows.

The honest counterpoint: those figures are running costs only. They do not include the ten weeks of development to build it, or ongoing maintenance afterwards. The build pays for itself quickly at moderate volume — and beyond the money, you own the system, your documents never leave your infrastructure, and you can build exactly the workflow your business needs rather than the one a vendor offers.

---

## 7. How Long Until It Works?

Ten weeks, in five two-week blocks. At the end of each block there is something real you can look at and try.

```
  WEEKS 1–2    Foundation
               → You can upload a document and see it on screen.

  WEEKS 3–4    The Field Builder
               → You can drag signature boxes onto the page and save them.

  WEEKS 5–6    The Signing Experience
               → A signer can open a link and draw their signature.
                 (Nothing is saved into the document yet.)

  WEEKS 7–8    The Sealing Engine
               → The signature is burned into the PDF, the certificate page
                 is added, and you get the finished file back.
                 THE PRODUCT IS USABLE END TO END AT THIS POINT.

  WEEKS 9–10   Hardening
               → Multi-signer ordering, reminders, tested across phones and
                 tablets, security review, ready for real customers.
```

The key milestone is the end of week 8. That is when the product genuinely works from start to finish. Weeks 9 and 10 make it robust enough to put in front of paying customers.

---

## 8. What It Will *Not* Do

Worth agreeing on now, because it is far cheaper to discuss in week one than in month three.

**Not in the first version:**

- **Government-issued digital certificates.** The higher European tier and India's Aadhaar-based route are both designed for but deliberately deferred. Adding either means contracting with a licensed provider.
- **A mobile app.** It works properly in a phone's browser, which is what signers actually want — no download, no account. A native app adds cost without adding much.
- **Contract lifecycle management.** This gets documents signed. It does not manage renewal dates, obligations, or approval hierarchies.
- **Online notarisation.** A separate regulated service with its own licensing requirements.
- **Editing the document.** Whatever PDF you upload is what gets signed. There is no built-in editor — write it in Word, export to PDF, upload.
- **Signing scanned images.** A PDF that is really just a photograph of a page will work, but the system cannot find text inside it, so features that depend on reading the document will not apply.

**Deliberately never:**

- We will not let you quietly alter a document after it has been signed. That is the entire point of the product, and any feature request that undermines it gets refused.

---

## 9. Common Questions

**What if someone forwards the signing email to a colleague?**
The link would work for whoever opens it, so the log records the internet connection and device that actually signed — which will visibly differ from the intended signer if it was forwarded. If a document needs stronger protection, you can turn on a code sent by text message to the signer's phone, so possession of the email alone is not enough.

**I signed on my phone. Will it look wrong on a printout?**
No. Signatures are captured at high resolution and positioned by percentage rather than by pixels, so they land in the right place and stay crisp when printed. Section 4 covers the mechanism.

**What if the other person refuses to sign?**
They can decline, and they will be asked for a reason. You are notified immediately, the reason is recorded in the log, and the document closes as declined. Nobody can sign it after that.

**Can I cancel a document after sending it?**
Yes, any time before it is completed. It is voided, every outstanding link stops working instantly, and the cancellation is recorded.

**Can someone edit the contract after it is signed?**
They can edit any PDF file — that is true of every document on earth, including a scanned paper one. What they cannot do is edit it *without it showing*. Any change, however small, breaks the fingerprint, and the altered copy will not match the record. That is what makes tampering detectable and therefore pointless.

**What if three people need to sign, in a specific order?**
Supported. You set the order, and each person is only emailed once the person before them has finished. You can also send to everyone at once if order does not matter.

**Where are our documents actually stored?**
On storage you control, in a region you choose. They never pass through a third-party signature vendor. For European customers this matters legally, and it is a genuine advantage over the commercial platforms.

**What happens if your company disappears?**
The signed PDFs are ordinary PDF files. They open in any PDF reader, forever, with the certificate page included. There is no proprietary format and nothing that stops working if the platform goes away. Your contracts are not hostage to it.

---

## Where To Go Next

If you want more detail, these are the next most readable documents:

| Document | What it covers |
|---|---|
| [01-product-requirements.md](01-product-requirements.md) | The full feature list and who each part is for |
| [02-feasibility-and-build-vs-buy.md](02-feasibility-and-build-vs-buy.md) | The build-versus-buy case in detail, with numbers |
| [11-implementation-roadmap.md](11-implementation-roadmap.md) | Week-by-week plan and what gets delivered when |

Everything else in this folder is written for the development team.
