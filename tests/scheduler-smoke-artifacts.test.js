import assert from "node:assert/strict";
import {
  buildEnqueueSql,
  buildEvidenceSql,
  buildPreflightSql,
  parseEvidenceResult,
  parsePreflightResult,
  requireAttemptBoundary,
  requireBaseline,
  schedulerSmokeArtifactContract,
} from "../scripts/lib/scheduler-smoke-artifacts.mjs";

const ref = "synthetic-development";
const boundary = "2026-01-01T00:00:00Z";
const preflight = buildPreflightSql();
const enqueue = buildEnqueueSql(ref, boundary, 0);
const evidence = buildEvidenceSql(boundary);

assert.match(preflight, /set transaction read only/i);
assert.match(preflight, /rollback;/i);
assert.match(preflight, /pg_extension/);
assert.match(preflight, /to_regprocedure/);
assert.match(preflight, /vault\.secrets/);
assert.match(preflight, /scheduler_smoke_active_run_present/);
assert.match(preflight, /scheduler_smoke_cron_configured/);
assert.match(preflight, /scheduler_smoke_preflight/);
assert.doesNotMatch(preflight, /decrypted_secret/i);

assert.match(enqueue, /begin;/i);
assert.match(enqueue, /pg_advisory_xact_lock\(734012521\)/);
assert.equal((enqueue.match(/select net\.http_post\(/g) ?? []).length, 1);
assert.equal((enqueue.match(/commit;/gi) ?? []).length, 1);
assert.equal((enqueue.match(/retry/gi) ?? []).length, 0);
assert.match(enqueue, /scheduler_smoke_pg_net_unavailable/);
assert.match(enqueue, /scheduler_smoke_http_post_unavailable/);
assert.match(enqueue, /scheduler_smoke_vault_secret_invalid/);
assert.match(enqueue, /scheduler_smoke_active_run_present/);
assert.match(enqueue, /scheduler_smoke_cron_configured/);
assert.match(enqueue, /scheduler_smoke_negative_baseline_mismatch/);
assert.match(enqueue, /body := '\{\}'::jsonb/);
assert.match(enqueue, /params := '\{\}'::jsonb/);
assert.match(enqueue, /timeout_milliseconds := 140000/);
assert.match(enqueue, /vault\.decrypted_secrets/);
assert.doesNotMatch(enqueue, /select\s+decrypted_secret\s*;/i);
assert.doesNotMatch(enqueue, /request_id\s*;/i);

assert.match(evidence, /set transaction read only/i);
assert.match(evidence, /rollback;/i);
assert.match(evidence, /scheduler_smoke_evidence/);
assert.match(evidence, /no_new_scheduled_run/);
assert.match(evidence, /one_running_scheduled_run/);
assert.match(evidence, /one_terminal_scheduled_run/);
assert.match(evidence, /unexpected_multiple_scheduled_runs/);
for (const status of schedulerSmokeArtifactContract.terminalStatuses) assert.match(evidence, new RegExp(`'${status}'`));
assert.doesNotMatch(evidence, /error_message|request_id|select\s+id\b/i);
assert.throws(() => requireAttemptBoundary("invalid"), /attempt_boundary_invalid/);
assert.throws(() => requireBaseline(-1), /scheduled_run_baseline_invalid/);
assert.throws(() => buildEnqueueSql(ref, boundary, 1.5), /scheduled_run_baseline_invalid/);
assert.throws(() => buildEvidenceSql("not-a-time"), /attempt_boundary_invalid/);
assert.deepEqual(parsePreflightResult({ result_tag: "scheduler_smoke_preflight", attempt_boundary: boundary, scheduled_run_baseline: 0, negative_baseline_status: "baseline_established_before_negative_phase" }), { attemptBoundary: boundary, scheduledRunBaseline: 0 });
for (const [run_category, terminal_status] of [["no_new_scheduled_run", "none"], ["one_running_scheduled_run", "none"], ["one_terminal_scheduled_run", "succeeded"], ["unexpected_multiple_scheduled_runs", "none"]]) {
  assert.equal(parseEvidenceResult({ result_tag: "scheduler_smoke_evidence", run_category, terminal_status, new_scheduled_runs: 0, terminal_scheduled_runs: 0, running_scheduled_runs: 0, locations_total: 0, locations_succeeded: 0, locations_failed: 0, snapshots_created: 0, duplicate_immutable_identity_count: 0, unexpected_active_scheduled_runs: 0, counter_invariant: true }).counterInvariant, true);
}
assert.throws(() => parseEvidenceResult({ result_tag: "scheduler_smoke_evidence", run_category: "invalid_run_status" }), /evidence_result_invalid/);

console.log("scheduler smoke artifacts: 34 fixtures, 0 failed, 0 skipped, 0 not-run");
