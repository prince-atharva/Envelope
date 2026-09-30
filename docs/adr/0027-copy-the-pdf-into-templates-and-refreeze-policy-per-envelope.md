# 0027. Copy the PDF into Templates, Store Role Slots, and Re-Freeze Policy per Envelope

**Status:** Accepted
**Date:** 2026-09-30
**Deciders:** Engineering

## Context

ENV-07 asks for saving an envelope as a reusable template, so "next time, add a name and email and
send" (docs/01). Nothing in the data model supports it, and three existing rules constrain the shape:

- **Fields belong to recipient rows.** `DocumentField` has a composite foreign key
  `(recipientId, envelopeId)`, so a field cannot exist without a real recipient of the same envelope.
  A template has no people yet.
- **Each envelope owns its PDF.** The storage key embeds the envelope id and `DocumentVersion` 0
  points at it (`envelopeDocumentKey`). Deleting or retaining out an envelope deletes its objects.
- **Policy is frozen per envelope** (ADR 0011): jurisdiction, blocked categories and consent text are
  resolved when an envelope is created and never change. A template that carried a snapshot would carry
  a stale one.

The audit trail is also envelope-bound (`AuditTrail.envelopeId` is NOT NULL, ADR 0004), so a template
cannot have audit rows of its own.

## Decision

We will model a template as its own copy of the document plus **role slots**, and treat every
instantiation as a normal envelope creation:

1. **`Template` owns a copy of the original PDF** under its own storage key, with its hash and page
   count. Saving a template copies version 0 of the source envelope; it does not reference it.
2. **`TemplateRole` is a placeholder recipient**: a name ("Patient"), a `RecipientRole`, a routing order
   and a colour. `TemplateField` mirrors `DocumentField` but points at a role slot.
3. **Instantiation creates real rows.** It copies the template PDF to a new envelope-owned key (a new
   `StorageService.copy`), mints `Recipient` rows from the supplied people, and mints new field UUIDs
   pointing at those recipients. The recipient list must match the role slots exactly
   (`TEMPLATE_ROLE_MISMATCH` otherwise).
4. **Policy is re-resolved every time.** Instantiation calls the same jurisdiction resolution and
   `assertCategoryAllowed` as a normal create. A category blocked after the template was saved is
   refused with the existing error. The template never stores a snapshot.
5. **Templates are immutable apart from name, description, default message and archive.** Changing a
   layout means saving a new template. Archiving hides a template from new use; it never deletes,
   because bulk batches and audit events refer to it.
6. **Who.** Admins create, rename and archive (docs/01). Every role may create envelopes from an active
   template. Template create, rename and archive are structured logs, not audit rows (the precedent for
   tenant-level admin actions). What is audited is on the envelope: its `ENVELOPE_CREATED` event records
   the `templateId`.

We rejected:

- **Referencing the source envelope.** It can be voided, deleted or retained out from under the
  template.
- **One shared PDF key for every envelope from a template.** It breaks per-envelope ownership and
  deletion, and makes the version-0 hash match rule (`UNSIGNED_ORIGINAL`) harder to reason about.
- **Storing a policy snapshot on the template.** It would make a blocked category sendable through an
  old template.
- **Editable templates with versions.** Real value, real cost (which version did this envelope use, does
  an edit affect drafts). Deferred.

## Consequences

**Easier:**

- Every rule that applies to creation (policy, category, tenancy, audit) applies unchanged, because
  instantiation is creation.
- Deleting a template or an envelope never damages the other.

**Harder:**

- One more copy of the PDF per template and per envelope: storage grows with use.
- `StorageService` gains a `copy`, and every storage implementation must provide it.

**Accepted:**

- Templates have no audit trail of their own; their history is in logs.
- The template PDF was scanned when its envelope was uploaded and is not rescanned on copy, so the
  ADR 0026 outage caveat carries over to templates.
- No merge fields, prefilled values or conditional fields: a template fixes where fields go, not what
  they say.
