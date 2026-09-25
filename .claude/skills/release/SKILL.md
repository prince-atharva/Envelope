---
name: release
description: Cut a release of the Envelope platform after a phase is built — run the finish-line suite, move CHANGELOG [Unreleased] into a version section, bump the version in all four package.json files, mark the phase plan Complete, commit "docs: release vX.Y.0" and create the annotated tag. Use when the user asks to release, tag, or ship a finished phase. Never pushes unless asked.
---

# Release

Model: the `docs: release v0.6.0` commit (`git show a1de982`) and tag `v0.6.0`.

## 1. Preconditions

- Every step in the phase plan is ✅ and committed; `git status` is clean.
- The plan's finish-line checklist is covered by tests. If the plan has a "Tests: the finish line"
  step that is not yet committed, finish and commit it first as `test(api): the Phase N finish line`
  (or `test(api,web): ...`).
- Ask the user which version: phases so far are minor bumps (`v0.6.0` → `v0.7.0`); a sub-phase
  like 6b may be released on its own or bundled — ask.

## 2. Run the full suite, all of it

With the toolchain exported (AGENTS.md §4):

```bash
pnpm lint && pnpm typecheck && pnpm test
PATH="$HOME/.nvm/versions/node/v22.19.0/bin:$PATH" pnpm --filter @envelope/api test:e2e
pnpm --filter @envelope/web test:e2e                     # every configured browser project
```

Record the counts (shared/API/web unit, API e2e files and tests, web e2e tests per project) for the
release commit body. Any flake: rerun in isolation, find the cause, and say so in the notes. Do not
release on red.

## 3. Edit the release files

1. `CHANGELOG.md`: rename `## [Unreleased]` content into `## [X.Y.0] - YYYY-MM-DD` with a one-
   paragraph summary on top (phase name, headline features, links to the plan doc and ADRs), then
   `### Added` / `### Changed` / `### Fixed`. Leave a fresh, empty `## [Unreleased]` above it.
2. Version `X.Y.0` in all four manifests: `package.json`, `apps/api/package.json`,
   `apps/web/package.json`, `packages/shared/package.json`.
3. The phase plan: Status → `Complete. Built and released as vX.Y.0`; finish-line boxes ticked;
   the release step ✅.
4. `docs/README.md` and `docs/11-implementation-roadmap.md`: reflect that the phase is complete, if
   they describe phase status.
5. Spec docs touched by the phase carry their "As built" notes (docs/08 especially).

## 4. Commit and tag

```bash
pnpm lint
git add CHANGELOG.md package.json apps/*/package.json packages/shared/package.json docs/
git commit -F - <<'EOF'
docs: release vX.Y.0

CHANGELOG.md's Unreleased section becomes [X.Y.0]: <phase summary>. Version
bumped to X.Y.0 across the root and all three workspaces. docs/NN closes out.

Full suite before tagging: <counts>. <Any flake, its cause, and the clean rerun.>

Co-Authored-By: <the attribution line your harness specifies>
EOF
git tag -a vX.Y.0 -m "Phase N: <Name>" -m "<two or three lines: what the release delivers>"
```

## 5. Stop

Report the commit, the tag and the suite counts. **Do not `git push` or `git push --tags` unless
the user explicitly asks** — pushing is visible to others and hard to undo.
