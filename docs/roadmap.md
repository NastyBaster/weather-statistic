# Consolidated roadmap

This roadmap is the canonical, deduplicated stage sequence. Each stage is a bounded branch and
pull request. Future descriptions are scope and review gates, not authorization to implement,
deploy, invoke, or operate them.

## Product invariants

- Demo and real data must never be mixed ambiguously. Every screen and data path must make its
  source explicit before the real-data UI replaces the demo.
- Accuracy results must always disclose sample size and must not present underpowered aggregates
  as reliable conclusions.
- Precipitation accuracy requires an explicit rain-event threshold plus precision, recall, and
  false-alarm metrics; a vague or single aggregate “rain accuracy” is insufficient.

## Core path

| Stage | Scope and gate | Status |
| --- | --- | --- |
| 1 | Responsive static demo UI | Complete |
| 2 | Development/production Supabase foundation | Complete |
| 3 | Authentication, recovery, and profiles | Complete |
| 3.1 | Accessible/localized auth UX | Complete |
| 4.1 | Personal locations and ownership RLS | Complete |
| 5.0 | Forecast contract and schema | Complete |
| 5.1 | Manual forecast collector and development validation | Complete |
| 5.1.1 | Authorized production rollout and validation | Complete |
| 5.1.2 | Durable agent context, project status, and consolidated roadmap | Complete |
| 5.2.0 | Scheduler contract: Supabase Cron + `pg_net`, opaque machine Bearer auth, daily 04:17 UTC, single-flight guard, and rollout/rollback gates. No scheduler is implemented or enabled. | Complete |
| **5.2.1** | **Repository hardening merged to `main` through PR #13. Local PostgreSQL validation is complete: 21 pgTAP assertions and 14 concurrency cases passed, with 0 failed/skipped/not-run; Node 40/40 and Deno 39/39 passed. Remote development migration, deployment, validation, and disable verification remain pending. The development scheduler is not enabled; production configuration and enablement require separate explicit authorization.** | **In progress** |
| 5.3 | Operational observability for collection health and failures without sensitive logs | Planned |
| 6 | Forecast history backed by real snapshots with an explicit demo/real boundary | Planned |
| 7.0 | Observation provider contract and immutable observation schema | Planned |
| 7.1 | Manual observation collector with authorization, idempotency, and validation | Planned |
| 7.2 | Scheduled observations using a separately approved operational contract | Planned |
| 8.0 | Accuracy contract, including sample-size rules and explicit precipitation-event metrics | Planned |
| 8.1 | Accuracy read model implementing the approved contract | Planned |
| 9 | Real-data dashboard with honest loading, missing-data, and provenance states | Planned |
| 10 | Charts, filters, and CSV export over the real read models | Planned |
| 11 | Production hardening, operational review, and recovery exercises | Planned |

## Deferred Version 2 direction

Version 2 may evaluate a shared precollected forecast archive independent of personal location
selections, beginning with Ukrainian regional capitals. District centres require separate cost,
capacity, and storage validation. The archive could let users see already collected history
immediately; longer-term observed-weather history may be considered separately.

This is not an approved implementation stage and must not delay the current core path. Stage 5.2.1
continues against active personal locations as already planned.

## Optional backlog

These items do not block the core weather pipeline and require separate bounded stages:

- profile settings;
- global geocoding (formerly Stage 4.2);
- canonical places shared across users.

The scheduler contract and repository hardening are merged to `main`, and local PostgreSQL
validation is complete. No remote development migration, function deployment, validation, or
disable verification has occurred, and no development scheduler has been configured, enabled, or
invoked. Stage 5.2.1 remains in progress and subject to its remaining development validation gate
and separate production authorization. Production is unchanged. Observations, accuracy,
geocoding, and other future functionality remain deferred.

The proposed weather Agent Bridge is a separate, not-yet-live-verified single-task tooling scope;
batch/watch execution and runtime operations remain excluded.
