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
| **5.2.1** | **Implement and validate scheduled collection against the approved contract, development first. Repository implementation is ready for review; remote development validation is pending. Production configuration and enablement require separate explicit authorization.** | **In progress** |
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

## Optional backlog

These items do not block the core weather pipeline and require separate bounded stages:

- profile settings;
- global geocoding (formerly Stage 4.2);
- canonical places shared across users.

## Version 2 direction (deferred)

Once the current core path is operational, evaluate a shared national weather archive that is
collected independently of user selections. Begin with all Ukrainian regional capitals; consider
district centres only after provider-capacity, runtime, and storage validation. Canonical places
would let a newly selecting user see previously collected forecast history immediately. A later
observed-weather archive may support browsing historical days across months, years, and decades.

This is a durable product note only. It does not alter the current roadmap order, authorize work,
or expand Stage 5.2.1, which continues with active personal locations as already designed.

The scheduler contract and repository implementation are complete for review, but no remote
migration or function deployment has occurred and no scheduler has been configured, enabled, or
invoked. Stage 5.2.1 remains subject to its development validation gate and separate production
authorization. Observations, accuracy, geocoding, and other future functionality remain deferred.
