# Security and Threat Model

| | |
|---|---|
| **Status** | Draft for client review |
| **Version** | 1.0.0 |
| **Last updated** | 10 September 2026 |
| **Audience** | Everyone (Part 1) · Engineering and security review (Part 2) |
| **What this doc answers** | What could go wrong, and what stops it? |

---

# PART 1 — In Plain Terms

## The Central Problem

Almost every security decision in this product traces back to one unusual fact:

**The most important user has no account.**

Raj never signs up. He has no password. He arrives from an email link, signs a legally binding contract, and leaves. There is no login to protect him.

That is deliberate — forcing signers to create accounts is the single fastest way to make people abandon documents. But it means the link in that email *is* the security. It is the key to the document, and everything depends on it being a good key.

## What Makes the Key Safe

Four things.

**It cannot be guessed.** The link contains a long random string. The number of possibilities is around a 78-digit number — more than the estimated count of atoms in the observable universe. There is no meaningful sense in which someone guesses it. This is not a strong password; it is a different category of thing.

**It only works once.** The moment Raj signs, the key is dead. The link cannot be reused, by him or by anyone who later gets hold of it.

**It expires on its own.** Even untouched, it stops working after a set period.

**We do not keep a copy of it.**

That last one deserves a proper explanation, because it is unusual and it is genuinely good practice.

## Why We Do Not Store the Key

The obvious way to build this would be to save each key in our database so we can check it later. Almost every tutorial does exactly that.

The problem: if someone ever steals the database, they would have every working signing link in the system. They could open and sign other people's contracts.

So instead, we scramble the key through a one-way process before storing it — a process that cannot be run backwards. When Raj arrives with his key, we scramble what he brings and compare the scrambled versions.

```
   The email contains:        7f9b8c2d4e6a...   ← the real key

   Our database contains:     a3f5e991b204...   ← the scrambled version,
                                                  which cannot be turned
                                                  back into the real key
```

The consequence is worth stating plainly: **even if someone steals our entire database, they cannot sign anything.** They get a list of scrambled values that open nothing. The working keys exist only in the emails they were sent to.

This costs nothing to implement and removes an entire category of catastrophe.

## Can Someone Change a Contract After Signing?

They can edit the file. Anyone can edit any file — that is equally true of a scanned paper contract.

What they cannot do is edit it **without it showing.**

Three separate things have to be defeated at once:

**The fingerprint.** Any change — one comma — produces a completely different code that no longer matches our record.

**The permanent log.** Entries cannot be edited or deleted, and they are chained together so altering one visibly breaks every entry after it.

**The one-way storage.** The finished document is filed where it cannot be changed or deleted at all.

An attacker would need to defeat all three simultaneously, and even then the person holding the original copy could still check its fingerprint and find the discrepancy. Tampering is not impossible — it is *pointless*, because it is guaranteed to be detected.

## What If Someone Forwards the Email?

An honest answer: the link works for whoever opens it. That is the trade-off for not requiring accounts, and it is the same trade-off every signature platform makes.

Three things limit the damage:

**It is recorded.** We capture the internet connection and device that actually signed. If it differs from the intended signer, that shows in the record and can be raised in a dispute.

**Optional text-message verification.** For sensitive documents, turn on a code sent to the signer's phone. Now possession of the email alone is not enough — you also need their phone.

**Paper has the same problem.** A contract posted to someone's office can be signed by anyone who opens the envelope. Electronic signing does not create this risk; it inherits it, and then records far more about what happened than paper ever could.

## Malicious Uploads

People upload files, and files can be hostile.

| The trick | What we do |
|---|---|
| A file that claims to be a PDF but is not | Inspect the actual contents, never trust the filename |
| A tiny file that expands to fill all memory | Enforce size and page limits, process in isolation |
| A PDF containing hidden code | Strip active content before displaying anything |
| A file containing malware | Scan every upload |
| An enormous file to exhaust storage | Hard size limits per file and per account |

---
---

# PART 2 — Technical Detail

> Written for engineering and security review. Non-technical readers can stop here.

## Trust Boundaries

```
   ┌─── PUBLIC INTERNET ─────────────────────────────────────────┐
   │                                                             │
   │   Signer (unauthenticated)      Sender (authenticated)      │
   │          │                              │                   │
   └──────────┼──────────────────────────────┼───────────────────┘
              │  token in path               │  session / JWT
   ┌──────────▼──────────────────────────────▼───────────────────┐
   │  BOUNDARY 1 — Application                                   │
   │    Token Guardian · session validation · tenant scoping     │
   └──────────┬──────────────────────────────┬───────────────────┘
              │                              │
   ┌──────────▼─────────────┐   ┌────────────▼────────────────────┐
   │ BOUNDARY 2 — Workers   │   │ BOUNDARY 3 — Persistence        │
   │   PDF processing on    │   │   Postgres · object storage     │
   │   untrusted input      │   │   Audit table: INSERT/SELECT    │
   └────────────────────────┘   └─────────────────────────────────┘
```

