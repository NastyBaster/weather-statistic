# Scheduled forecast collector development validation

**Stage:** 5.2.1  
**Repository implementation date:** 2026-08-23  
**Remote development validation:** Scheduler schema applied; operational validation remains blocked

This record is intentionally sanitized. Repository work implements the accepted scheduler
contract, but it does not prove that a remote migration was applied, a secret was provisioned, an
Edge Function was deployed, or a Cron job was enabled. Production was not accessed or changed.

## Implemented repository controls

- Gateway JWT verification is disabled only for `collect-forecasts`; the function requires either
  the opaque scheduler Bearer secret or an allowlisted Supabase user JWT.
- Authentication derives `scheduled` or `manual`; request content cannot select `retry`.
- Requests require `POST` and an empty JSON object, and reject trigger/identity spoof headers.
- A partial unique index and transactional claim RPC enforce one running scheduled run. The RPC
  uses a fixed advisory transaction lock, locks the active parent row, rejects an age below 15
  minutes, and atomically terminalizes an inclusively stale run before claiming its replacement.
- Stale recovery deliberately does not assign or reconstruct `snapshots_created`.
- The collector writes snapshot batches only through a transactional RPC. Both that RPC and a
  `BEFORE INSERT` guard lock the parent and require it to remain `running`.
- A separate service-role-only `finalize_forecast_run` RPC locks the run parent, accepts only a
  still-running run, supplies database transaction time for completion, and returns only
  `finalized` or `run_no_longer_running`. Late collectors cannot replace stale-recovery evidence.
- The collector uses a monotonic 120-second budget with a 10-second terminalization reserve;
  provider attempts, backoff sleeps, database setup, and snapshot writes are deadline-aware.
- The scheduler credential is validated as exactly 32 bytes encoded as 43 unpadded base64url ASCII
  characters before authentication is enabled. Invalid managed configuration fails closed.
- The request surface requires JSON `{}` and permits only reviewed gateway/application headers;
  request data cannot select trigger, identity, retry, slot, or caller time.
- The migrations grant all three operational RPCs only to `service_role`; browser RLS and grants
  are unchanged.

## Local checks

The tracked `scripts/validate-scheduler-development.mjs` harness replaces disposable validation
scripts. Its default mode runs only synthetic offline fixtures; live development mode requires
explicit flags, independently verified target metadata, and a separately supplied trusted runtime
adapter. It stores no credentials or environment identifiers. Temporary-harness smoke validation
remains incomplete; Cron is not configured and production is unchanged.

A development-only hybrid runtime binding now connects the tracked harness to authenticated local
Supabase CLI metadata and Node built-in `fetch`. Its default remains synthetic/offline. A live
development run requires explicit development and production display-name inputs, confirmation,
and the `--hybrid-sql-editor` mode; production mode is intentionally unsupported. The CLI never
receives a database password or Vault plaintext.

The hybrid flow has a deliberately separated manual SQL boundary. It first writes a distinct
read-only pre-enqueue artifact, which establishes a durable database attempt boundary and
baseline before any negative request is made. That artifact verifies `pg_net`, the callable
`net.http_post` signature, the unique Vault secret name, no active scheduled run, and no relevant
Cron job without reading Vault plaintext. After an explicitly confirmed sanitized preflight
result, the harness performs the four bounded negative HTTP checks once, then writes separately
identifiable enqueue and post-enqueue evidence artifacts. Negative requests are never repeated
automatically, and an old Phase A result without a pre-negative durable baseline fails closed as
`existing_negative_baseline_not_provable` rather than claiming retrospective proof.

The local phase state is updated before each negative submission and again after its sanitized
response is observed. Any interruption therefore leaves a non-replayable manual-intervention
state rather than authorizing a repeated request. Final resume requires the tagged evidence
result and all allowlisted aggregate fields, and rejects no-run, running-run, multiple-run,
unknown-status, or active-run results before cleanup.

Strict request-contract rejections retain the top-level `invalid_request` error and add one stable,
non-sensitive reason code for development and operational diagnosis. The reason enum covers
unsupported content types, forbidden headers, invalid JSON, non-object bodies, and non-empty
objects; raw request/response logs remain prohibited.

