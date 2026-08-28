import assert from "node:assert/strict";
import { runHybridDevelopment, sanitizeSchedulerValidationFailure } from "../scripts/validate-scheduler-development.mjs";

const common = ["--live-development", "--hybrid-sql-editor", "--confirm-development-smoke", "--development-name=development", "--production-name=production"];
const evidenceArgs = [...common, "--resume-after-negative-evidence", "--negative-evidence-result-tag=scheduler_smoke_negative_evidence", "--negative-evidence-attempt-boundary=2026-01-01T00:00:00Z", "--negative-evidence-baseline=0", "--negative-evidence-new-runs=0", "--negative-evidence-active-runs=0", "--negative-evidence-created-runs=0"];
const resumable = { phase: "read_only_negative_evidence_required", negative: [], attempt_boundary: "2026-01-01T00:00:00Z", scheduled_run_baseline: 0 };

function sharedClaim() {
  let held = false;
  return {
    async acquire() { if (held) throw new Error("negative_evidence_state_consume_failed"); held = true; },
    async release() { held = false; },
    get held() { return held; },
  };
}

function binding(claim, calls, state = resumable, hooks = {}) {
  return {
    async acquireResumeClaim() { calls.claims += 1; await claim.acquire(); },
    async releaseResumeClaim() { calls.releases += 1; if (hooks.release) await hooks.release(); else await claim.release(); },
    async readPhaseState() { calls.reads += 1; if (hooks.read) await hooks.read(); return state; },
    async consumeNegativeEvidenceState(options) { calls.consumes += 1; assert.equal(options.claimAlreadyHeld, true); return state; },
    async preflight() { calls.preflight += 1; return { linkedRef: "synthetic" }; },
    async writeSqlArtifacts() { calls.artifacts += 1; },
    async writePhaseState() { calls.writes += 1; },
  };
}

const claim = sharedClaim();
const winnerCalls = { claims: 0, releases: 0, reads: 0, consumes: 0, preflight: 0, artifacts: 0, writes: 0 };
let winnerInspection;
let continueWinner;
const inspectionPause = new Promise((resolve) => { winnerInspection = resolve; });
const inspectionGate = new Promise((resolve) => { continueWinner = resolve; });
const winner = runHybridDevelopment(evidenceArgs, binding(claim, winnerCalls, resumable, { read: async () => { winnerInspection(); await inspectionGate; } }));
await inspectionPause;
const loserCalls = { claims: 0, releases: 0, reads: 0, consumes: 0, preflight: 0, artifacts: 0, writes: 0 };
await assert.rejects(runHybridDevelopment(evidenceArgs, binding(claim, loserCalls)), /negative_evidence_state_consume_failed/);
assert.deepEqual([loserCalls.reads, loserCalls.consumes, loserCalls.artifacts, loserCalls.writes], [0, 0, 0, 0]);
continueWinner();
const completed = await winner;
assert.equal(completed.phase, "manual_enqueue_required");
assert.deepEqual([winnerCalls.claims, winnerCalls.reads, winnerCalls.consumes, winnerCalls.artifacts, winnerCalls.writes, winnerCalls.releases], [1, 1, 1, 1, 1, 1]);

const raceClaim = sharedClaim();
await raceClaim.acquire();
const raceCalls = { claims: 0, releases: 0, reads: 0, consumes: 0, preflight: 0, artifacts: 0, writes: 0 };
await assert.rejects(runHybridDevelopment(evidenceArgs, binding(raceClaim, raceCalls)), /negative_evidence_state_consume_failed/);
assert.equal(sanitizeSchedulerValidationFailure(new Error("negative_evidence_state_consume_failed")).category, "negative_evidence_state_consume_failed");
assert.equal(sanitizeSchedulerValidationFailure(new Error("ENOENT")).category, "scheduler_validation_failed");
assert.equal(raceCalls.reads, 0);

for (const phase of ["negative_evidence_failed_terminal", "negative_evidence_terminalizing"]) {
  const tombstoneClaim = sharedClaim();
  const calls = { claims: 0, releases: 0, reads: 0, consumes: 0, preflight: 0, artifacts: 0, writes: 0 };
  const result = await runHybridDevelopment(evidenceArgs, binding(tombstoneClaim, calls, { phase, cleanup: "terminal" }));
  assert.equal(result.phase, phase);
  assert.deepEqual([calls.claims, calls.reads, calls.consumes, calls.artifacts, calls.writes, calls.releases], [1, 1, 0, 0, 0, 1]);
}

const releaseClaim = sharedClaim();
const releaseCalls = { claims: 0, releases: 0, reads: 0, consumes: 0, preflight: 0, artifacts: 0, writes: 0 };
await assert.rejects(runHybridDevelopment(evidenceArgs, binding(releaseClaim, releaseCalls, { phase: "negative_evidence_failed_terminal", cleanup: "terminal" }, { release: async () => { throw new Error("scheduler_resume_claim_release_failed"); } })), /scheduler_resume_claim_release_failed/);
assert.deepEqual([releaseCalls.reads, releaseCalls.consumes, releaseCalls.artifacts, releaseCalls.writes, releaseCalls.releases], [1, 0, 0, 0, 1]);
assert.equal(releaseClaim.held, true);
console.log("scheduler negative-evidence inspection concurrency: 6 fixtures, 6 passed, 0 failed, 0 skipped, 0 not-run");
