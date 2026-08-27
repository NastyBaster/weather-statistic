import assert from "node:assert/strict";
import { runHybridDevelopment } from "../scripts/validate-scheduler-development.mjs";
import { buildNegativeEvidenceSql, parseNegativeEvidenceResult, parseNegativeEvidenceResults } from "../scripts/lib/scheduler-smoke-artifacts.mjs";

const args = ["--live-development", "--hybrid-sql-editor", "--confirm-development-smoke", "--development-name=development", "--production-name=production"];
const boundary = "2026-01-01T00:00:00Z";
const baseState = { phase: "read_only_preflight_required", attempt_boundary: boundary, scheduled_run_baseline: 0 };
const negative = [
  { label: "get_no_auth", status: 405, category: "method_not_allowed", reachedEndpoint: true },
  { label: "post_no_auth", status: 401, category: "unauthorized", reachedEndpoint: true },
  { label: "post_wrong_bearer", status: 401, category: "unauthorized", reachedEndpoint: true },
  { label: "post_unexpected_body", status: 401, category: "unauthorized", reachedEndpoint: true },
];

function makeBinding(overrides = {}) {
  const calls = { negative: 0, enqueue: 0, evidence: 0, preflight: 0, states: [] };
  const binding = {
    calls,
    async preflight() { calls.preflight += 1; return { linkedRef: "synthetic-ref", endpoint: "synthetic-endpoint" }; },
    async runNegativeCases(_endpoint, save) { calls.negative += 1; for (const record of negative) await save(negative.slice(0, negative.indexOf(record) + 1), null); return negative; },
    async writeNegativeEvidenceArtifact() { calls.evidence += 1; return {}; },
    async writeSqlArtifacts() { calls.enqueue += 1; return {}; },
    async writePreflightArtifact() { return {}; },
    async writePhaseState(state) { calls.states.push(state); this.state = state; },
    async readPhaseState() { return this.state ?? baseState; },
    async cleanupArtifacts() {},
    ...overrides,
  };
  return binding;
}

const phaseA = makeBinding();
const initial = await runHybridDevelopment(args, phaseA);
assert.equal(initial.phase, "read_only_preflight_required");
assert.equal(phaseA.calls.negative, 0);
assert.equal(phaseA.calls.enqueue, 0);

const afterNegatives = makeBinding();
const required = await runHybridDevelopment([...args, "--resume-after-manual-preflight", `--attempt-boundary=${boundary}`, "--scheduled-run-baseline=0"], afterNegatives);
assert.equal(required.phase, "read_only_negative_evidence_required");
assert.equal(required.negative.length, 4);
assert.equal(afterNegatives.calls.negative, 1);
assert.equal(afterNegatives.calls.evidence, 1);
assert.equal(afterNegatives.calls.enqueue, 0);
assert.equal(required.negative_evidence_required, true);

const evidenceSql = buildNegativeEvidenceSql(boundary, 0);
assert.match(evidenceSql, /set transaction read only/i);
assert.match(evidenceSql, /rollback;/i);
assert.doesNotMatch(evidenceSql, /net\.http_post/i);
assert.doesNotMatch(evidenceSql, /\b(insert|update|delete|alter|create|drop)\b/i);
assert.equal(Object.keys(parseNegativeEvidenceResult({ result_tag: "scheduler_smoke_negative_evidence", attempt_boundary: boundary, scheduled_run_baseline: 0, new_scheduled_runs: 0, active_scheduled_runs: 0, negative_created_runs: 0 })).length, 5);
assert.throws(() => parseNegativeEvidenceResults([]), /negative_evidence_missing/);
assert.throws(() => parseNegativeEvidenceResults([{}, {}]), /negative_evidence_ambiguous/);

const successfulEvidence = makeBinding({ state: { phase: "read_only_negative_evidence_required", negative: negative, attempt_boundary: boundary, scheduled_run_baseline: 0 } });
const manual = await runHybridDevelopment([...args, "--resume-after-negative-evidence", "--negative-evidence-result-tag=scheduler_smoke_negative_evidence", `--negative-evidence-attempt-boundary=${boundary}`, "--negative-evidence-baseline=0", "--negative-evidence-new-runs=0", "--negative-evidence-active-runs=0", "--negative-evidence-created-runs=0"], successfulEvidence);
assert.equal(manual.phase, "manual_enqueue_required");
assert.equal(manual.negative_evidence_passed, true);
assert.equal(successfulEvidence.calls.negative, 0);
assert.equal(successfulEvidence.calls.enqueue, 1);

