# Single-task Agent Bridge

This repository uses a bounded, Node-only single-task lifecycle. The parent validates one `agent:ready` issue, claims it, creates an isolated worktree, invokes a scoped child, validates paths and checks, commits, pushes, opens one PR, and stops at the human merge boundary.

Runtime capabilities are deny-by-default: SQL, HTTP, pg_net, collector, deployment, secrets, migrations, Cron, and production operations are never implied by an issue.

State is stored outside the repository under the local application-data root and is separate from scheduler validation state. Audits contain sanitized categories only.