## Token Design

```typescript
import crypto from 'crypto';

// ── Minting (on send) ──
const rawToken = crypto.randomBytes(32).toString('hex');   // 256 bits

const tokenHash = crypto
  .createHmac('sha256', process.env.TOKEN_SALT!)           // server-side secret
  .update(rawToken)
  .digest('hex');

// Persist ONLY the hash. rawToken goes into the email and is
// never written to the database, a log, or an APM trace.
await db.recipient.update({
  where: { id: recipientId },
  data: { tokenHash, tokenExpiresAt: addDays(new Date(), 14) },
});

// ── Validation (on arrival) ──
const candidateHash = crypto
  .createHmac('sha256', process.env.TOKEN_SALT!)
  .update(suppliedToken)
  .digest('hex');

const recipient = await db.recipient.findUnique({ where: { tokenHash: candidateHash } });
```

| Property | Mechanism | Rationale |
|---|---|---|
| Unguessable | 256 bits from a CSPRNG | Brute force is not a meaningful threat model |
| Not recoverable from the DB | HMAC-SHA256 with a server-side salt | Database compromise yields no working links |
| Single use | `tokenUsedAt` set on submit | Replay after signing is impossible |
| Expiring | `tokenExpiresAt` checked on every request | Bounds the exposure window |
| Revocable | Void or decline nulls the hash **synchronously** | Cancellation must take effect immediately, not eventually |

**The salt is HMAC, not a bare hash.** A bare SHA-256 of a 256-bit random value is not realistically reversible either, but HMAC with a server-held secret means an attacker with database read access *and* the ability to compute hashes still cannot verify a guess offline without also stealing the salt. Defence in depth at zero cost.

### Handling rules

| Rule | Enforcement |
|---|---|
| Never log a raw token | Structured logger redaction on `token`, `rawToken`; log an 8-char hash prefix instead |
| Never in APM traces | Scrub URL paths matching `/sign/:token` before export |
| Never in analytics | No third-party analytics on the signer portal at all |
| Never in `Referer` | `Referrer-Policy: no-referrer` on signer pages |
| Never in error reports | Sanitise URLs in the error handler before dispatch |

Token leakage through observability tooling is the most likely real-world failure of this design. The cryptography is not the weak point; the plumbing around it is.

## STRIDE Analysis

| Threat | Vector | Mitigation | Residual |
|---|---|---|---|
| **Spoofing** | Guessing a token | 256-bit entropy | Negligible |
| **Spoofing** | Stolen database | HMAC with server-side salt | Low |
| **Spoofing** | Forwarded email | IP/UA capture; optional SMS OTP | **Accepted** — inherent to accountless signing; equivalent to a posted paper contract |
| **Spoofing** | Email account compromise | OTP option; expiry limits the window | **Accepted** — outside our control |
| **Tampering** | Editing a sealed PDF | SHA-256 chain; Object Lock; independent verification | Negligible — detectable |
| **Tampering** | Rewriting the audit log | INSERT/SELECT privileges only; hash chain; nightly integrity job | Low |
| **Tampering** | Altering field coordinates in transit | TLS; server-side range validation; ownership check | Low |
| **Repudiation** | "I never signed" | IP, UA, timestamp, verbatim consent text, version chain | Low |
| **Repudiation** | "I signed a different version" | Per-round `DocumentVersion` with its own hash | Low — this is precisely what Correction 2 addresses |
| **Info disclosure** | Enumerating envelopes | UUIDs; tenant scoping; uniform 404s | Low |
| **Info disclosure** | Seeing other recipients' fields | Signing session returns only the caller's fields | Low |
| **Info disclosure** | Token in logs | Redaction; no third-party analytics on the portal | **Medium — requires ongoing vigilance** |
| **Info disclosure** | Cross-tenant leakage | Prisma middleware + PostgreSQL RLS + dedicated test suite | Low |
| **DoS** | PDF bomb | Size/page caps; isolated workers; memory limits | Low |
| **DoS** | Signing-page flooding | Per-token rate limits | Low |
| **DoS** | Storage exhaustion | Per-tenant quotas | Low |
| **Elevation** | Signer reaching sender functions | Token scope is one envelope, one recipient | Low |
| **Elevation** | API key privilege escalation | Keys scoped to a tenant; read-only variants | Low |

Two threats are **explicitly accepted** rather than mitigated: email forwarding and email-account compromise. Both are inherent to accountless signing, both are mitigable per-envelope with SMS OTP, and neither is worse than the paper process being replaced. Accepting them knowingly, and saying so, is better than pretending they are solved.

## Audit Integrity

```
   Event N:  eventHash = SHA256(prevHash ‖ action ‖ timestamp ‖ canonical(payload))
   Event N+1: prevHash = Event N's eventHash
```

