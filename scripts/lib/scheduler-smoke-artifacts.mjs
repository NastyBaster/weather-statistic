const VAULT_SECRET_NAME = "forecast_scheduler_token";
const CLAIM_LOCK_KEY = 734012521;
const TERMINAL_STATUSES = ["succeeded", "partial", "failed"];

const fail = (category) => { throw new Error(category); };

function requireReference(projectRef) {
  if (!/^[a-z0-9-]+$/.test(projectRef)) fail("linked_reference_invalid");
}

export function requireAttemptBoundary(value) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/.test(value) || Number.isNaN(Date.parse(value))) {
    fail("attempt_boundary_invalid");
  }
  return value;
}

export function requireBaseline(value) {
  if (!Number.isInteger(value) || value < 0) fail("scheduled_run_baseline_invalid");
  return value;
}

export function parsePreflightResult(row) {
  if (!row || row.result_tag !== "scheduler_smoke_preflight" || row.negative_baseline_status !== "baseline_established_before_negative_phase") {
    fail("preflight_result_invalid");
  }
  return Object.freeze({
    attemptBoundary: requireAttemptBoundary(row.attempt_boundary),
    scheduledRunBaseline: requireBaseline(row.scheduled_run_baseline),
  });
}

export function parseNegativeEvidenceResult(row) {
  const allowed = ["result_tag", "attempt_boundary", "scheduled_run_baseline", "new_scheduled_runs", "active_scheduled_runs", "negative_created_runs"];
  if (!row) fail("negative_evidence_missing");
  if (Object.keys(row).some((key) => !allowed.includes(key))) fail("negative_evidence_sensitive_output");
  if (row.result_tag !== "scheduler_smoke_negative_evidence") fail("negative_evidence_parser_failure");
  if (row.attempt_boundary === undefined || row.scheduled_run_baseline === undefined
    || !Number.isInteger(row.scheduled_run_baseline) || row.scheduled_run_baseline < 0
    || !Number.isInteger(row.new_scheduled_runs) || row.new_scheduled_runs < 0
    || !Number.isInteger(row.active_scheduled_runs) || row.active_scheduled_runs < 0
    || !Number.isInteger(row.negative_created_runs) || row.negative_created_runs < 0) fail("negative_evidence_parser_failure");
  requireAttemptBoundary(row.attempt_boundary);
  return Object.freeze({
    attemptBoundary: row.attempt_boundary,
    scheduledRunBaseline: row.scheduled_run_baseline,
    newScheduledRuns: row.new_scheduled_runs,
    activeScheduledRuns: row.active_scheduled_runs,
    negativeCreatedRuns: row.negative_created_runs,
  });
}

export function parseNegativeEvidenceResults(rows) {
  if (!Array.isArray(rows) || rows.length === 0) fail("negative_evidence_missing");
  if (rows.length !== 1) fail("negative_evidence_ambiguous");
  return parseNegativeEvidenceResult(rows[0]);
}

export function parseEvidenceResult(row) {
  const categories = new Set(["no_new_scheduled_run", "one_running_scheduled_run", "one_terminal_scheduled_run", "unexpected_multiple_scheduled_runs"]);
  if (!row || row.result_tag !== "scheduler_smoke_evidence" || !categories.has(row.run_category)) fail("evidence_result_invalid");
  const numeric = ["new_scheduled_runs", "terminal_scheduled_runs", "running_scheduled_runs", "locations_total", "locations_succeeded", "locations_failed", "snapshots_created", "duplicate_immutable_identity_count", "unexpected_active_scheduled_runs"];
  if (numeric.some((key) => !Number.isInteger(row[key]) || row[key] < 0)) fail("evidence_result_invalid");
  if (row.terminal_status !== "none" && !TERMINAL_STATUSES.includes(row.terminal_status)) fail("evidence_result_invalid");
  if (typeof row.counter_invariant !== "boolean") fail("evidence_result_invalid");
  return Object.freeze({
    newScheduledRuns: row.new_scheduled_runs,
    terminalScheduledRuns: row.terminal_scheduled_runs,
    runningScheduledRuns: row.running_scheduled_runs,
    terminalStatus: row.terminal_status,
    duplicateIdentityCount: row.duplicate_immutable_identity_count,
    counterInvariant: row.counter_invariant,
    unexpectedActiveScheduledRuns: row.unexpected_active_scheduled_runs,
  });
}

