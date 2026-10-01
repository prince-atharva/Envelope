# 0031. Separate Workspace Navigation from Document Surfaces

**Status:** Accepted
**Date:** 2026-10-01
**Deciders:** Product owner, engineering

## Context

The user requested a full UI redesign preserving features and logic, and selected a professional
workspace with left navigation and a compact header. The current sender header combines navigation,
search and account controls. A sidebar improves navigation capacity but consumes PDF workspace width.
Public signing and embedded editing have different identity and navigation boundaries (ADR 0012,
0016 and 0017).

## Decision

Use a responsive sidebar and compact utility header for authenticated sender screens. Preserve
existing route and role behavior. At narrow widths navigation becomes a keyboard-accessible drawer.
Document pages use the available content width; decoration stays outside the PDF overlay geometry.
Public signing, verification, download and embedded screens share presentation primitives but retain
their independent shells, authentication boundaries and bundles. Use current React/Tailwind components.

Rejected: retaining every navigation item in the header (crowding grows); applying the sender sidebar
to public or embedded screens (wrong navigation and identity context); installing a new component
framework (migration and behavioral risk beyond this presentation-only request).

## Consequences

**Easier:** Consistent navigation, page hierarchy and shared visual maintenance.

**Harder:** More responsive layouts to verify; sidebar width reduces the document area on desktop.

**Accepted:** UI-only drawer state and focused shell variants are necessary. Existing business state,
API contracts, permissions, PDF coordinate math and embed messages MUST remain unchanged.
