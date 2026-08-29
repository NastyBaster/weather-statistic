import assert from "node:assert/strict";
import { runHybridDevelopment } from "../scripts/validate-scheduler-development.mjs";

const args = [
  "--live-development", "--hybrid-sql-editor", "--confirm-development-smoke",
  "--development-name=development", "--production-name=production",
  "--resume-after-manual-enqueue", "--enqueue-committed=true",
  "--evidence-result-tag=scheduler_smoke_evidence",
  "--evidence-run-category=no_new_scheduled_run",
  "--new-scheduled-runs=0", "--terminal-scheduled-runs=0",
  "--running-scheduled-runs=0", "--terminal-status=none",
  "--locations-total=0", "--locations-succeeded=0", "--locations-failed=0",
  "--snapshots-created=0", "--duplicate-identity-count=0",
  "--unexpected-active-scheduled-runs=0", "--counter-invariant=true",
];

function binding(overrides = {}) {
  const calls = { reads: 0, writes: [], clears: 0, releases: 0, order: [] };
  const base = {
    async acquireResumeClaim() { calls.order.push("acquire"); },
    async readPhaseState() {
      calls.reads += 1;
      calls.order.push("read");
      return this.state ?? {
        phase: "manual_enqueue_required",
        attempt_boundary: "2026-01-01T00:00:00Z",
        scheduled_run_baseline: 0,
      };
    },
    async writePhaseState(state) {
      calls.order.push(`write:${state.phase}`);
      calls.writes.push(state);
      this.state = state;
    },
    async clearAttemptArtifacts() { calls.order.push("clear"); calls.clears += 1; },
    async releaseResumeClaim() { calls.order.push("release"); calls.releases += 1; },
  };
  return Object.assign(base, overrides, { calls });
}

const rejected = binding();
await assert.rejects(runHybridDevelopment(args, rejected), /manual_evidence_rejected/);
assert.equal(rejected.calls.reads, 1);
assert.equal(rejected.calls.clears, 1);
assert.equal(rejected.calls.releases, 1);
assert.equal(rejected.calls.writes.at(-1).phase, "negative_evidence_failed_terminal");
assert.deepEqual(rejected.calls.order, [
  "acquire", "read", "write:negative_evidence_failed_terminal", "clear", "write:negative_evidence_failed_terminal", "release",
]);

const malformed = binding();
const malformedArgs = args.map((value) => value === "--evidence-result-tag=scheduler_smoke_evidence"
  ? "--evidence-result-tag=invalid" : value);
await assert.rejects(runHybridDevelopment(malformedArgs, malformed), /manual_evidence_invalid/);
assert.equal(malformed.calls.writes.at(-1).negative_evidence_failure, "manual_evidence_invalid");

const invalidation = binding({
  async invalidateManualEnqueueState(state) {
    assert.equal(state.phase, "manual_enqueue_required");
    this.calls.order.push("invalidate");
  },
});
await assert.rejects(runHybridDevelopment(args, invalidation), /manual_evidence_rejected/);
assert.deepEqual(invalidation.calls.order, [
  "acquire", "read", "invalidate", "write:negative_evidence_failed_terminal", "clear", "write:negative_evidence_failed_terminal", "release",
]);

const invalidationFailure = binding({
  async invalidateManualEnqueueState() { this.calls.order.push("invalidate"); throw new Error("rename failed"); },
});
await assert.rejects(runHybridDevelopment(args, invalidationFailure), /negative_evidence_terminalization_failed/);
assert.equal(invalidationFailure.calls.writes.length, 0);
assert.equal(invalidationFailure.calls.clears, 0);

const completed = binding({ state: {
  phase: "manual_enqueue_complete", attempt_boundary: "2026-01-01T00:00:00Z",
  scheduled_run_baseline: 0, cleanup: "complete",
} });
const completedResult = await runHybridDevelopment(args, completed);
assert.equal(completedResult.phase, "manual_enqueue_complete");
assert.equal(completed.calls.reads, 1);
assert.equal(completed.calls.writes.length, 0);
assert.equal(completed.calls.clears, 0);
assert.equal(completed.calls.releases, 1);