| Control | Implementation |
|---|---|
| No UPDATE / DELETE | `REVOKE UPDATE, DELETE ON "AuditTrail" FROM app_role` |
| Chain verification | Nightly job walks each envelope; alerts on any break |
| Same-transaction writes | State change and audit event share one transaction |
| Coverage | A test walks every state-machine transition and asserts an event is emitted |

**An audit write failure or a chain break is a page-immediately incident.** It means the evidentiary basis of the product is compromised, which is more serious than the site being down.

## Storage Security

| Control | Implementation |
|---|---|
| Encryption at rest | Per-tenant keys via cloud KMS |
| Encryption in transit | TLS 1.3 minimum |
| Access | Presigned URLs, 15-minute expiry, no public buckets |
| **Object Lock** | **Final version only**, compliance mode, retention matching policy |
| Versioning | Enabled — protects against accidental overwrite |
| Residency | Bucket selected per tenant region at write time |

**Object Lock applies only to the final sealed version.** Locking intermediate versions breaks multi-signer flows, because a version created by signer 1 must still be readable and superseded by signer 2's round. This distinction is easy to get wrong and produces a failure that only appears with three or more signers — after single-signer testing has passed.

## Upload Hardening

```
   1. Size check          → reject > 25 MB before reading the body
   2. Magic-byte check    → must begin %PDF-; never trust Content-Type or extension
   3. Structure parse     → reject malformed; reject encrypted (ENCRYPTED_PDF)
   4. Page count          → reject > 500
   5. Malware scan        → ClamAV or an equivalent service
   6. Active content      → strip /JavaScript, /Launch, /EmbeddedFile, /OpenAction
   7. Store               → randomised object key, never the user-supplied filename
```

Steps 2 and 6 matter most. Content-Type is attacker-controlled. Embedded JavaScript in a PDF executes in some desktop viewers, so a signed document carrying active content would be a payload we distributed to both parties under our own name.

Processing runs on workers with constrained memory and no outbound network access, so a parser exploit cannot reach internal services.

## Application Security

| Control | Implementation |
|---|---|
| TLS | 1.3 minimum; HSTS with preload |
| CSP | Strict; `default-src 'self'`; no inline scripts; nonce-based |
| CSRF | SameSite=Strict cookies plus token for the sender UI |
| XSS | React escaping by default; `dangerouslySetInnerHTML` banned by lint rule |
| SQL injection | Prisma parameterisation; no raw SQL on user input |
| SSRF | No user-supplied URLs are fetched anywhere |
| Clickjacking | `X-Frame-Options: DENY` (signer portal is never framed) |
| Dependencies | Dependabot; CI fails on high or critical advisories |
| Secrets | Environment variables; platform secret manager; **never committed**; CI secret scanning |
| Password storage | Argon2id for sender accounts |
| Session | Short-lived JWT plus refresh rotation; revocable |

## Rate Limiting

| Surface | Limit | Rationale |
|---|---|---|
| Signing session read | 60/min per token | Generous — legitimate signers reload |
| Consent / submit | 10/min per token | Bounds automated abuse |
| SMS OTP request | 3 per recipient per hour | Prevents SMS-pumping fraud |
| OTP verification | 5 attempts, then lock | Bounds brute force on a 6-digit code |
| Verify endpoint | 30/min per IP | Public and unauthenticated |
| Login | 10/min per IP, 5 per account | Credential stuffing |

Signing limits key on the **token**, not the IP — corporate NAT means many legitimate signers share one address.

## Incident Response

| Severity | Examples | Response |
|---|---|---|
| **P0** | Audit chain break; token leakage; cross-tenant data exposure | Immediate page; halt sending; preserve evidence |
| **P1** | Sealing failures; storage unavailable; mail delivery down | Page during business hours |
| **P2** | Elevated errors; queue backlog | Next business day |

**Evidence preservation is the first action in any P0**, before remediation. If the integrity of the audit trail is questioned, the state at the moment of discovery is itself evidence, and remediating first can destroy the very record needed to establish what happened.

## Pre-Launch Security Checklist

- [ ] Token redaction verified across logs, APM, and error reporting
- [ ] Audit table privileges confirmed in production (`\dp "AuditTrail"`)
- [ ] Chain verification job running and alerting
- [ ] Cross-tenant isolation test suite passing against every endpoint
- [ ] Object Lock confirmed on final versions, absent on intermediates
- [ ] Upload pipeline tested with malformed, encrypted, oversized, and JavaScript-bearing PDFs
- [ ] CSP verified with no violations in normal operation
- [ ] Dependency scan clean of high and critical advisories
- [ ] Rate limits verified under load
- [ ] Presigned URL expiry confirmed
- [ ] Secrets absent from the repository history (not merely from `HEAD`)
- [ ] Penetration test completed, findings remediated
- [ ] Incident runbook written and walked through with the on-call team