async function rejectEvidence(fields, category, state = { phase: "read_only_negative_evidence_required", attempt_boundary: boundary, scheduled_run_baseline: 0 }) {
  const binding = makeBinding({ state });
  await assert.rejects(runHybridDevelopment([...args, "--resume-after-negative-evidence", ...Object.entries(fields).map(([k, v]) => `--negative-evidence-${k}=${v}`)], binding), new RegExp(category));
  assert.equal(binding.calls.enqueue, 0);
  assert.equal(binding.calls.negative, 0);
}

await rejectEvidence({}, "negative_evidence_parser_failure");
await rejectEvidence({ "result-tag": "scheduler_smoke_negative_evidence", "attempt-boundary": boundary, baseline: 0, "new-runs": 1, "active-runs": 0, "created-runs": 1 }, "negative_runs_created");
await rejectEvidence({ "result-tag": "scheduler_smoke_negative_evidence", "attempt-boundary": boundary, baseline: 0, "new-runs": 0, "active-runs": 1, "created-runs": 0 }, "active_scheduled_run_detected");
await rejectEvidence({ "result-tag": "scheduler_smoke_negative_evidence", "attempt-boundary": "2026-01-02T00:00:00Z", baseline: 0, "new-runs": 0, "active-runs": 0, "created-runs": 0 }, "negative_evidence_attempt_mismatch");
await rejectEvidence({ "result-tag": "scheduler_smoke_negative_evidence", "attempt-boundary": boundary, baseline: 1, "new-runs": 0, "active-runs": 0, "created-runs": 0 }, "negative_evidence_baseline_mismatch");
await rejectEvidence({ "result-tag": "wrong", "attempt-boundary": boundary, baseline: 0, "new-runs": 0, "active-runs": 0, "created-runs": 0 }, "negative_evidence_parser_failure");
await rejectEvidence({ "result-tag": "scheduler_smoke_negative_evidence", "attempt-boundary": boundary, baseline: 0, "new-runs": "x", "active-runs": 0, "created-runs": 0 }, "negative_evidence_parser_failure");
await rejectEvidence({ "result-tag": "scheduler_smoke_negative_evidence", "attempt-boundary": boundary, baseline: 0, "new-runs": 0, "active-runs": 0, "created-runs": 0, extra: "bad" }, "runtime_argument_unknown");
await rejectEvidence({ "result-tag": "scheduler_smoke_negative_evidence", "attempt-boundary": boundary, baseline: 0, "new-runs": 0, "active-runs": 0, "created-runs": 0 }, "negative_evidence_missing", { phase: "manual_enqueue_required", attempt_boundary: boundary, scheduled_run_baseline: 0 });

const interruption = makeBinding({
  async runNegativeCases(_endpoint, save) { this.calls.negative += 1; await save([negative[0]], "post_no_auth"); throw new Error("negative_request_submission_failed"); },
});
await assert.rejects(runHybridDevelopment([...args, "--resume-after-manual-preflight", `--attempt-boundary=${boundary}`, "--scheduled-run-baseline=0"], interruption), /negative_request_submission_failed/);
assert.equal(interruption.calls.enqueue, 0);
assert.equal(interruption.calls.states[0].phase, "negative_request_in_flight");
assert.equal(interruption.calls.states[0].negative.length, 1);

assert.equal(negative.length, 4);
assert.equal(negative.every((record) => Object.hasOwn(record, "label") && Object.hasOwn(record, "status") && Object.hasOwn(record, "category")), true);
assert.equal(JSON.stringify(manual).includes("synthetic-ref"), false);
assert.equal(JSON.stringify(manual).includes("endpoint"), false);
const committedFailure = makeBinding({ state: { phase: "read_only_negative_evidence_required", negative, attempt_boundary: boundary, scheduled_run_baseline: 0 } });
committedFailure.calls.clears = 0;
committedFailure.clearWriteArtifacts = async () => { committedFailure.calls.clears += 1; };
committedFailure.releaseResumeClaim = async () => { throw new Error("scheduler_resume_claim_release_failed"); };
await assert.rejects(runHybridDevelopment([...args, "--resume-after-negative-evidence", "--negative-evidence-result-tag=scheduler_smoke_negative_evidence", `--negative-evidence-attempt-boundary=${boundary}`, "--negative-evidence-baseline=0", "--negative-evidence-new-runs=0", "--negative-evidence-active-runs=0", "--negative-evidence-created-runs=0"], committedFailure), /scheduler_resume_claim_release_failed/);
assert.equal(committedFailure.calls.enqueue, 1);
assert.equal(committedFailure.calls.clears, 0);
assert.equal(committedFailure.calls.states.at(-1).phase, "manual_enqueue_required");
console.log("scheduler negative evidence boundary: 34 fixtures, 0 failed, 0 skipped, 0 not-run");
