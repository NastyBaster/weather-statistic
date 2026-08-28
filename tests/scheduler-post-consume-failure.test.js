import assert from "node:assert/strict";
import { runHybridDevelopment, sanitizeSchedulerValidationFailure } from "../scripts/validate-scheduler-development.mjs";

const common = ["--live-development", "--hybrid-sql-editor", "--confirm-development-smoke", "--development-name=development", "--production-name=production"];
const evidenceArgs = [...common, "--resume-after-negative-evidence", "--negative-evidence-result-tag=scheduler_smoke_negative_evidence", "--negative-evidence-attempt-boundary=2026-01-01T00:00:00Z", "--negative-evidence-baseline=0", "--negative-evidence-new-runs=0", "--negative-evidence-active-runs=0", "--negative-evidence-created-runs=0"];
const state = { phase: "read_only_negative_evidence_required", negative: [], attempt_boundary: "2026-01-01T00:00:00Z", scheduled_run_baseline: 0 };

function claim() {
  let held = false;
  return { async acquire() { if (held) throw new Error("negative_evidence_state_consume_failed"); held = true; }, async release() { held = false; }, get held() { return held; } };
}

function fixture(shared, hooks = {}) {
  const calls = { order: [], acquire: 0, reads: 0, consume: 0, preflight: 0, clear: 0, artifacts: 0, writes: [], release: 0 };
  const binding = {
    async acquireResumeClaim() { calls.acquire += 1; calls.order.push("acquire"); await shared.acquire(); },
    async releaseResumeClaim() { calls.release += 1; calls.order.push("release"); if (hooks.release) await hooks.release(); else await shared.release(); },
    async readPhaseState() { calls.reads += 1; return state; },
    async consumeNegativeEvidenceState({ claimAlreadyHeld }) { assert.equal(claimAlreadyHeld, true); calls.consume += 1; calls.order.push("consume"); return state; },
    async preflight() { calls.preflight += 1; calls.order.push("preflight"); if (hooks.preflight) await hooks.preflight(); return { linkedRef: "synthetic" }; },
    async clearWriteArtifacts() { calls.clear += 1; calls.order.push("clear"); if (hooks.clear) await hooks.clear(); },
    async writeSqlArtifacts() { calls.artifacts += 1; calls.order.push("artifacts"); if (hooks.artifacts) await hooks.artifacts(); },
    async writePhaseState(next) { calls.writes.push(next); calls.order.push(`state:${next.phase}`); if (hooks.write) await hooks.write(next); },
  };
  return { binding, calls };
}

const failedClaim = claim();
const failed = fixture(failedClaim, { preflight: async () => { throw new Error("mocked_cli_timeout"); } });
await assert.rejects(runHybridDevelopment(evidenceArgs, failed.binding), /negative_evidence_preflight_failed/);
assert.equal(failed.calls.artifacts, 0);
assert.equal(failed.calls.writes.at(-1).phase, "negative_evidence_failed_terminal");
assert.deepEqual(failed.calls.order, ["acquire", "consume", "preflight", "clear", "state:negative_evidence_failed_terminal", "release"]);
assert.equal(failedClaim.held, false);
assert.equal(sanitizeSchedulerValidationFailure(new Error("negative_evidence_preflight_failed")).category, "negative_evidence_preflight_failed");

const cleanupClaim = claim();
const cleanup = fixture(cleanupClaim, { preflight: async () => { throw new Error("mocked"); }, clear: async () => { throw new Error("validation_artifact_path_unsafe"); } });
await assert.rejects(runHybridDevelopment(evidenceArgs, cleanup.binding), /validation_artifact_path_unsafe/);
assert.equal(cleanup.calls.writes.at(-1).negative_evidence_failure, "validation_artifact_path_unsafe");
assert.deepEqual(cleanup.calls.order.slice(-2), ["state:negative_evidence_failed_terminal", "release"]);

const persistenceClaim = claim();
const persistence = fixture(persistenceClaim, { preflight: async () => { throw new Error("mocked"); }, write: async () => { throw new Error("state_write_failed"); } });
await assert.rejects(runHybridDevelopment(evidenceArgs, persistence.binding), /negative_evidence_terminalization_failed/);
assert.equal(persistence.calls.artifacts, 0);
assert.equal(persistence.calls.release, 0);
assert.equal(persistenceClaim.held, true);
await assert.rejects(runHybridDevelopment(evidenceArgs, persistence.binding), /negative_evidence_state_consume_failed/);

const releaseClaim = claim();
const release = fixture(releaseClaim, { preflight: async () => { throw new Error("mocked"); }, release: async () => { throw new Error("scheduler_resume_claim_release_failed"); } });
await assert.rejects(runHybridDevelopment(evidenceArgs, release.binding), /scheduler_resume_claim_release_failed/);
assert.equal(release.calls.writes.at(-1).phase, "negative_evidence_failed_terminal");
assert.equal(releaseClaim.held, true);

const successClaim = claim();
const success = fixture(successClaim);
const result = await runHybridDevelopment(evidenceArgs, success.binding);
assert.equal(result.phase, "manual_enqueue_required");
assert.equal(success.calls.writes.at(-1).phase, "manual_enqueue_required");
assert.deepEqual(success.calls.order.slice(-3), ["artifacts", "state:manual_enqueue_required", "release"]);

const overlapClaim = claim();
let preflightStarted;
let continuePreflight;
const started = new Promise((resolve) => { preflightStarted = resolve; });
const gate = new Promise((resolve) => { continuePreflight = resolve; });
const active = fixture(overlapClaim, { preflight: async () => { preflightStarted(); await gate; throw new Error("mocked"); } });
const activeRun = runHybridDevelopment(evidenceArgs, active.binding);
await started;
const baseCalls = { prepare: 0, preflight: 0, artifacts: 0, writes: 0 };
const base = { async prepareAttempt() { baseCalls.prepare += 1; await overlapClaim.acquire(); }, async preflight() { baseCalls.preflight += 1; }, async writePreflightArtifact() { baseCalls.artifacts += 1; }, async writePhaseState() { baseCalls.writes += 1; } };
await assert.rejects(runHybridDevelopment(common, base), /negative_evidence_state_consume_failed/);
assert.deepEqual([baseCalls.preflight, baseCalls.artifacts, baseCalls.writes], [0, 0, 0]);
continuePreflight();
await assert.rejects(activeRun, /negative_evidence_preflight_failed/);
assert.equal(active.calls.writes.at(-1).phase, "negative_evidence_failed_terminal");
console.log("scheduler post-consume failure: 6 fixtures, 6 passed, 0 failed, 0 skipped, 0 not-run");
