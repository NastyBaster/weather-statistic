# Project status

**Last updated:** 2026-09-15

This is the concise, sanitized continuity record. Update it when a stage merges; keep detailed
procedures and raw evidence out of this file.

## Completed stages

| Stage | Result | Status |
| --- | --- | --- |
| 1 | Responsive static demo UI | Complete |
| 2 | Development and production Supabase foundation | Complete |
| 3 | Email/password authentication, recovery, and profiles | Complete |
| 3.1 | Accessible, localized auth UX | Complete |
| 4.1 | Personal locations from a local Ukrainian catalog and two-user RLS validation | Complete |
| 5.0 | Forecast provider/data contract and schema | Complete |
| 5.1 | Manual forecast collector and development runtime validation | Complete |
| 5.1.1 | Production collector rollout and sanitized validation | Complete |
| 5.1.2 | Durable agent context, project status, and consolidated roadmap | Complete |
| 5.2.0 | Forecast scheduler contract | Complete |

Google OAuth is configured and working in development and production.

## Current environments

- **Development:** authentication, profiles, personal locations, forecast schema, manual
  collection, and the hardened scheduler path have been validated. The scheduler remains disabled.
- **Production:** Cloudflare Pages serves the merged `main` deployment. On 2026-09-15 the
  explicitly authorized production database reset removed disposable data and replayed all six
  repository migrations. The reviewed `collect-forecasts` function was redeployed; the scheduler
  remains disabled.
- **Production reset baseline:** `profiles`, `locations`, `forecast_runs`, and
  `forecast_snapshots` are present, protected by RLS, and contain zero rows after the reset.
  Production has no `pg_cron` or `pg_net` scheduler extensions enabled. Historical production
  rows are not recoverable from the reset itself and would require a Supabase backup/export.

There is no scheduler and no production UI trigger. Personal locations are real when users add
them, but UI weather
and history remain intentionally demonstrative; production snapshots are not displayed. Never
mix demo and real data without an explicit, visible boundary. Observations, accuracy calculations,
and the real-data dashboard remain deferred. Global geocoding is optional and deferred.

Stage 5.2.0 selected Supabase Cron with `pg_net`, an opaque 256-bit machine Bearer credential
stored only in Supabase Vault and the managed Edge secret store, and a daily 04:17 UTC cadence.
The contract requires a single-flight scheduled run and preserves the manual operator JWT path.
Stage 5.2.1 repository hardening is merged and the authorized development smoke is complete, but
the full validation matrix remains open. The smoke verified the 6/6 development ledger, reviewed
function deployment, four negative transport checks, one succeeded scheduled run for 14 locations
and 112 snapshots, zero duplicates, and zero active runs. No Cron job was configured; the scheduler
remains disabled until the remaining authenticated, concurrency, failure, RLS, and disable cases
are evidenced.

A single-task Agent Bridge bootstrap is proposed in a separate bounded PR; it is not live-verified,
does not execute scheduler or Supabase operations, and does not include batch/watch automation.

## Deferred Version 2 direction

Version 2 may evaluate a shared precollected forecast archive independent of personal location
selections, beginning with Ukrainian regional capitals. District centres require separate cost,
capacity, and storage validation. The archive could let users see already collected history
immediately; longer-term observed-weather history may be considered separately.

This is not an approved implementation stage and must not delay the current core path.

## Working model

Browser/cloud Codex is the planner and reviewer. Local Codex CLI executes grouped repository and
authorized environment operations from the real clone. A cloud snapshot may contain only a
synthetic `work` branch; consult the actual clone rather than treating that snapshot as canonical.