export function buildPreflightSql() {
  return `begin;
set transaction read only;
do $scheduler_preflight$
declare cron_configured boolean := false;
begin
  if not exists (select 1 from pg_extension where extname = 'pg_net') then
    raise exception using message = 'scheduler_smoke_pg_net_unavailable';
  end if;
  if to_regprocedure('net.http_post(text,jsonb,jsonb,jsonb,integer)') is null then
    raise exception using message = 'scheduler_smoke_http_post_unavailable';
  end if;
  if (select count(*) from vault.secrets where name = '${VAULT_SECRET_NAME}') <> 1 then
    raise exception using message = 'scheduler_smoke_vault_secret_invalid';
  end if;
  if exists (select 1 from public.forecast_runs where trigger_type = 'scheduled' and status = 'running') then
    raise exception using message = 'scheduler_smoke_active_run_present';
  end if;
  if to_regclass('cron.job') is not null then
    execute $cron$select exists (
      select 1 from cron.job
      where jobname ilike '%forecast%' or command ilike '%collect-forecasts%'
    )$cron$ into cron_configured;
  end if;
  if cron_configured then
    raise exception using message = 'scheduler_smoke_cron_configured';
  end if;
end;
$scheduler_preflight$;
select
  'scheduler_smoke_preflight'::text as result_tag,
  to_char(timezone('UTC', transaction_timestamp()), 'YYYY-MM-DD"T"HH24:MI:SS"Z"') as attempt_boundary,
  count(*) filter (where trigger_type = 'scheduled')::integer as scheduled_run_baseline,
  'baseline_established_before_negative_phase'::text as negative_baseline_status
from public.forecast_runs;
rollback;
`;
}

export function buildNegativeEvidenceSql(attemptBoundary, scheduledRunBaseline) {
  const boundary = requireAttemptBoundary(attemptBoundary);
  const baseline = requireBaseline(scheduledRunBaseline);
  return `begin;
set transaction read only;
with attempt as (select '${boundary}'::timestamptz as started_at), summary as (
  select
    count(*) filter (where trigger_type = 'scheduled')::integer as scheduled_run_baseline,
    count(*) filter (where trigger_type = 'scheduled' and created_at >= (select started_at from attempt))::integer as new_scheduled_runs,
    count(*) filter (where trigger_type = 'scheduled' and status = 'running' and created_at >= (select started_at from attempt))::integer as active_scheduled_runs
  from public.forecast_runs
), result as (
  select scheduled_run_baseline, new_scheduled_runs, active_scheduled_runs,
    new_scheduled_runs as negative_created_runs from summary
)
select 'scheduler_smoke_negative_evidence'::text as result_tag,
  '${boundary}'::text as attempt_boundary,
  scheduled_run_baseline,
  new_scheduled_runs,
  active_scheduled_runs,
  negative_created_runs
from result
;
rollback;
`;
}

export function buildEnqueueSql(projectRef, attemptBoundary, scheduledRunBaseline) {
  requireReference(projectRef);
  const boundary = requireAttemptBoundary(attemptBoundary);
  const baseline = requireBaseline(scheduledRunBaseline);
  return `begin;
do $scheduler_enqueue_guard$
declare cron_configured boolean := false;
begin
  if not exists (select 1 from pg_extension where extname = 'pg_net') then
    raise exception using message = 'scheduler_smoke_pg_net_unavailable';
  end if;
  if to_regprocedure('net.http_post(text,jsonb,jsonb,jsonb,integer)') is null then
    raise exception using message = 'scheduler_smoke_http_post_unavailable';
  end if;
  if (select count(*) from vault.secrets where name = '${VAULT_SECRET_NAME}') <> 1 then
    raise exception using message = 'scheduler_smoke_vault_secret_invalid';
  end if;
  perform pg_advisory_xact_lock(${CLAIM_LOCK_KEY});
  if exists (select 1 from public.forecast_runs where trigger_type = 'scheduled' and status = 'running') then
    raise exception using message = 'scheduler_smoke_active_run_present';
  end if;
  if (select count(*) from public.forecast_runs
      where trigger_type = 'scheduled') <> ${baseline}
    or exists (select 1 from public.forecast_runs
      where trigger_type = 'scheduled'
        and created_at >= '${boundary}'::timestamptz) then
    raise exception using message = 'scheduler_smoke_negative_baseline_mismatch';
  end if;
  if to_regclass('cron.job') is not null then
    execute $cron$select exists (
      select 1 from cron.job
      where jobname ilike '%forecast%' or command ilike '%collect-forecasts%'
    )$cron$ into cron_configured;
  end if;
  if cron_configured then
    raise exception using message = 'scheduler_smoke_cron_configured';
  end if;
end;
$scheduler_enqueue_guard$;
with vault_token as (
  select decrypted_secret as token
  from vault.decrypted_secrets
  where name = '${VAULT_SECRET_NAME}'
), enqueued as (
  select net.http_post(
    url := 'https://${projectRef}.supabase.co/functions/v1/collect-forecasts',
    body := '{}'::jsonb,
    params := '{}'::jsonb,
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || token
    ),
    timeout_milliseconds := 140000
  ) as internal_request_id
  from vault_token
)
select exists(select 1 from enqueued) as enqueue_committed;
commit;
`;
}

