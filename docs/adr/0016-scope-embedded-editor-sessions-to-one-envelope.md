# 0016. Scope Embedded Editor Sessions to One Envelope

| | |
|---|---|
| **Status** | Accepted |
| **Version** | 1.0.0 |
| **Last updated** | 27 September 2026 |
| **Audience** | Engineering and integrators |
| **What this doc answers** | How can HealthProHub reuse the editor without granting its browser tenant-wide access? |

## In Plain Terms

HealthProHub can open Envelope's editor inside its own page. Its backend grants temporary access
only to the document the staff member is allowed to prepare. Recipients still sign through email
links on Envelope. The SDK opens the editor; it does not replace the backend or build another editor.

## Technical Detail

**Date:** 2026-09-27  
**Deciders:** Project owner (approved 27 September 2026)

### Context

The current API key acts as a tenant-wide service account (ADR 0015); the sender UI expects a human
login. Neither credential is appropriate to hand to an embedded browser. HealthProHub needs both
API upload followed by draft editing and upload within the reused UI. Existing frame protection
must continue protecting the signer and normal sender application.

### Decision

Propose a dedicated iframe sender shell and thin JavaScript SDK, with a backend-issued, single-use
launch credential exchanged for a short-lived, memory-only embedded bearer. Store only credential
HMACs. Bind each session to tenant, issuing key, exact approved parent origin, allowed actions and
one draft; upload mode binds atomically on its first successful creation. Every request checks scope
and revocation. Embedded access never becomes a normal sender/ADMIN login.

Set frame-ancestors on dynamically served embedded HTML; validate message origin, source and channel
on both sides. Do not use third-party cookies or credentials in URLs. Preserve frame denial for
normal sender/signing pages. Reuse the editor and services behind an injected scoped transport.
Keep service-account ownership and record partner-asserted actor/session attribution in new audit
metadata. Webhooks and API reads remain authoritative for business status.

Detailed lifetimes, routes, schema, protocol and tests are maintained in
[docs/18 workstream 6](../18-phase-7-integration-plan.md#workstream-6-embedded-sender-editor-and-healthprohub-sdk-proposed).

Rejected alternatives: a browser API key exposes the tenant; framing a normal logged-in session
creates cookie and privilege problems; rebuilding the editor in a React SDK duplicates rendering
and business logic; a new-tab-only handoff does not deliver the requested in-page experience.

### Consequences

**Easier:** reuse PDF rendering, field placement, upload and send without implementing them in
HealthProHub; one-envelope scope limits browser authority; framework-independent integration.

**Harder:** a new principal, dynamic HTML headers, origin management, atomic upload binding and
cross-origin tests are required. Hosting cannot use an unmodified static fallback for embed HTML.

**Accepted:** HealthProHub is trusted to authorize its users and assert their opaque actor IDs.
An approved parent handles a short-lived launch secret. Lost sessions require backend reauthorization;
unsaved browser work is not durably retained. Embedded recipient signing remains outside this scope.
