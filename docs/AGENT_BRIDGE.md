# Single-task Agent Bridge

This repository uses a bounded, Node-only single-task lifecycle. The parent validates one `agent:ready` issue, claims it, creates an isolated worktree, invokes a scoped child, validates paths and checks, commits, pushes, opens one PR, and stops at the human merge boundary.

Runtime capabilities are deny-by-default: SQL, HTTP, pg_net, collector, deployment, secrets, migrations, Cron, and production operations are never implied by an issue.

State is stored outside the repository under the local application-data root and is separate from scheduler validation state. Audits contain sanitized categories only.

The parent may override the default Bridge commit message with `npm run bridge:once -- -- --commit-message "<validated conventional commit>"`. Messages are validated before ownership claim or worktree creation. They must use one of `feat`, `fix`, `docs`, `test`, `refactor`, `chore`, `ci`, `build`, `perf`, or `revert`, may include an optional scope, must have a non-empty subject, must not contain CR, LF, NUL, leading or trailing whitespace, or shell metacharacters, and are capped at 120 characters.

The parent may also choose a fixed set of approved local checks with `--checks bridge-tests,npm-check,diff-check`. These IDs resolve to hardcoded array-argument commands only: `npm run test:bridge`, `npm run check`, and `git diff --check`. The Bridge never executes issue-provided or caller-provided shell text as a check command.

Git status is enforced as a lifecycle invariant, not as an arbitrary task command. The parent requires a clean `main` with no in-progress Git operation before ownership, a clean new task worktree before child execution, machine-readable `git status --porcelain=v1 -z --untracked-files=all` validation after the child and again after checks, and a clean committed and pushed task worktree afterward. Rename and copy records are parsed from porcelain `-z`, and every changed path must remain within the issue allowlist.

After a task reaches PR review boundary, the parent retains only a minimal sanitized cleanup state outside the repository: issue number, PR number, expected branch, derived worktree ID, expected pushed head, optional owner capability identifier, and lifecycle state. The next live `bridge:once` run still preserves one-task-at-a-time behavior, but it now distinguishes:
- `previous_task_review_pending` for a retained task whose PR is still open
- `previous_task_cleanup_required` for a retained task whose PR is merged and ready for verified cleanup
- `unexpected_existing_worktree` for any other extra or ambiguous worktree state

Use `npm run bridge:cleanup` only after the human merge boundary. Cleanup is parent-owned, idempotent, and fail-closed. It verifies the retained state, exact PR/issue/branch/head identity, clean registered task worktree inside the dedicated runtime root, remote branch absence after normal merge cleanup, clean root `main`, and exact local-branch/worktree identity before removing only the verified task worktree and exact local task branch. It never force-removes a dirty worktree, never deletes an unexpected branch, and never performs Supabase or runtime operations.

For blocked or abandoned local task state, inspect recovery with `node scripts/agent-bridge/cli.mjs recover`. Recovery returns sanitized categories only, such as `clean_unpushed_task`, `dirty_task_requires_owner_review`, `pushed_pr_review_pending`, `merged_task_cleanup_ready`, `task_identity_mismatch`, and `unexpected_worktree`. It does not delete worktrees or release ownership automatically.
