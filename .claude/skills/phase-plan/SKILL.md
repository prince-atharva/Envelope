---
name: phase-plan
description: Plan a new phase or sub-phase of the Envelope platform before any code is written — research the docs, ask the user about real gaps, write docs/NN-phase-*-plan.md and any ADRs, get approval, commit the plan on its own. Use whenever the user asks to start, design or scope the next phase or a large feature.
---

# Plan a Phase

No product code is written until this procedure ends with the user's approval. The output is a
phase plan document, any ADRs it needs, and one `docs:` commit.

## 1. Find where we are

```bash
git log --oneline -20 && git tag -l && git status --short
ls docs/ docs/adr/
```

Read `CHANGELOG.md` (`[Unreleased]` and the latest version), `docs/README.md`, and the
highest-numbered `docs/NN-phase-*-plan.md` — especially its **Deliberate Simplifications** and
**What We Need From You**, which usually feed the next phase.

## 2. Read what the docs already decided

For the phase's area, read the relevant parts of:

- `docs/11-implementation-roadmap.md` — what this phase was scoped to contain
- `docs/01-product-requirements.md` — the MUST/SHOULD requirements and non-goals
- `docs/03-architecture.md`, `docs/05-data-model.md`, `docs/08-api-specification.md`
- `docs/10-security-and-threat-model.md`
- `docs/adr/` — every ADR the phase could touch

Then read the existing code the phase will change (use an Explore subagent for broad searches).
Record, for yourself: what the docs define exactly, what they leave open, and where docs and code
disagree.

## 3. Ask about the genuine gaps

Use AskUserQuestion (2–4 questions, each with a recommended option first) for decisions only the
user can make: scope (full phase or a first slice?), shape (e.g. headless API vs embedded UI),
the first customer or partner, anything the docs leave undefined. Do not ask about what the docs
already answer. If docs and code conflict, report it and ask before planning around it.

## 4. Write the plan

File: `docs/NN-phase-<n>-<slug>-plan.md`, where NN is one more than the highest existing number.
Model it on `docs/17-phase-6-compliance-plan.md` and `docs/18-phase-6b-integration-foundation-plan.md`.

```markdown
# Phase N: <Name> Plan

| | |
|---|---|
| **Status** | Planned |
| **Version** | 1.0.0 |
| **Last updated** | <D Month YYYY> |
| **Audience** | Everyone (Part 1) · Developers (Part 2) |
| **What this doc answers** | What does Phase N deliver, how is each part built, and how do we check it? |

---

# PART 1: In Plain Terms

## What Phase N Is
<Why now, what it covers, what it deliberately does not. ASCII diagram if it helps.>

## What You Can Do at the End of Phase N
1. <User-visible capability, plain words>

## The Phase N Finish Line
- [ ] <Verifiable acceptance criterion — each one is checked by a test>

## What We Need From You
| Needed | Why | When |
|---|---|---|

---
---

# PART 2: Technical Detail

> Written for developers. Non-technical readers can stop here.

## Decisions Made Before Starting
| Question | Decision |
|---|---|

## ADRs Written in This Phase
- [ADR NNNN](adr/NNNN-....md) — <title>

## Steps
| # | Step | Status |
|---|---|---|
| 1 | <Shared contracts, schema, config> | Planned |
| … | … | … |
| k | Tests: the finish line | Planned |
| k+1 | Documentation and release `vX.Y.0` | Planned |

## Step 1: <Name>
<Files, models, endpoints, reuse of existing services, logging, tests for this step.>

## Deliberate Simplifications
- <What is knowingly left out or narrowed, and why>

## Verification
- <Commands and the test files that prove the finish line>
```

Rules for steps:
- Each step is one reviewable commit that **builds on its own** — order them so no step imports
  something a later step creates (shared contracts and schema first, wiring last).
- Every step names its tests. Every new state transition names its log lines.
- Name the existing utilities and patterns each step reuses (file paths), so the builder does not
  invent parallel ones.
- Any schema change lists the models, fields and indexes; any API change lists routes, roles,
  rate limits and error codes, and says whether docs/08 needs an "As built" note.

## 5. ADRs

For each decision that is expensive to reverse, trades one property for another, or would surprise
a competent reader: write `docs/adr/NNNN-<imperative-title>.md` in the Nygard format of the
existing ADRs (Context, Decision including rejected options, Consequences: Easier / Harder /
Accepted). Take the next free number — 0008 and 0010 are reserved — and add a row to
`docs/adr/README.md`'s index.

## 6. Index and approval

- Add the plan (and fix any stale row) in `docs/README.md`'s Full Contents table.
- Present a short summary to the user and **wait for approval**. In Claude Code, write the plan in
  plan mode and call ExitPlanMode.
- After approval, commit only the docs:

```bash
git add docs/NN-phase-*-plan.md docs/adr/ docs/README.md
git commit -m "docs: Phase N <name> plan, ADR NNNN"
```

Then continue with `.claude/skills/phase-build/SKILL.md`.