The enqueue artifact repeats safety-critical checks in its own write transaction immediately
before its one `pg_net` call. It uses the same advisory lock as the scheduled claim protocol,
rejects changed scheduled-run baseline or an active run, verifies the extension, routine, Vault
name, and Cron state, and keeps the credential inside the database/Vault expression. The
read-only post-enqueue artifact is bound to the pre-enqueue boundary and reports only tagged
aggregate evidence: no/one-running/one-terminal/multiple runs, the schema terminal categories,
counters, invariants, duplicate snapshot identities, and unexpected active runs. Sanitized manual
transfer accepts only the required tagged aggregate fields. Tests remain synthetic; no SQL was
executed for this repository-only change, Cron is not configured, and production is unchanged.

The manual boundary is ordered and mandatory: prepare and run the read-only preflight, explicitly
authorize the four negative requests, then run the distinct read-only negative-evidence artifact.
Only a parsed zero-run/zero-active result for the same durable boundary enables preparation of the
exactly-once enqueue and post-enqueue evidence artifacts. Negative completion never creates enqueue
artifacts, and negative requests or enqueue are never repeated automatically. Artifacts are scoped
to one attempt and phase: stale write-capable files and partial files are removed before a new
attempt and before the negative-evidence gate, and cleanup failure blocks progress. A failed or
ambiguous negative-evidence result is persisted as a non-resumable terminal state; its earlier
evidence is retained, write-capable artifacts are removed, and a new authorization plus durable
baseline is required. An old SQL Editor tab cannot be closed by the CLI, so users must never run
an old tab; the in-database guards remain the final protection. Production is unsupported.

Rejected final post-enqueue evidence is terminal as well: the final-resume owner persists the
non-resumable state, removes all attempt artifacts, and releases its claim only after cleanup.
There is no automatic retry or stale-claim bypass, and a later final resume cannot replay the
rejected evidence.

Repeated final-resume calls are immutable once completion or terminalization is durable: they
return the recorded state without reparsing evidence or mutating artifacts. If artifact cleanup
fails during terminalization, the terminal state records manual intervention as required and the
sanitized cleanup category before claim release.

Terminalization first atomically invalidates the resumable state and leaves a minimal tombstone;
cleanup and detailed terminal-state persistence happen only afterward. Thus persistence or cleanup
failures remain non-resumable and use the sanitized `validation_artifact_cleanup_failed` category
when applicable. Manual intervention and a new authorized attempt with a new baseline are required;
no live validation occurred in this correction.

After a terminal attempt is durably recorded and its write-capable artifacts are cleaned, an
optional `--prepare-terminal-delivery-diagnosis` mode may publish one allowlisted,
attempt-bound, transactionally read-only delivery diagnosis artifact. It uses internal request /
response correlation only, normalizes the top-level error and reason to the reviewed enums, and
never projects identifiers, headers, credentials, or raw payloads. A separate
`--clear-terminal-delivery-diagnosis` mode removes only that diagnosis artifact while retaining
the durable terminal state; ambiguous correlation and unexpected entries fail closed. The SQL is
intended for a manual read-only Dashboard boundary and is never executed by the harness.
Correlation uses retained response metadata after queue dequeue, bounded by the durable attempt
boundary; zero candidates are uncorrelated and multiple candidates are ambiguous. Response JSON
is validity-guarded before object extraction so malformed, scalar, and array content yields no raw
diagnostic detail.

On resume, the negative-evidence state is exclusively consumed before submitted evidence is parsed.
If that consume operation fails, no evidence is accepted or persisted and no artifact is generated;
the original state remains available for a separately authorized recovery. Once consumed, the
resumable state is never restored, including across cleanup or persistence failures.

The exclusive resume claim is part of the attempt-scoped artifact lifecycle. It is acquired without
clobbering before state read or evidence parsing; concurrent losers and ambiguous/stale claims fail
closed. Ordinary reset has no owner capability: an existing claim (even an empty directory) is
preserved and reported as an active/ambiguous claim. Only the owning transition may release it with
`rmdir`, after the forward state and complete artifact set are durable; stale or crashed claims
require explicit manual recovery and are never removed automatically. Cleanup never recurses or
follows a symlink/reparse point. The trusted artifact root is created and verified before claim
acquisition when absent; deletion remains claim-protected and root verification fails closed.

