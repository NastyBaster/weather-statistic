# Scheduled forecast collector development validation

**Stage:** 5.2.1  
**Repository implementation date:** 2026-08-23  
**Remote development validation:** Pending explicit development-target execution

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