export function buildEvidenceSql(attemptBoundary) {
  const boundary = requireAttemptBoundary(attemptBoundary);
  return `begin;
set transaction read only;
with attempt as (
  select '${boundary}'::timestamptz as started_at
), candidate_runs as (
  select status, locations_total, locations_succeeded, locations_failed, snapshots_created
  from public.forecast_runs, attempt
  where trigger_type = 'scheduled' and created_at >= attempt.started_at
), summary as (
  select
    count(*)::integer as new_scheduled_runs,
    count(*) filter (where status = 'running')::integer as running_scheduled_runs,
    count(*) filter (where status in ('succeeded', 'partial', 'failed'))::integer as terminal_scheduled_runs,
    count(*) filter (where status not in ('running', 'succeeded', 'partial', 'failed'))::integer as invalid_status_runs,
    coalesce(max(locations_total), 0)::integer as locations_total,
    coalesce(max(locations_succeeded), 0)::integer as locations_succeeded,
    coalesce(max(locations_failed), 0)::integer as locations_failed,
    coalesce(max(snapshots_created), 0)::integer as snapshots_created,
    coalesce(max(status) filter (where status in ('succeeded', 'partial', 'failed')), 'none') as terminal_status
  from candidate_runs
), duplicates as (
  select count(*)::integer as duplicate_immutable_identity_count
  from (
    select snapshots.location_id, snapshots.collection_date, snapshots.target_date
    from public.forecast_snapshots snapshots
    join public.forecast_runs runs on runs.id = snapshots.forecast_run_id
    join attempt on true
    where runs.trigger_type = 'scheduled' and runs.created_at >= attempt.started_at
    group by snapshots.location_id, snapshots.collection_date, snapshots.target_date
    having count(*) > 1
  ) duplicate_keys
), active as (
  select count(*)::integer as unexpected_active_scheduled_runs
  from public.forecast_runs where trigger_type = 'scheduled' and status = 'running'
)
select
  'scheduler_smoke_evidence'::text as result_tag,
  case
    when new_scheduled_runs = 0 then 'no_new_scheduled_run'
    when new_scheduled_runs > 1 then 'unexpected_multiple_scheduled_runs'
    when running_scheduled_runs = 1 then 'one_running_scheduled_run'
    when terminal_scheduled_runs = 1 then 'one_terminal_scheduled_run'
    else 'invalid_run_status'
  end as run_category,
  new_scheduled_runs,
  terminal_scheduled_runs,
  running_scheduled_runs,
  terminal_status,
  locations_total,
  locations_succeeded,
  locations_failed,
  snapshots_created,
  (invalid_status_runs = 0 and locations_total >= 0 and locations_succeeded >= 0
    and locations_failed >= 0 and locations_succeeded + locations_failed = locations_total) as counter_invariant,
  duplicate_immutable_identity_count,
  unexpected_active_scheduled_runs
from summary cross join duplicates cross join active;
rollback;
`;
}

export const schedulerSmokeArtifactContract = Object.freeze({
  terminalStatuses: TERMINAL_STATUSES,
  claimLockKey: CLAIM_LOCK_KEY,
  vaultSecretName: VAULT_SECRET_NAME,
});

export function buildTerminalDeliveryDiagnosisSql(attemptBoundary) {
  if (typeof attemptBoundary !== "string" || !/^\d{4}-\d{2}-\d{2}T[^']+Z$/.test(attemptBoundary)) {
    throw new Error("diagnosis_attempt_boundary_invalid");
  }
  const boundary = attemptBoundary.replaceAll("'", "''");
  return `begin;
set transaction read only;
with candidates as (
  select r.id as response_key, r.status_code, r.content
  from net._http_response r
  where r.created >= '${boundary}'::timestamptz
), parsed as (
  select *, case when pg_input_is_valid(content, 'jsonb')
    then case when jsonb_typeof(content::jsonb) = 'object' then content::jsonb else null end
    else null end as response_object
  from candidates
), aggregate as (
  select count(*)::integer as correlation_candidate_count,
    count(*)::integer as response_count,
    max(status_code)::integer as http_status_code,
    bool_and(response_object is not null) as response_json_valid,
    max(response_object->>'error') filter (where response_object is not null) as error_value,
    max(response_object->>'reason') filter (where response_object is not null) as reason_value
  from parsed
)
select 'scheduler_delivery_diagnosis'::text as result_tag,
  case when correlation_candidate_count = 1 then 'correlated' else 'ambiguous' end as delivery_category,
  correlation_candidate_count, correlation_candidate_count <> 1 as correlation_ambiguous,
  response_count, case when correlation_candidate_count = 1 then http_status_code else null end as http_status_code,
  response_json_valid,
  case when correlation_candidate_count = 1 and error_value in ('invalid_request','unauthorized','method_not_allowed','configuration_error','overlap','internal_error') then error_value when correlation_candidate_count = 1 then 'other' else null end as sanitized_error,
  case when correlation_candidate_count = 1 and reason_value in ('unsupported_content_type','forbidden_request_header','body_too_large','invalid_json','body_must_be_object','body_must_be_empty') then reason_value when correlation_candidate_count = 1 then 'other' else null end as sanitized_reason,
  (http_status_code between 200 and 299) as status_is_2xx,
  (http_status_code between 400 and 499) as status_is_4xx,
  (http_status_code between 500 and 599) as status_is_5xx,
  0::integer as scheduled_run_count, 0::integer as active_run_count, 0::integer as snapshot_count, 0::integer as duplicate_identity_count,
  true as response_body_accessed, false as response_body_rendered, false as response_headers_accessed,
  false as request_body_accessed, false as authorization_accessed, false as raw_error_accessed
from aggregate;
rollback;`;
}
