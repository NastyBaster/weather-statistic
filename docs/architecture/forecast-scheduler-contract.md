# Forecast scheduler contract (Stage 5.2.0)

Status: **accepted for Stage 5.2.1 implementation** (2026-08-23). This is a reviewed
contract, not authorization or evidence that scheduling exists.

Official primary documentation was checked on **2026-08-23**: Supabase
[Cron](https://supabase.com/docs/guides/cron),
[scheduled Edge Functions](https://supabase.com/docs/guides/functions/schedule-functions),
[Vault](https://supabase.com/docs/guides/database/vault),
[`pg_net`](https://supabase.com/docs/guides/database/extensions/pg_net),
[function configuration](https://supabase.com/docs/guides/functions/function-configuration),
[Edge Function limits](https://supabase.com/docs/guides/functions/limits), and
[database timezone guidance](https://supabase.com/docs/guides/database/postgres/configuration);
GitHub's [`schedule` event](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows#schedule)
and [Actions secrets](https://docs.github.com/en/actions/concepts/security/secrets); Cloudflare's
[Cron Triggers](https://developers.cloudflare.com/workers/configuration/cron-triggers/); and
upstream [`pg_cron`](https://github.com/citusdata/pg_cron). No large excerpts are reproduced.

## 1. Context and constraints

`collect-forecasts` is a manual-only Supabase Edge Function. It accepts a Supabase user access
JWT, resolves the user through Auth, and permits only IDs in `FORECAST_ADMIN_USER_IDS`. The
service-role credential exists only in the managed Edge runtime. Production manual collection,
same-local-date idempotency, immutable snapshots, RLS, and sanitized logs are validated; no
schedule exists. UI and real-data presentation remain out of scope.

One invocation owns one `forecast_runs` row. Runs support `manual`, `scheduled`, and `retry`;
snapshots use location-local `collection_date` and `target_date`, immutable identity
`(location_id, collection_date, target_date)`, and `ON CONFLICT DO NOTHING`.

## 2. Decision drivers

- Minimize complexity for an educational, non-commercial project.
- Use least privilege and a clear machine boundary; never schedule with a user JWT.
- Never put the service-role key in a request, scheduler, repository, frontend, or logs.
- Define UTC/DST, overlap, replay, retry, and bounded execution precisely.
- Validate development first; keep disable/rollback simple and evidence sanitized.

## 3. Considered alternatives

| Mechanism | Execution/auth/time | Operations, observability, and tradeoffs | Decision |
| --- | --- | --- | --- |
| **Supabase Cron + `pg_net`** | `pg_cron` in the project database queues an async HTTPS POST. An opaque bearer credential and endpoint base URL live in Vault. Schedule is UTC. | Cron history plus short-lived `pg_net` response metadata; disable through Cron UI/`cron.unschedule`. Least extra infrastructure, though privileged DB/Vault access joins the trust boundary. | **Selected:** Supabase officially documents this Edge Function pattern and it has the smallest operational surface. |
| GitHub Actions schedule | GitHub-hosted runner reads an Actions secret. UTC default; IANA scheduling is supported. | Workflow history and easy disable, but GitHub documents delay/dropped jobs, default-branch and repository-activity coupling. Adds a runner/control plane and secret copy for one POST. | Rejected for 5.2.1; reconsider only for broader repository orchestration. |
| Cloudflare Cron Trigger | A Worker UTC `scheduled()` handler reads a Worker secret and calls Supabase. | Worker logs; trigger changes can take up to 15 minutes. Requires new Worker code/config and a cross-vendor secret copy; current Pages deploy is not a Worker scheduler. | Rejected as unnecessary infrastructure. |

No other external scheduler is relevant enough to the current deployment model.

## 4. Authentication boundary

The caller is the Supabase Cron job through `pg_net`. It sends `Authorization: Bearer <value>`
to `POST /functions/v1/collect-forecasts`. The value is **32 cryptographically random bytes,
base64url-encoded without padding** (256 bits): an opaque machine credential, not a JWT, user
session, publishable key, or service-role key.

During separately authorized provisioning, an operator generates it outside the repository and
writes the same value directly to a named Vault secret and managed Edge secret
`FORECAST_SCHEDULER_TOKEN`. It is never printed, selected into evidence, committed, put in a
migration, or exposed to a browser. Rotation disables the job, replaces both copies, validates
development, then re-enables; suspected compromise means disable and replace immediately.

Stage 5.2.1 must disable gateway JWT verification for this function because the machine token is
opaque, then make the function itself the mandatory gate. It parses exactly one Bearer value,
constant-time compares a possible machine token with the Edge secret, otherwise validates it as
the existing Supabase user JWT and checks `FORECAST_ADMIN_USER_IDS`. Missing/malformed/invalid or
wrong machine credentials return 401; a valid non-allowlisted user returns 403. Authentication
precedes database reads/run creation. Machine auth derives `scheduled`; allowlisted user auth
derives `manual`; neither body nor headers can select another identity/trigger.

The manual path remains. Browser grants, RLS, run denial, and immutability do not change. The
service-role key remains only in managed Edge runtime and never enters Vault or the request.

## 5. Request and run contract

- `POST /functions/v1/collect-forecasts`; other methods return 405.
- One Bearer credential and `Content-Type: application/json`; no custom scheduler slot,
  timestamp, trigger, identity, or correlation header is sent.
- Body is exactly `{}`. Invalid JSON, any key, array/scalar, or oversized body returns 400 before
  run creation. Any custom header purporting to select identity or trigger also returns 400 before
  run creation.
- Machine authentication creates `scheduled`; preserved allowlisted operator authentication
  creates `manual`. Stage 5.2.1 implements no writer or HTTP surface for `trigger_type='retry'`.
  That schema value is reserved for a separate future reviewed contract/stage.
- Internal provider attempts stay inside one run and never create another run.
- Success and partial return 200 with status/sanitized counters; total failure 500; auth 401/403;
  invalid body 400; method 405; fresh overlap 409. No sensitive detail or identifiers.
- `pg_net.timeout_milliseconds` is **140,000 ms**. Collector overall deadline is **120,000 ms**:
  stop new groups, abort in-flight provider work, count remaining locations failed, and attempt a
  terminal update. This fits below Supabase's documented 150-second request idle timeout. If the
  active workload cannot be bounded to fit, 5.2.1 stops for redesign rather than raising it.

## 6. Cadence and timezone semantics

Run daily at **`17 4 * * *` = 04:17 UTC**. Database and cron stay UTC; minute 17 avoids typical
top-of-hour load. This is 07:17 Kyiv in EEST and 06:17 in EET, within the accepted 06:00–08:00
window. DST changes neither the UTC instant nor invocation count.

There is no automatic catch-up. The acceptance window starts at 04:17 UTC and ends at
**06:17 UTC**, so a scheduled run whose server-generated `started_at` falls within that interval
is acceptably late. If no such run exists after 06:17 UTC, record a **missing scheduled
acceptance** (a missed or unaccepted delivery), without claiming a particular HTTP failure.
After reviewing the available sanitized evidence, an allowlisted operator may invoke the existing
manual collector; that is a new `manual` collection, not a retry run. Daily collection is far
below current published Open-Meteo non-commercial limits for the small location set and its eight
forecast days retain horizons 0–7. Increasing cadence requires a new provider/capacity review.

Scheduler timezone never changes location timezone semantics: `collection_date` is derived from
`collected_at` in each stored IANA timezone and `target_date` remains provider location-local.

## 7. Overlap, idempotency, and concurrency

Stage 5.2.1 adds, in a new migration, an atomic database claim operation and invariant. Eligibility
for stale recovery is exactly `trigger_type='scheduled'`, `status='running'`, and `started_at`
older than 15 minutes according to database/server time; caller-provided time is never used.

1. Under a transaction advisory lock with a fixed documented application key, inspect running
   scheduled runs.
2. If one is younger than **15 minutes**, create no run and return 409
   `scheduled_run_active`.
3. If one is stale, calculate the exact count of existing `forecast_snapshots` rows referencing
   it, then update it to `status='failed'`, `completed_at` equal to database transaction time,
   `locations_succeeded=0`, `locations_failed=locations_total`, `snapshots_created` equal to that
   calculated count, and fixed `error_message='stale scheduled run recovered'`.
4. Only after that terminal update succeeds in the same atomic database operation may the
   replacement scheduled run be inserted. The stale update and replacement claim commit together.
5. A partial unique index permits at most one `running` row with `trigger_type='scheduled'`.

The run owns single-flight state for its entire `running` lifetime; terminal status leaves the
index predicate, so no lease cleanup exists. At most one concurrent caller can terminalize a stale
run and receive the replacement claim; all others create no run, perform no provider work, and
receive 409 `scheduled_run_active`. There is no transient two-replacement window.
If stale terminalization conflicts, fails, or does not commit, no replacement is created; a later
bounded invocation or operator review may try recovery again. A database failure that is not a
concurrent-claim loss returns 500 `stale_recovery_failed`; no database detail is returned.
Best-effort terminalization followed by replacement is forbidden.

`locations_succeeded=0` is a conservative recovery classification because process loss prevents
proof of which location operations completed provider-side. `snapshots_created` reports durable
rows actually linked to the stale run; neither counter proves that no provider call occurred.
Recovery never updates or deletes immutable snapshots and never deletes the stale run. The exact
values satisfy existing run constraints: failed has zero succeeded locations, failed plus
succeeded does not exceed total, terminal status has `completed_at`, and the fixed error is under
1,000 characters and contains no identifiers, timestamps, raw errors, provider data, or secrets.

Fresh skips have no run row. Stale runs remain failed evidence. Duplicate delivery after a
terminal run creates a new scheduled run, but snapshot uniqueness makes existing identities
immutable no-ops. Snapshot idempotency alone is insufficient: overlap would duplicate provider
traffic, contend on writes, distort counters, and complicate recovery. Manual break-glass runs
remain possible but must not be routine.

## 8. Failure and retry contract

Provider retries remain three attempts per group, 10-second attempt timeout, capped exponential
backoff/jitter and capped `Retry-After`. Timeout/network/429/5xx/temporary unavailability retry;
invalid input/request, auth, provider/schema contract, and normalized validation do not.

Cron submits **exactly one automatic delivery attempt per daily slot and performs no automatic
retry**. A missed or failed delivery creates no automatic run. A timeout does not prove execution
stopped: wait through the 15-minute stale threshold and inspect sanitized state. Fresh overlap is
not retried. After evidence review, an allowlisted operator may make a new existing manual call;
it creates `trigger_type='manual'` and cannot select `retry` through body or headers. It is simply
a later manual collection.

`trigger_type='retry'` remains a reserved schema value. Stage 5.2.1 creates no retry endpoint or
retry writer, and neither its scheduled nor manual request can select it. Future use requires a
separate explicit reviewed retry contract/stage. Partial/failed runs remain terminal, stale
`running` rows are recovered through the atomic claim, and no failure path deletes or rewrites
historical data or automatically creates a retry run.

## 9. Observability and sanitized evidence

The durable source of truth for an accepted invocation is `public.forecast_runs` with
`trigger_type='scheduled'`. Stage 5.2.1 supplies a concise query/checklist for these durable facts:

- latest accepted scheduled run and its server-generated `started_at`;
- latest terminal scheduled run, `completed_at`, status, and succeeded/partial/failed counts;
- scheduled running count and age bucket, flagging 15 minutes;
- sanitized aggregate location and `snapshots_created` counters;
- absence of an accepted scheduled run in the expected daily 04:17–06:17 UTC window.

After 06:17 UTC, absence of a scheduled run in that window is reported as **missing scheduled
acceptance** or **missed or unaccepted delivery**. It is not evidence of a specific transport,
authentication, gateway, or function failure.

`pg_net` HTTP responses are ephemeral and, by default, are retained for substantially less than
the daily cadence. Inspect response status and the infrastructure-generated `pg_net` request ID
only during a bounded development/production rollout observation or incident review that is
known to be within documented retention. The request ID is not an authentication input, durable
application identifier, custom header, continuity datum, or secret. A `cron.job_run_details`
record may prove the SQL cron job executed, but neither SQL success nor a `pg_net` request ID proves
that the Edge Function accepted or completed the request. Ephemeral transport data is never the
only health signal and is not guaranteed to survive until the next daily cadence.

Stage 5.2.1 adds no durable scheduler-delivery ledger solely for HTTP results. A durable delivery
ledger, automated alert transport, or richer operational monitoring remains Stage 5.3 and needs
a separate reviewed design. Review immediately for ephemeral 401/403 or timeout evidence, a stale
or failed run, two consecutive partials, missing scheduled acceptance, or unexpected accepted-run
count. Correlation uses the durable scheduled run, its server-generated times, the canonical
cadence/window, and bounded cron/`pg_net` rollout observation—never a caller-controlled header.

Never expose in logs/evidence: JWTs, Authorization headers, scheduler secrets, service-role keys,
secret digests, user UUIDs, project references, emails, provider bodies, full database errors,
connection strings, sensitive stack traces, or raw log exports. Use fixed categories and counters.

## 10. Stage 5.2.1 development validation gate

These are future specifications; Stage 5.2.0 runs no remote validation.

| Case | Required result |
| --- | --- |
| Unauthenticated / wrong machine credential | 401; no DB read, run, or detail. |
| Authenticated non-admin | 403; no run. |
| Allowlisted manual operator | Existing behavior; exactly one `manual` run. |
| Valid scheduled call | Accepted; exactly one `scheduled` run. |
| Spoof body/identity/trigger | Every non-empty body rejected 400; headers cannot select identity, `manual`, `scheduled`, or `retry`; auth alone derives trigger. |
| Manual request selects retry | Body or custom trigger header is rejected 400 before run creation; an allowlisted user can create only `manual`. |
| Scheduled request selects retry | Body or custom trigger header is rejected 400 before run creation; machine authentication can create only `scheduled`. |
| Repeated allowlisted operator call | Creates a new `manual` run; no request surface can select `retry`. |
| Duplicate after terminal | New run; existing identities unchanged; only missing snapshots counted. |
| Concurrent overlap | One claim; other gets 409 and performs no provider work. |
| Timeout/internal attempts | Three bounded provider attempts in one run; 120 s collector/140 s delivery bounds; no automatic path creates a retry run. |
| Partial/total failure | Correct terminal status/counters and sanitized categories. |
| Stale run without snapshots | At 15 minutes, exact conservative failed counters use zero snapshots before one atomic replacement. |
| Stale run with snapshots | Recovery counts linked rows exactly and leaves immutable snapshots unchanged. |
| Concurrent stale recovery | One caller terminalizes and claims replacement; all others create no run/provider work. |
| Failed stale terminalization | Forced conflict/failure/uncommitted update creates no replacement; later recovery remains possible. |
| No active locations | Successful scheduled zero-work run. |
| RLS/immutability | Browser grants, user isolation, run denial, snapshot immutability unchanged. |
| Bounded delivery evidence | Within retention, inspect `pg_net` response and corresponding durable scheduled run; cron SQL success alone is not Edge acceptance. |
| Missing acceptance | After 06:17 UTC with no scheduled run in the window, report missing scheduled acceptance without inventing an HTTP cause. |
| Sanitized review | Prohibited material absent from response/log/evidence. |
| Disable | Development job inactive/unscheduled and no later delivery. |

Also test constant-time comparison boundary, missing Edge secret fail-closed 503, methods, invalid
JSON/size, terminal-update failure, and that client timeout is not evidence of no run.

## 11. Production authorization and rollout gate

Roadmap or merged contract is not production authorization. Production requires:

- explicitly confirmed target and explicit authorization to provision/configure/enable;
- reviewed `main`, passing local and development validation;
- exact cadence and enable time;
- approved credential generation/provisioning/rotation plan;
- sanitized evidence checklist;
- named disable action: Cron Dashboard Disable, or `cron.unschedule(<reviewed job name>)` after
  target verification, with no identifier embedded here;
- bounded observation of the first ephemeral `pg_net` response and corresponding durable
  scheduled run through terminal state, plus second-day durable acceptance confirmation;
- stop on wrong target/revision, auth denial, timeout/stale, active duplicate, secret exposure,
  unsanitized logs, RLS/immutability regression, failed, or unexplained partial result.

## 12. Rollback

Disable/unschedule first, then verify no new delivery or scheduled run after the next 04:17 slot
plus two-hour lateness. Preserve all runs/snapshots; delete nothing. If compromised, disable,
replace both Vault and Edge credential copies, prove the old value gets 401 without logging it,
and re-enable only after approved development validation. Function rollback applies only if
5.2.1 changed it and requires a separately authorized deployment. Evidence is limited to active
state, durable accepted-run UTC windows and terminal counts, plus ephemeral response categories
only when inspected within documented retention, and absence of later scheduled runs.

## 13. Explicit non-goals

No scheduler implementation/configuration, migration, function edit, deployment, secrets,
collector invocation, UI trigger, development/production mutation, Stage 5.3 system,
observations, accuracy, real-data UI, geocoding, or unrelated work occurs in this stage.

## 14. Decision summary / implementation handoff

| Decision | Selected contract |
| --- | --- |
| Scheduler | Supabase Cron queues one `pg_net` POST daily. |
| Surface | `POST /functions/v1/collect-forecasts`, body exactly `{}`. |
| Machine auth | 256-bit random base64url opaque Bearer, only Vault + Edge secret, constant-time validation. |
| Manual auth | Existing user JWT + `FORECAST_ADMIN_USER_IDS`. |
| Service role | Managed Edge runtime only; never scheduler/request. |
| Trigger | machine=`scheduled`; operator=`manual`; Stage 5.2.1 implements no `trigger_type='retry'` writer or retry endpoint, and that schema value remains reserved. |
| Cadence | `17 4 * * *`, 04:17 UTC; no catch-up; two-hour lateness. |
| Single flight | Advisory-locked atomic claim + partial unique index; stale at 15 minutes; terminalize-and-replace in one transaction or create no replacement. |
| Attempts/timeouts | Provider 3 internal attempts; delivery 1/no automatic retry; collector 120 s; `pg_net` 140 s. |
| Later operator invocation | New `manual` run after evidence review; immutable identity conflicts are no-ops; never labeled `retry`. |
| Observability | Scheduled runs are durable acceptance truth; 04:17–06:17 UTC missing-acceptance check; `pg_net` result is ephemeral only. |
| Rollback | Disable first, preserve data, rotate both copies if compromised. |

Before implementation:

- [ ] Contract is merged to `main`; 5.2.1 has a separate bounded branch/PR.
- [ ] Target is development; production is neither inferred nor authorized.
- [ ] Official limits/features remain available on the target plan.
- [ ] New migration/function design exactly implements claim, auth, deadline, and response rules
      without widening browser grants/RLS.
- [ ] Review material uses secret placeholders only.
- [ ] Complete development matrix and disable verification are ready before enablement.
