# Agent Bridge runbook

Use `npm run bridge:doctor` for read-only prerequisites and `npm run bridge:once -- --dry-run` for a mutation-free plan. A live one-task run requires a clean synchronized `main`, one complete issue contract, one owner, one isolated worktree, and explicit owner approval for any merge.

The child never commits, pushes, edits GitHub metadata, merges, or accesses runtime capabilities. Stop on dirty state, scope mismatch, failed checks, ambiguous ownership, or missing audit evidence. Do not retry automatically or bypass protection.

Configure labels and branch protection manually after review. Batch/watch, process scanning, execution leases, installers, scheduler validation, Supabase operations, and production work are out of scope.