The harness direct-entrypoint guard is normalized through Node file URL/path APIs so the same
documented command is recognized on Windows and POSIX paths, including spaces. This compatibility
fix does not execute a live validation or alter the scheduler contract.

Use one cross-platform command shape for an explicitly authorized hybrid development Phase A:

```text
npm run validate:scheduler:development -- --live-development --hybrid-sql-editor --confirm-development-smoke --development-name=<development-display-name> --production-name=<production-display-name>
```

The argument contract accepts the normal npm-forwarded vector and, for the Windows PowerShell npm
compatibility path that converts post-separator options into npm config values, reconstructs only
the allowlisted runtime options. Missing, duplicate, malformed, or unknown direct options still
fail closed before any environment operation.

Each read-only CLI metadata operation is recorded under a stable sanitized phase name. A failed
preparation reports the first failing phase plus allowlisted exit, output-shape, parser, and outcome
categories; earlier successful phase evidence is preserved and later phases are marked not attempted.
The harness never renders commands, arguments, CLI envelopes, stdout, stderr, or raw errors, and it
does not retry or attempt automatic CLI recovery. Correct a reported preparation failure before any
new explicitly authorized validation attempt.

Repository tests now include mocked handler/collector behavior, deterministic deadline and
abort-aware retry cases, credential-shape cases, and a local Supabase PostgreSQL integration suite
at `supabase/tests/database/forecast_scheduler.test.sql`. The database suite covers inclusive
stale claiming, counter preservation, batch atomicity and idempotency, finalize fencing,
single-flight concurrency, failed replacement rollback, both parent-lock orderings, deletion, and
snapshot immutability. Run it with `npm run test:db` against a disposable local Supabase stack.

In the repository hardening workspace, Node checks are available. Deno, Supabase CLI, Docker, and
`psql` availability must be recorded from the final check run; a missing tool is not treated as a
passing result. Remote development validation remains pending and no production environment was
accessed or changed.

## Local validation result (2026-08-24)

- Local PostgreSQL validation completed: 21 pgTAP assertions and 14 concurrency cases passed.
- Failed, skipped, and not-run database cases: 0.
- Node and Deno checks passed.
- The local stack was stopped after validation.
- Remote development validation remains pending; the scheduler is not enabled and production is
  unchanged.

## Development schema status (2026-08-25)

- Scheduler migrations `202608230001` and `202608240001` were applied to development; the
  development migration ledger is 5/5.
- A sanitized post-migration audit found that the three operational scheduler RPCs retained
  browser-role effective `EXECUTE` access, contrary to the service-role-only contract.
- Corrective migration `202608250001_restrict_scheduler_rpc_privileges.sql` is prepared locally;
  it has not been applied remotely.
- Edge Function deployment, scheduler credential provisioning, Vault/Cron configuration, and
  collector invocation remain blocked pending the corrective migration and separate authorization.
- Production remains unchanged.

## Development execution gate

Before enabling a development schedule, confirm the development target explicitly and use secret
placeholders in review material. Provision the same freshly generated 256-bit base64url token in
Supabase Vault and the managed Edge secret `FORECAST_SCHEDULER_TOKEN`; never print or select it.
Deploy the reviewed function and apply the migration, then configure one Cron delivery at
`17 4 * * *` with a 140,000 ms `pg_net` timeout and body `{}`. The Cron SQL/configuration is kept
out of the migration so applying repository schema cannot silently enable scheduling in another
environment.

Run every case in the Stage 5.2.0 development validation matrix, including the inclusive stale
boundary, both lock orderings, failed-transaction rollback, no-active-location behavior, and
sanitized response/log review. Capture only categories, UTC windows, and aggregate counters.

Before scheduler enablement, the local database suite and all Deno checks must pass, then the
reviewed migrations and function must be validated against an explicitly confirmed development
target. The complete remote matrix, bounded transport evidence, and disable/no-later-delivery
verification remain required. Repository tests alone do not satisfy those gates.

At the end of validation, disable or unschedule the development job and verify that no later
delivery occurs. Do not configure or enable production without a separately confirmed production
target and explicit authorization.
