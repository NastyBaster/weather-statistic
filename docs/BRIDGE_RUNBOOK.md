# Agent Bridge runbook

Use `npm run bridge:doctor` for read-only prerequisites and `npm run bridge:once -- --dry-run` for a mutation-free plan. A live one-task run requires a clean synchronized `main`, one complete issue contract, one owner, one isolated worktree, and explicit owner approval for any merge.

The child never commits, pushes, edits GitHub metadata, merges, or accesses runtime capabilities. Stop on dirty state, scope mismatch, failed checks, ambiguous ownership, or missing audit evidence. Do not retry automatically or bypass protection.

Configure labels and branch protection manually after review. Batch/watch, process scanning, execution leases, installers, scheduler validation, Supabase operations, and production work are out of scope.

For a documentation-only run, the parent may supply a trusted commit message and fixed check IDs, for example: `npm run bridge:once -- -- --commit-message "docs: record verified development forecast scan" --checks bridge-tests,npm-check,diff-check`. The commit message is parent-owned CLI input only; the Bridge does not derive it from issue text, comments, or titles.

Approved check IDs are fixed and repository-local:
- `bridge-tests` -> `npm run test:bridge`
- `npm-check` -> `npm run check`
- `diff-check` -> `git diff --check`

Unknown check IDs fail before ownership claim. The issue contract still must contain the exact approved backtick commands, and the selected check IDs must resolve to that same safe set.

Git lifecycle gates are enforced with machine-readable status:
- Before ownership and worktree creation: `main` must be clean, synchronized, and free of in-progress Git operations.
- After worktree creation: the task worktree must be clean.
- After child execution and again after local checks: `git status --porcelain=v1 -z --untracked-files=all` must show only allowlisted paths, and the post-check path set must match the post-child path set.
- After parent commit and after push/PR handoff: the task worktree must be clean and its local `HEAD` must remain the expected committed head.

After a successful handoff, the parent writes one sanitized retained-task state outside the repository for later cleanup. It contains only the issue number, PR number, expected branch, derived worktree ID, expected pushed head, optional owner capability identifier, and lifecycle state. This retained state blocks the next live task until the previous lifecycle is resolved:
- `previous_task_review_pending`: the retained PR is still open
- `previous_task_cleanup_required`: the retained PR is merged and verified cleanup must run first
- `unexpected_existing_worktree`: any other extra or ambiguous worktree state

Run `npm run bridge:cleanup` only after the PR is merged and the issue is closed according to repository policy. Cleanup verifies the exact retained task identity, the canonical repository, base `main`, expected task branch, expected pushed head, registered clean task worktree under the dedicated runtime root, no in-progress Git operation in that task worktree, remote branch absence after normal merge cleanup, and a clean intact root `main`. It then removes only the verified task worktree with `git worktree remove`, prunes metadata, deletes only the exact local task branch, re-verifies the remaining state, and clears the retained state last. Re-running cleanup after success is safe and idempotent.

If a task stops before cleanup, inspect the retained local state with `node scripts/agent-bridge/cli.mjs recover`. Recovery is read-only and returns only sanitized categories such as `clean_unpushed_task`, `dirty_task_requires_owner_review`, `pushed_pr_review_pending`, `merged_task_cleanup_ready`, `task_identity_mismatch`, or `unexpected_worktree`. Dirty or ambiguous task worktrees remain manual-review cases; the Bridge does not force-delete them or auto-merge anything.

Supabase, SQL, HTTP collector, pg_net, deployment, migrations, Cron, secret mutation, and production access remain deny-by-default. This runbook change does not authorize runtime operations.
