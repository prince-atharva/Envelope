# 0035. Gate Accessibility with axe-core, Keyboard-Only and Device-Size Checks

**Status:** Accepted
**Date:** 2026-10-01
**Deciders:** Product owner, engineering

## Context

docs/09 sets WCAG 2.2 AA as the target for the signing journey and docs/11 lists an accessibility audit
as unfinished. Phase 10 recorded that contrast and the 44px target were not measured and that only
drawer behaviour was tested. Automated tools find only part of what WCAG covers; screen-reader
behaviour needs real assistive technology on real devices.

## Decision

We will add `@axe-core/playwright` as a dev dependency and run it, with the `wcag2a`, `wcag2aa`,
`wcag21a`, `wcag21aa` and `wcag22aa` tags, over every screen and popup the screenshot gallery reaches, on
the desktop and both phone projects. **Zero serious or critical violations is the bar.** Beside it:

- a keyboard-only signing test (typed signature path, focus order, visible focus, live-region progress);
- a 44x44 px touch-target check on the signing portal, a `prefers-reduced-motion` check, and a reflow
  check at 320 px and 200% zoom;
- a written manual script (VoiceOver, TalkBack, NVDA) that the product owner runs and records.

We claim "automated checks pass and the manual pass is recorded", **not** formal AA conformance or a
VPAT. Fixes add `aria-*` and hidden text; a visible label is never renamed, because browser tests select
by accessible name.

Rejected: **axe in unit tests with jsdom** (no layout or real contrast); **a hosted accessibility
service** (sends signing pages and tokens off-site); **declaring conformance from automation alone**.

## Consequences

**Easier:** An accessibility regression fails the browser suite like any other.

**Harder:** One more dependency, and a slower browser run.

**Accepted:** Issues automation cannot see remain until the manual pass finds them.
