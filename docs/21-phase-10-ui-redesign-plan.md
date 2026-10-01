# Phase 10: UI Redesign Plan

| | |
|---|---|
| **Status** | Approved — implementation starting |
| **Version** | 1.0.0 |
| **Last updated** | 1 October 2026 |
| **Audience** | Everyone (Part 1) · Developers (Part 2) |
| **What this doc answers** | How will every existing web screen get a consistent professional layout while preserving its features and business logic? |

# PART 1: In Plain Terms

## What Phase 10 Is

A complete visual redesign of Envelope powered by HealthProHub. The user selected a professional
workspace direction: left navigation, a compact header, light backgrounds and restrained brand accents.
Phases 1–9 are complete through v0.10.0; this cross-product redesign is a new phase, not an extension
of templates or integration. Production infrastructure and deferred features in docs/11 and docs/20
remain separate work.

The current header puts the logo, navigation, search, identity, Account and Sign out on one row.
The redesign gives navigation a dedicated place and applies one visual system to every existing page.
Existing workflows, labels, information, permissions and business logic MUST remain intact.

## Proposed Visual Direction

- A light 240px desktop sidebar with the existing brand, workspace identity and navigation.
  Documents, Templates, existing bulk batches, Verify, Account and role-appropriate Settings remain
  easy to reach. At narrower widths the navigation becomes an accessible drawer.
- A compact 64px utility header with page context, existing quick search and account actions.
  No new notifications, analytics, workspace switching or unsupported controls.
- Off-white page canvas, white content surfaces, dark slate text and the current teal accent.
  Use teal for the primary action and selected navigation; status colours retain text labels.
- Inter typography: 28–32px page titles, 18–20px section titles, 14–16px body and form text.
  Consistent 4/8px spacing increments, 8–12px corner radii, quiet borders and minimal shadows.
- One clear page title and primary action, aligned toolbars, consistent table rows, useful empty
  states, restrained loading indicators and visible inline errors.
- Document editors dedicate more space to the PDF, with recipients and fields in clearly grouped
  panels. Signing screens stay focused on the document and next existing action.
- Authentication pages use a restrained brand panel and readable form on desktop, a single column
  on mobile. Public verification and download pages share the same typography and controls.

```text
+----------------------+--------------------------------------------------+
| Envelope             | Page context       Quick search   Account       |
| Workspace            +--------------------------------------------------+
|                      | Page title                    Existing action   |
| Documents            | Supporting description                          |
| Templates            |                                                  |
| Bulk batches         | Existing filters / tabs / search                 |
| Verify               | +----------------------------------------------+ |
|                      | | Existing records, forms or document content  | |
| Settings (by role)   | | Consistent spacing, statuses and row actions | |
| Account              | +----------------------------------------------+ |
+----------------------+--------------------------------------------------+
```

