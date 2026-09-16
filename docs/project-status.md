# Project status

**Last updated:** 2026-09-16

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
| 5.3 | Operational observability for collection health and failures without sensitive logs | Complete |
| 6 | Forecast history backed by real snapshots with an explicit demo/real boundary | Complete |
| 7.0 | Observation provider contract and immutable observation schema | Complete |
| 7.1 | Manual observation collector with authorization, idempotency, and validation | Complete |
| 7.2 | Scheduled observation collector and production Cron rollout | Complete |
| 8.0 | Accuracy contract with sample-size rules and explicit precipitation-event metrics | Complete |
| 8.1 | RLS-scoped accuracy read model with coverage, provenance, per-location/all-owned scopes, and detail pagination | Complete |

Google OAuth is configured and working in development and production.

## Current environments

- **Development:** authentication, profiles, personal locations, forecast schema, manual
  collection, hardened scheduler path, observation schema, and the accuracy read model have been
  validated. The observation function accepts a dedicated machine token; pg_cron is not enabled
  in this project.
- **Production:** Cloudflare Pages serves the merged `main` deployment. On 2026-09-15 the
  explicitly authorized production database reset removed disposable data and replayed all seven
  repository migrations. The reviewed forecast and observation functions were redeployed; the
  observation scheduler is configured with a dedicated Vault/Edge secret and daily Cron job.
- **Production reset baseline:** `profiles`, `locations`, `forecast_runs`, and
  `forecast_snapshots` were present, protected by RLS, and contained zero rows immediately after
  the 2026-09-15 reset. The first automatic collection has since populated the production run and
  observation tables; historical rows removed by the reset are not recoverable from the reset itself
  and would require a Supabase backup/export.

There is no production UI trigger. Personal locations are real when users add
them, but the accuracy read model migrations are not yet applied to production and the real-data
dashboard is still under implementation. Never mix demo and real data without an explicit, visible
boundary. Global geocoding is optional and deferred.

Stage 5.2.0 selected Supabase Cron with `pg_net`, an opaque 256-bit machine Bearer credential
stored only in Supabase Vault and the managed Edge secret store, and a daily 04:17 UTC cadence.
The contract requires a single-flight scheduled run and preserves the manual operator JWT path.
Stage 5.2.1 repository hardening and the authorized development validation matrix are complete.
Remote evidence covered authenticated admin and non-admin paths, spoofing rejection, repeated and
parallel manual calls, the zero-active-location path, a partial provider failure, RLS/immutability
boundaries, duplicate identity checks, and final disabled-scheduler state. The development
scheduler remains disabled; production scheduling is still a separate approved operational stage.

Stage 5.3 is complete. It has a service-role-only `get_forecast_collection_health` RPC and a
machine-token `forecast-health-monitor` Edge Function in `main`. Development and production have
the monitor deployed with Supabase-managed Telegram secrets; GitHub Actions polls production every
15 minutes, and real Telegram delivery tests passed. The first automatic production Cron acceptance
passed on 2026-09-16 for both daily collectors; the configured jobs are not production UI triggers.

Stage 6 is complete and deployed to the frontend. Guests retain an explicitly labeled demo view;
authenticated users read only their own RLS-scoped forecast snapshots. The dashboard shows the latest
forecast history and honest empty/loading/error states. Actual-weather observations are collected;
the accuracy read model and real-data dashboard integration are complete in `main`; production
accuracy migrations remain a separately authorized operation.

Stage 7.0 is complete. Development has the new RLS-protected, immutable `weather_observations`
schema; provider collection, scheduling, and accuracy remain separate stages.

Stage 7.1 is complete. The allowlisted manual collector accepted the previous local day for three
active locations and inserted three observations with zero failures in development. The same
reviewed function is deployed in production.

Stage 7.2 is complete. Production uses a separate opaque scheduler token stored only in Vault and
the managed Edge secret store, with `forecast-observation-daily` scheduled for 04:47 UTC. On
2026-09-16 the first automatic Cron run succeeded: three observations for 2026-09-15 were inserted
at 04:47 UTC with no collection failure. The paired `forecast-collector-daily` run at 04:17 UTC
also succeeded for three locations, with 24 snapshots created and zero failures.

Stage 8.0 and 8.1 are complete. PR #59 merged to `main` on 2026-09-16 as `b83eb99`. The
development read model includes per-location and all-owned-location aggregates, per-metric
coverage, scored-pair provenance ranges, row-level detail provenance, and deterministic detail
pagination. Its migrations are not applied to production; that remains an explicitly authorized
future operation.

Stage 9 is complete. PR #62 merged to `main` on 2026-09-16 as `aa98c47`. The authenticated
dashboard now connects to the real forecast and accuracy read models while retaining honest
loading, missing-data, provenance, and sample-size states. Until production accuracy migrations
are authorized and applied, the dashboard exposes that accuracy data is unavailable there.

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
