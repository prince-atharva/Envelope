# 0034. Brand Recipient-Facing Surfaces with a Workspace Logo and Accent Colour

**Status:** Accepted
**Date:** 2026-10-01
**Deciders:** Product owner, engineering

## Context

docs/01 asks (open question 4) whether workspaces need their own branding on emails and the signing
page, and docs/11 lists "your logo and brand colours" as an input for emails and the signing page.
Emails today use one placeholder colour. A logo is an image supplied by a tenant admin and then shown to
the public, so it is untrusted input served without a login. The sealed PDF and its certificate are
evidence (docs/06, ADR 0005).

## Decision

- A workspace has an optional logo and an optional accent colour (`#rrggbb`). They apply to emails sent
  to recipients, the signing page and its end screens, and the download page. They do **not** apply to
  staff or account emails, the certificate or the sealed PDF. "Powered by" attribution stays.
- A logo must be PNG or JPEG by its bytes (never SVG), at most 512 KB, and is **re-encoded** with `sharp`
  to a PNG fitted inside 480x160, dropping all metadata. Only the re-encoded file is stored and served.
- It is served publicly at `/branding/logo/:ref`, where `ref` is a random value that changes on every
  upload, with an immutable cache and `nosniff`. The tenant id is never in the URL.
- The accent colour is rejected unless white text on it reaches 4.5:1, so a brand colour cannot make a
  button unreadable. The contrast check lives in `packages/shared`.

Rejected: **branding the certificate** (changes evidence layout and the certificate parser, for little
gain); **SVG logos** (script and external-reference risk); **a private logo URL per recipient** (email
clients fetch images without cookies, so it could not work).

## Consequences

**Easier:** A recipient sees who is asking them to sign. Contrast failures are caught at input.

**Harder:** Another public, unauthenticated route and an image pipeline to keep safe.

**Accepted:** Many mail clients block remote images, and a logo only loads when `APP_URL` is publicly
reachable; the coloured header and the alt text carry the brand otherwise.
