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
  "acquire", "read", "write:negative_evidence_failed_terminal", "clear", "release",
]);

await assert.rejects(runHybridDevelopment(args, rejected), /manual_evidence_rejected/);
assert.equal(rejected.calls.reads, 2);
assert.equal(rejected.calls.clears, 1);
assert.equal(rejected.calls.writes.length, 1);
assert.equal(rejected.calls.releases, 2);

const cleanupFailure = binding({
  async clearAttemptArtifacts() {
    this.calls.order.push("clear");
    this.calls.clears += 1;
    throw new Error("filesystem failure");
  },
});
await assert.rejects(runHybridDevelopment(args, cleanupFailure), /validation_artifact_cleanup_failed/);
assert.equal(cleanupFailure.calls.writes.at(-1).phase, "negative_evidence_failed_terminal");
assert.equal(cleanupFailure.calls.releases, 1);

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