This uses the separation of product navigation and global utilities documented in
[Carbon's UI shell](https://carbondesignsystem.com/components/UI-shell-left-panel/usage/).
It is a design reference, not a dependency or a claim that one layout is universally best.

## Screen-by-Screen Layout Specification

| Surface | Layout and visual treatment | Behavior to preserve |
|---|---|---|
| Documents | Page heading, existing count summaries, unified filter toolbar and structured document rows; compact status and progress | Current default view, query/filter/sort, pagination, reminders and creation |
| Templates | Consistent page heading and list cards; metadata separated from role-dependent actions | Use, rename, archive, restore and send-to-many permissions |
| Bulk send | Single readable form flow with bounded CSV preview and clearly grouped confirmation | Parser, validation, row errors and submit payload |
| Bulk batches / results | Aligned count summaries and readable row outcomes with document links | Polling, partial failure and existing retry guidance |
| New document | Clear upload surface and grouped document settings | File restrictions, category validation and upload progress |
| Document detail | Title/status/actions followed by document, recipients and audit sections | Downloads, lifecycle banners, permissions and save-as-template |
| Prepare | Workspace toolbar, recipient/field rail and maximum usable PDF area | Drop coordinates, selection, keyboard movement, resize and autosave |
| Review | Readable recipient/settings summary beside document preview | Readiness checks, recipient order and send confirmation |
| Account | Consistent section cards for profile, password and two-factor security | Validation, sessions, recovery-code handling and confirmations |
| Settings / users | Settings subnavigation, aligned member rows and invite controls | Role floors, removal and reset confirmations |
| Settings / integrations | Grouped API-key/webhook panels, locally scrolling reference/examples | One-time secrets, origin configuration, delivery tools and access rules |
| Login / registration | Desktop brand panel plus focused form; mobile single-column form | All existing fields, errors, sign-in and registration flow |
| Forgot/reset password / invitation | Shared public surface, readable status feedback and forms | Token checks, success/failure states and redirects |
| Two-factor challenge/enrolment | Clear code entry, setup and recovery sections | Challenge, required setup, QR and recovery codes |
| Signing consent | Calm focused introduction and equally readable consent/actions | Exact consent wording and server-enforced gate |
| Signing workspace | Quiet document canvas, clear progress and accessible action bar | All field types, adoption, typed/drawn capture, draft and submission |
| Signing end states | Consistent result icon, heading, explanation and existing next action | Expired, cancelled, declined, replaced, completed and already-used outcomes |
| Verify | Public upload/result surface with clear evidence hierarchy | Genuine verification outcomes; no invented trust claims |
| Download | Public document result and download/renewal states | Token lifecycle and existing access behavior |
| Embedded editor | Same editor visual vocabulary within the host frame, without sender sidebar | Origin/session checks, save/close, resize and messages |
| Shared dialogs/search | Consistent spacing, focus, title, body and footer actions | Native dialog behavior, Escape, search shortcut and confirmations |

## Responsive and State Rules

Desktop navigation starts at 1024px; below it an explicit menu button opens the same links in a
native modal drawer. Page padding is 16px on phones, 24px on tablets and 32px on wide screens.
Content may grow to a readable 1440px maximum; long forms keep a narrower reading width. Editor
panels adapt within their existing functional layout. No sidebar or header decoration may alter
canvas/overlay coordinate space.

Every changed surface MUST include its existing loading, empty, populated, validation and server-error
states. Status presentation MUST pair colour with text. Long names and titles wrap or truncate with
an accessible full value, while action controls remain reachable. Destructive confirmations remain
explicit; visually quiet controls MUST retain readable text and focus indicators.

The designer/implementer MUST review screenshots at desktop, tablet and phone sizes, plus 1024px
navigation transition checks. Keyboard checks cover opening/closing navigation, quick search,
dialogs, tabs and signing. The screenshot gallery is evidence of appearance, not a replacement
for behavioral tests or a claim of full accessibility certification.

## The Phase 10 Finish Line

- [ ] All existing sender, account, authentication, public, signing and embedded editor screens
  use the approved visual system, including dialogs, error, empty and loading states.
- [ ] Desktop, tablet and phone navigation expose all existing permitted actions without overlap.
- [ ] At 375, 768, 1024 and 1440px widths, and 200% browser zoom, controls remain usable. Wide
  document/table regions may scroll locally; ordinary pages MUST NOT overflow horizontally.
- [ ] Keyboard focus, drawer/dialog dismissal and focus return work; text contrast is at least
  4.5:1, control/focus contrast 3:1, and touch targets meet docs/09's 44px requirement.
- [ ] Existing browser flows pass without weakening their assertions. Field placement, zoom,
  autosave, consent, signature capture and submission retain their behavior.
- [ ] Before/after screenshot galleries cover every route family and representative states;
  visual review checks alignment, hierarchy, density, long text and mobile layouts.
- [ ] Required verification is recorded with exact results and any confirmed baseline failures.

## What We Need From You

| Needed | Why | When |
|---|---|---|
| Approval of this plan | User explicitly approved implementation on 1 October 2026 | Resolved |
| Visual direction | Professional workspace selected by the user on 1 October 2026 | Resolved |

# PART 2: Technical Detail

## Decisions Made Before Starting

| Question | Decision |
|---|---|
| Scope | Presentation across existing web features; no new product features |
| Framework | Retain React, Tailwind, current SVG icons and bundled Inter; no dependencies |
| Brand | Retain Envelope/HealthProHub identity and teal palette; refine usage |
| Layout | Sidebar for sender workspace; focused public and document experiences |
| Allowed state | Presentation state such as mobile drawer visibility only |
| Protected code | API clients, query keys, auth guards, validation, mutations, business state, PDF coordinate calculations and embed protocol |
| Copy | Preserve action/accessibility labels, legal consent and domain terminology |
| Data | Only existing queries and values; no fabricated metrics or new requests |
| Release | Record in Unreleased after build; release, push and tag require separate instruction |

## ADRs Written in This Phase

[ADR 0031](adr/0031-separate-workspace-navigation-from-document-surfaces.md) records the shell
boundary and its document-space tradeoff. No API, schema, environment or logging changes are needed:
this phase introduces no business state transitions.

## Steps

| # | Step | Status | Commit |
|---|---|---|---|
| 1 | Visual foundations and reusable page patterns | Planned | — |
| 2 | Sender shell, header and responsive navigation | Planned | — |
| 3 | Documents, templates and bulk-send pages | Planned | — |
| 4 | Document detail, preparation and review | Planned | — |
| 5 | Account, settings and authentication | Planned | — |
| 6 | Signing, public pages and embedded editor | Planned | — |
| 7 | Cross-screen visual coverage and documentation | Planned | — |

## Step 1: Visual Foundations

Capture the current gallery using `apps/web/e2e/gallery/` on the isolated browser stack before
changing UI. Inventory route/state coverage against `SenderApp.tsx` and `main.tsx`; extend missing
coverage during the owning step. Update `styles/index.css`, `components/ui/` and existing icons;
add small reusable page-header and section patterns only where repeated layouts justify them.
Retain component props and native button/link semantics. Cover focus, errors, disabled/loading
controls and reduced motion using existing Tabs/Skeletons tests and applicable component tests.
No tests that merely assert CSS class strings.

## Step 2: Sender Shell

Rework `components/layout/AppShell.tsx`, `UserBar.tsx`, `SettingsNav.tsx` and `AppFooter.tsx`.
Reuse existing auth, role checks, routes, quick-search modal and keyboard shortcut. Sidebar active
states MUST include nested document routes. Mobile drawer MUST close on navigation, support Escape,
contain focus while open and restore focus on dismissal. Reuse dialog behavior where appropriate.
Add `e2e/ui-layout.spec.ts` for navigation at target widths, role visibility, keyboard access,
long workspace names and overflow. Existing `auth-flow`, `dashboard`, `account` and `integrations`
browser specs protect route access and actions.

## Step 3: Work Lists

Restyle `pages/DashboardPage.tsx`, `TemplatesPage.tsx`, `features/templates/` and `features/bulk/`.
Unify headings, counts already fetched, tabs, filters, lists, CSV preview/results, dialogs and
empty states. Preserve current sorting, filtering, pagination, validation and mutation handlers.
Tests: existing `dashboard.spec.ts`, `templates.spec.ts`, `bulk-send.spec.ts`; add gallery cases
for long titles, empty lists, loading/error presentation and locally scrolling CSV tables.

## Step 4: Document Workspaces

Restyle `EnvelopeDetailPage`, `NewEnvelopePage`, `PreparePage`, `ReviewPage`, builder panels,
recipient progress, lifecycle banners and sending dialogs. Keep primary actions visible and audit,
recipient and file information readable. Use outer layout containers only for PDF decoration:
MUST NOT add padding, borders or transforms between canvas and field overlay (ADR 0002, docs/09).
Reuse `PdfViewer`, `RecipientPanel`, `FieldPalette`, existing autosave and state utilities.
Tests: `upload-and-view`, `field-builder`, `sending`, `completed`, `cancel`, `expiry`,
`partner-reference`; gallery covers editor widths, review, audit and lifecycle states.

## Step 5: Accounts and Administration

Restyle `AuthLayout`, Login/Register, password-reset and invite screens, two-factor screens,
`AccountPage`, `SettingsUsersPage`, `SettingsIntegrationsPage` and their feature components.
Keep secrets, recovery codes, role gates, validation and confirmation behavior intact. Large
integration examples scroll inside their panels. Reuse `Field`, `Alert`, `DialogShell` and existing
account/two-factor components. Tests: existing auth, password-reset, account, two-factor and
integration unit/browser tests; extend the gallery for users/settings and validation states.

## Step 6: Signing and Public Surfaces

Restyle `PublicFrame`, `features/signing/`, `features/download/`, `features/verify/` and the
presentation in `features/embed/EmbeddedApp.tsx`. Share visual primitives without importing sender
auth or navigation into public bundles. Preserve consent wording/gate, typed and drawn signatures,
PDF geometry, sticky-action clearance, token handling and embed messages. Tests: `signing`,
`approver`, `completed`, `verify`, `embed`, `token-leak`, plus existing feature unit tests.
Exercise mobile signing on iPhone/WebKit and Pixel/Chromium; inspect sheets with the keyboard open.

## Step 7: Coverage and Documentation

Complete the route/state gallery, `ui-layout.spec.ts`, and manual contrast/keyboard/zoom checklist.
Inspect actual before/after screenshots rather than treating screenshot generation as approval.
Update this plan with evidence and commits, docs/README status and CHANGELOG Unreleased. Add an
“As built” note beside docs/09's affected layouts after implementation. No release/version bump.

## Deliberate Simplifications

- No dark mode, theme switcher, new logo, extra UI library, new feature or external font request.
- Emails, generated PDFs and certificates are not web UI and remain outside this phase.
- Current business limitations in docs/20 remain; redesign does not add template editing,
  cancellation of bulk jobs, analytics or delivery capabilities.
- Review baseline failures before attributing them to this change. docs/20 records WebKit clipboard
  permission failures, Pixel embedded-editor closing failures, a Pixel field-zoom failure and an
  unexplained expiry timeout. These are historical reports, not verified results for this phase.

## Verification

Follow `.claude/skills/phase-build/SKILL.md`: build in order, snapshot each step, convention review,
then run the required final checks once and fold fixes into the owning snapshots. Verify rebuilt
snapshots individually as required before committing in order.

Use the nvm PATH in AGENTS.md. Final checks: `pnpm lint`, `pnpm typecheck`, `pnpm test`, full API e2e
with Node 22.19.0, browser e2e on desktop-chrome, mobile signing/layout checks, and `pnpm --filter
@envelope/web ui:gallery`. Tests MUST use isolated databases, Redis, storage and mail; never `.env`
or the development servers. Record test failures and investigate isolated reruns; never weaken tests.
The previously documented shared typecheck failure was fixed in commit e5e82b4; do not assume it
still exists. Planning itself runs no product tests and makes no claims of visual verification.
