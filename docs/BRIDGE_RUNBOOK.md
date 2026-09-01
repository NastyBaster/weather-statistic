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

Supabase, SQL, HTTP collector, pg_net, deployment, migrations, Cron, secret mutation, and production access remain deny-by-default. This runbook change does not authorize runtime operations.