const terminal = binding({ state: {
  phase: "negative_evidence_failed_terminal", attempt_boundary: "2026-01-01T00:00:00Z",
  scheduled_run_baseline: 0, negative_evidence_failure: "manual_evidence_rejected", cleanup: "terminal",
} });
const terminalResult = await runHybridDevelopment(args, terminal);
assert.equal(terminalResult.phase, "negative_evidence_failed_terminal");
assert.equal(terminal.calls.writes.length, 0);
assert.equal(terminal.calls.clears, 0);
assert.equal(terminal.calls.releases, 1);

const unexpected = binding({ state: {
  phase: "read_only_negative_evidence_required", attempt_boundary: "2026-01-01T00:00:00Z",
  scheduled_run_baseline: 0,
} });
await assert.rejects(runHybridDevelopment(args, unexpected), /existing_negative_baseline_not_provable/);
assert.equal(unexpected.calls.writes.length, 0);
assert.equal(unexpected.calls.clears, 0);
assert.equal(unexpected.calls.releases, 1);

const cleanupFailure = binding({
  async clearAttemptArtifacts() {
    this.calls.order.push("clear");
    this.calls.clears += 1;
    throw new Error("filesystem failure");
  },
});
await assert.rejects(runHybridDevelopment(args, cleanupFailure), /validation_artifact_cleanup_failed/);
assert.equal(cleanupFailure.calls.writes.at(-1).phase, "negative_evidence_failed_terminal");
assert.equal(cleanupFailure.calls.writes.at(-1).negative_evidence_failure, "validation_artifact_cleanup_failed");
assert.equal(cleanupFailure.calls.writes.at(-1).cleanup, "manual_intervention_required");
assert.equal(cleanupFailure.calls.writes.length, 2);
assert.equal(cleanupFailure.calls.releases, 1);

const cleanupUnsafe = binding({
  async clearAttemptArtifacts() { this.calls.order.push("clear"); this.calls.clears += 1; throw new Error("validation_artifact_path_unsafe"); },
});
await assert.rejects(runHybridDevelopment(args, cleanupUnsafe), /validation_artifact_path_unsafe/);
assert.equal(cleanupUnsafe.calls.writes.at(-1).negative_evidence_failure, "validation_artifact_path_unsafe");
assert.equal(cleanupUnsafe.calls.writes.at(-1).cleanup, "manual_intervention_required");

let replacementWrite = false;
const replacementFailure = binding({
  async writePhaseState(state) {
    this.calls.order.push(`write:${state.phase}`);
    this.calls.writes.push(state);
    if (replacementWrite) throw new Error("state persistence failed");
    this.state = state;
    replacementWrite = true;
  },
  async clearAttemptArtifacts() { this.calls.order.push("clear"); this.calls.clears += 1; throw new Error("filesystem failure"); },
});
await assert.rejects(runHybridDevelopment(args, replacementFailure), /negative_evidence_terminalization_failed/);
assert.equal(replacementFailure.calls.writes[0].phase, "negative_evidence_failed_terminal");
assert.equal(replacementFailure.calls.releases, 0);

const releaseFailure = binding({
  async releaseResumeClaim() {
    this.calls.order.push("release");
    this.calls.releases += 1;
    throw new Error("scheduler_resume_claim_release_failed");
  },
});
await assert.rejects(runHybridDevelopment(args, releaseFailure), /scheduler_resume_claim_release_failed/);
assert.equal(releaseFailure.calls.writes.at(-1).phase, "negative_evidence_failed_terminal");
assert.equal(releaseFailure.calls.clears, 1);

console.log("scheduler final evidence terminalization: 4 fixtures, 4 passed, 0 failed, 0 skipped, 0 not-run");
