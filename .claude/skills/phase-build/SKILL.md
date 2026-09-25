---
name: phase-build
description: Implement an approved Envelope phase plan — write code and tests for every step in order, snapshot each step as a git tree, run the full verification once, fold fixes back into the step they belong to, verify each step builds alone, then commit one commit per step. Use after /phase-plan is approved, or when the user says to start building a planned phase.
---

# Build a Phase

Input: an approved `docs/NN-phase-*-plan.md`. Output: one commit per plan step, every commit
building on its own, the whole suite green on the last one.

Always export the toolchain first (see AGENTS.md §4):

```bash
export PATH="$HOME/.nvm/versions/node/v22.22.0/bin:$HOME/.local/share/pnpm:$PATH"
S=<your scratchpad dir>    # snapshot hashes, patches and temp indexes live here, never in the repo
```

## 1. Before the first step

- `git status` must be clean, or contain only changes you understand. Never build on top of the
  user's uncommitted work without asking.
- Re-read the plan's Steps table and each step section. Make a task list mirroring the steps.

## 2. Write each step (code + tests), in plan order

For each step:

1. Implement exactly what the step describes, reusing the patterns it names (AGENTS.md §7).
2. Write its tests (unit in `src/**/*.test.ts`, e2e in `apps/api/test/*.e2e.test.ts` or
   `apps/web/e2e/`). Follow AGENTS.md §6: real services, no internet, no dev DB, wait for workers.
3. Quick checks only: `pnpm --filter @envelope/api typecheck` (and `lint` if you like). Do **not**
   run the full e2e suites yet.
4. Snapshot the whole tree, then unstage:

   ```bash
   git add -A . && echo "SNAP<k>=$(git write-tree)" >> $S/snapshots.env && git reset -q
   ```

   Take the snapshot **before touching any file for the next step**. If a file shared by two steps
   (e.g. `app.module.ts`) was already edited for step k+1, build step k's tree by hand instead:

   ```bash
   export GIT_INDEX_FILE=$S/idx.k && rm -f $GIT_INDEX_FILE
   git read-tree <SNAP k-1>
   git update-index --add --cacheinfo 100644,$(git hash-object -w <file>),<file>   # per file
   git update-index --add --cacheinfo 100644,$(git hash-object -w $S/<file-as-of-step-k>),<file>
   git write-tree; unset GIT_INDEX_FILE
   ```

If the plan turns out wrong mid-build (a step cannot build alone, a schema change was missed), stop
and tell the user; update the plan document before continuing.

## 3. Review, then verify everything once

1. Run the `convention-reviewer` subagent on the working tree; fix what it finds.
2. Run the full verification from AGENTS.md §5: lint, typecheck, unit, API e2e (Node 22.19.0),
   browser e2e (desktop-chrome) when the web app or its stack's env changed.
3. Investigate every failure to its cause. A flaky test is a cause to find, not a label: rerun in
   isolation, read Postgres logs (`docker logs digitalsign_postgres --since 10m`) for deadlocks,
   run with `TEST_LOG_LEVEL=debug`.

## 4. Fold fixes into the step they belong to

Diff the last snapshot against the fixed tree, then apply each file's fix to every snapshot from
the step that introduced that file onward:

```bash
git add -A . && CUR=$(git write-tree) && git reset -q
git diff <SNAP last> $CUR --stat                      # what changed during verification
git diff <SNAP last> $CUR -- <file> > $S/fix-<file>.patch
for k in <owner step> … <last step>; do
  export GIT_INDEX_FILE=$S/idx.fix$k; rm -f $GIT_INDEX_FILE
  git read-tree <SNAP k>
  git apply --cached $S/fix-<file>.patch || echo "step $k: apply by hand"
  echo "NEW$k=$(git write-tree)"; unset GIT_INDEX_FILE
done
```

Where a patch does not apply to an earlier step's older version of the file, write that step's
version by hand (`git show <SNAP k>:<file> > $S/...`, edit, `hash-object -w`, `update-index`).
The last step's tree is always the real working tree (`$CUR`).

## 5. Prove every step builds on its own

Check out each rebuilt tree in a scratch worktree and run typecheck, lint and unit tests:

```bash
W=$S/wt && git worktree add --detach $W HEAD
cd $W && ln -sfn "<repo>/node_modules" node_modules
for d in apps/api apps/web packages/shared; do cp -a "<repo>/$d/node_modules" $d/node_modules; done
# per tree:
git read-tree -u --reset <NEWk>
rm -rf apps/api/src/generated && cp -a "<repo>/apps/api/src/generated" apps/api/src/generated
(cd packages/shared && npx tsc -p tsconfig.build.json)
(cd apps/api && npx tsc -p tsconfig.json --noEmit && npx vitest run)
npx biome check .
# afterwards:
git worktree remove --force $W
```

(`cp -a` keeps pnpm's relative symlinks, so `@envelope/shared` resolves to the worktree's own
copy. Copy `apps/api/src/generated` only if no step changed the Prisma schema; otherwise run
`npx prisma generate` per tree.)

## 6. Commit, in order

```bash
commit() { git read-tree "$1" && git commit -q -F - && git log --oneline -1; }
commit <NEW1> <<'EOF'
feat(api): <what step 1 gives the user>

<Why, and what it covers — "Phase N step 1 (docs/NN)".>

Co-Authored-By: <the attribution line your harness specifies>
EOF
# … one per step
git status --short   # must be empty (only ignored files like .env remain)
```

The working tree is never touched by this; after the last commit it equals HEAD.

## 7. Close out the build

- Mark each step ✅ Done in the plan's Steps table, set the plan's Status to "Built", and add the
  phase to `CHANGELOG.md` under `[Unreleased]` (Added / Changed / Fixed). Fold these into the last
  step's commit, or commit them as `docs: Phase N built; record it across the docs`.
- Report to the user: the commits, what was verified, any flake and its cause, pre-existing
  problems found but not fixed, and what remains before `/release`.
