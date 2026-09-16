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
| **5.2.1** | **Repository hardening and the authorized development validation matrix are complete. Remote evidence covers authenticated admin/non-admin paths, spoofing rejection, repeated and parallel calls, provider failure, no-active-location, RLS/immutability, duplicate identities, and disabled-scheduler verification.** | **Complete** |
| **5.3** | **Operational observability for collection health and failures without sensitive logs. The service-role health RPC and machine-token Telegram monitor are merged, deployed, polled in production, and covered by the first automatic Cron acceptance.** | **Complete** |
| **6** | **Forecast history backed by real snapshots with an explicit demo/real boundary. Authenticated users read their RLS-scoped snapshots; observation-based actuals and accuracy remain deferred.** | **Complete** |
| **7.0** | **Observation provider contract and immutable observation schema. Development migration is applied and RLS/immutability boundaries are validated; collection remains deferred.** | **Complete** |
| **7.1** | **Manual observation collector with authorization, idempotency, and validation. Development deployment and authenticated smoke acceptance completed; the reviewed function is also deployed in production.** | **Complete** |
| **7.2** | **Scheduled observations using a separate opaque machine token, Vault/Edge secret storage, and a daily production Cron job. Scheduled smoke acceptance and the first automatic Cron acceptance completed.** | **Complete** |
| **8.0** | **Accuracy contract, including sample-size rules and explicit precipitation-event metrics** | **Complete** |
| **8.1** | **Accuracy read model implementing the approved contract, with coverage, scored-pair provenance, detail pagination, and RLS-scoped per-location/all-owned scopes** | **Complete** |
| **9** | **Real-data dashboard with honest loading, missing-data, provenance, and sample-size states** | **Complete** |
| 10 | Charts, filters, and CSV export over the real read models | Planned |
| 11 | Production hardening, operational review, and recovery exercises | Planned |

## Deferred Version 2 direction

Version 2 may evaluate a shared precollected forecast archive independent of personal location
selections, beginning with Ukrainian regional capitals. District centres require separate cost,
capacity, and storage validation. The archive could let users see already collected history
immediately; longer-term observed-weather history may be considered separately.

This is not an approved implementation stage and must not delay the current core path. Stage 5.2.1
continues against active personal locations as already planned. Product discovery notes are recorded
in `docs/product-direction-backlog.md` and are not authorization to implement.

## Optional backlog

These items do not block the core weather pipeline and require separate bounded stages:

- profile settings;
- global geocoding (formerly Stage 4.2);
- canonical places shared across users.

The scheduler contract and repository hardening are merged to `main`; the authorized development
validation matrix is complete. On 2026-09-15 the explicitly authorized production reset replayed
the repository migrations and redeployed the reviewed forecast and observation collectors. On
2026-09-16 both production Cron jobs completed their first automatic runs successfully: the
04:17 UTC forecast run processed three locations, created 24 snapshots, and had zero failures;
the 04:47 UTC observation run inserted three observations for the previous local day with zero
failures. Observations are now being collected, while accuracy, geocoding, and the real-data
dashboard remain deferred to later stages.

Stages 8.0/8.1 accuracy work merged to `main` in PR #59 on 2026-09-16. Its migrations were
applied to production on 2026-09-16 after explicit authorization. Stage 9 merged to `main` in
PR #62 on 2026-09-16. Product discovery notes are recorded separately and are not an approved
implementation stage.

The proposed weather Agent Bridge is a separate, not-yet-live-verified single-task tooling scope;
batch/watch execution and runtime operations remain excluded.
