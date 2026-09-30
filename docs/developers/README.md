# Envelope Developer Guide

| | |
|---|---|
| **Status** | Current |
| **Version** | 1.0.0 |
| **Last updated** | 30 September 2026 |
| **Audience** | Developers connecting an application to Envelope |
| **What this doc answers** | How do I send documents for signature, hear about the result and embed the editor, without a login to the Envelope repository? |

## In Plain Terms

Envelope lets your application send a PDF to people who sign it on Envelope's own hosted page, and
tells your application what happened. You can drive it entirely from your server with an API key,
receive signed notifications (webhooks) when something changes, and optionally let your staff prepare
documents in an editor embedded in your own page. This folder is the whole guide, and it can be shared
by itself: nothing here needs access to Envelope's source code.

## Technical Detail

| Read | For |
|---|---|
| [Quick start](quick-start.md) | Upload, prepare and send one document with a single script |
| [Concepts](concepts.md) | Envelopes, recipients, fields, statuses and what "hosted signing" means |
| [Authentication](authentication.md) | API keys, access levels and what a key cannot do |
| [Envelopes](envelopes.md) | The document lifecycle, references, downloads, cancelling and reminding |
| [Webhooks](webhooks.md) | Receiving, verifying and recovering event notifications |
| [Templates and bulk send](templates.md) | Saving a document once, creating envelopes from it, and sending to a whole list |
| [Embedded editor](embedded-editor.md) | The sender editor in an iframe, the hosted SDK and the example app |
| [Errors](errors.md) | Every error code you can meet and what to do |
| [Limits](limits.md) | Size, count and rate limits |
| [Recipes](recipes.md) | Retrying safely, recovering lost responses, redriving events |
| [API reference](reference.md) | Every operation, generated from the same catalog the code is tested against |
| [openapi.json](openapi.json) | The OpenAPI 3.0 document, for generators and API clients |

Base URL: `https://YOUR-ENVELOPE-HOST/api/v1`. Every request carries `Authorization: Bearer <API key>`.
Errors are [RFC 7807](errors.md) `application/problem+json` with a stable `code`.

### How the guide stays true

Which routes accept an API key, what each webhook contains and what each error code means are written
once, in `packages/shared/src/integration-contract.ts` in the Envelope repository (ADR 0021). The tables
between `<!-- generated:… -->` markers in these pages, the OpenAPI document and Envelope's in-app guide
are all produced from it, and tests fail when a route, an error code or a table disagrees. If you are
changing Envelope itself, edit the catalog, then run `UPDATE_DEVELOPER_DOCS=1 pnpm --filter
@envelope/api test` and `UPDATE_OPENAPI=1 pnpm --filter @envelope/api test:e2e`.
