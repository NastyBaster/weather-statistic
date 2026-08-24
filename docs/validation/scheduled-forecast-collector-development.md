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
- The migration grants the two operational RPCs only to `service_role`; browser RLS and grants are
  unchanged.

## Local checks

`npm run check` passes. Deno is unavailable in this workspace, so the required formatting, lint,
type-check, and Edge Function tests remain mandatory in the execution environment before remote
development work.

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

At the end of validation, disable or unschedule the development job and verify that no later
delivery occurs. Do not configure or enable production without a separately confirmed production
target and explicit authorization.
