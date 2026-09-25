@AGENTS.md

## Claude Code specifics

- Project skills, invoked with the Skill tool or as slash commands:
  - `/phase-plan` — plan a new phase (docs/NN plan, ADRs, approval) before any code.
  - `/phase-build` — implement an approved plan: all steps, one verification run, one commit per step.
  - `/release` — version bump, changelog, annotated tag, after a phase's finish line is green.
- Project subagent: `convention-reviewer` — reviews the uncommitted diff against AGENTS.md and the
  current phase plan. Run it after coding and before the verification run.
- Use plan mode for anything that starts a new phase or changes the schema or a public API.
