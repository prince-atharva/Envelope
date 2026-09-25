# Engineering Instructions

## Project Documentation

The `docs/` directory is the source of truth for product requirements,
architecture, data model, API contracts, security decisions, ADRs,
implementation roadmap, and phase plans.

Before implementing a feature:

1. Read the relevant product requirements.
2. Read the architecture documentation.
3. Read the data model documentation.
4. Read relevant ADRs.
5. Read the implementation roadmap.
6. Read the current phase plan.
7. Read existing code related to the module.
8. Only then propose or implement changes.

Do not invent requirements when the documentation already defines them.

If the documentation conflicts with the existing code, stop and report
the conflict before making a large change.

---

## Development Strategy

Development must follow:

Requirements
→ Architecture
→ Roadmap
→ Phase
→ Module
→ Task
→ Implementation
→ Tests
→ Review

Do not implement future phases while working on the current phase unless
the current task explicitly requires a dependency.

Do not redesign unrelated modules.

---

## Phase-Based Development

At the beginning of each phase:

1. Read the complete phase plan.
2. Identify all phase steps.
3. Check which steps are already implemented.
4. Inspect the existing code and tests.
5. Create an implementation checklist.
6. Work on one module/task at a time.

After completing each task:

1. Run relevant tests.
2. Run type checking.
3. Run linting when applicable.
4. Review the diff.
5. Update the phase plan progress if appropriate.
6. Report exactly what was changed.
7. Report remaining work.

Never mark a task complete unless its acceptance criteria have been
verified.

---

## Code Changes

Follow existing project conventions.

Prefer:

* Existing utilities
* Existing services
* Existing components
* Existing database patterns
* Existing error handling
* Existing authentication/authorization patterns

Avoid:

* Unnecessary dependencies
* Duplicate utilities
* Unrelated refactors
* Changing public APIs without approval
* Changing database schemas without checking the data model
* Changing architecture without checking ADRs

Keep changes small and reviewable.

---

## Database

Before changing database structure:

1. Read `docs/05-data-model.md`.
2. Read relevant ADRs.
3. Inspect the existing schema.
4. Check existing migrations.
5. Consider backward compatibility.
6. Add/update tests where appropriate.

Never silently change production-sensitive data behavior.

---

## API

Before changing an API:

1. Read `docs/08-api-specification.md`.
2. Inspect the existing endpoint.
3. Preserve existing contracts unless the task explicitly changes them.
4. Add validation.
5. Add appropriate tests.

---

## Security

Security-sensitive behavior must follow:

* `docs/10-security-and-threat-model.md`
* Relevant ADRs
* Relevant phase plan

Never log secrets, signing tokens, credentials, or sensitive document data.

---

## Testing

Every implementation should include appropriate tests.

For important workflows prefer:

Unit tests
→ Integration tests
→ Browser/E2E tests where applicable

Do not remove or weaken existing tests merely to make a task pass.

---

## Working Style

Before coding:

* Understand.
* Inspect.
* Plan.

While coding:

* Make the smallest correct change.
* Reuse existing patterns.
* Keep scope limited.

After coding:

* Test.
* Review.
* Summarize.
* Identify remaining risks.

If requirements are ambiguous or contradictory, stop and ask for clarification
rather than making a major assumption.
