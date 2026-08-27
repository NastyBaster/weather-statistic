import assert from "node:assert/strict";
import { runHybridDevelopment } from "../scripts/validate-scheduler-development.mjs";

const args = ["--live-development", "--hybrid-sql-editor", "--confirm-development-smoke", "--development-name=development", "--production-name=production", "--resume-after-negative-evidence", "--negative-evidence-result-tag=scheduler_smoke_negative_evidence", "--negative-evidence-attempt-boundary=2026-01-01T00:00:00Z", "--negative-evidence-baseline=0", "--negative-evidence-new-runs=1", "--negative-evidence-active-runs=0", "--negative-evidence-created-runs=1"];
function binding() { const b = { state: { phase: "read_only_negative_evidence_required", negative: [{ label: "A", status: 405, category: "method_not_allowed" }], attempt_boundary: "2026-01-01T00:00:00Z", scheduled_run_baseline: 0 }, writes: [], clears: 0,
  async readPhaseState() { return this.state; }, async invalidatePhaseState() { this.state = { phase: "negative_evidence_terminalizing", cleanup: "terminal" }; this.invalidated = true; }, async clearWriteArtifacts() { this.clears++; }, async writePhaseState(s) { this.writes.push(s); this.state = s; }, async preflight() { throw new Error("must not preflight"); }, async writeSqlArtifacts() { throw new Error("must not enqueue"); } }; return b; }
const b = binding();
await assert.rejects(runHybridDevelopment(args, b), /negative_runs_created/);
assert.equal(b.state.phase, "negative_evidence_failed_terminal");
assert.equal(b.invalidated, true);
assert.equal(b.state.negative_evidence_failure, "negative_runs_created");
assert.equal(b.clears, 1);
assert.equal(b.state.negative.length, 1);
await assert.rejects(runHybridDevelopment(args.map((x) => x.replace("new-runs=1", "new-runs=0").replace("created-runs=1", "created-runs=0")), b), /negative_evidence_failed_terminal/);
assert.equal(b.writes.length, 1);

for (const field of ["negative-evidence-active-runs=1", "negative-evidence-baseline=1"]) {
  const x = binding();
  const values = args.map((a) => a).filter((a) => !a.startsWith("--negative-evidence-active-runs=") && !a.startsWith("--negative-evidence-baseline=")).concat(`--${field}`);
  await assert.rejects(runHybridDevelopment(values, x));
  assert.equal(x.state.phase, "negative_evidence_failed_terminal");
}
const persistFail = binding(); persistFail.writePhaseState = async () => { throw new Error("persist"); };
await assert.rejects(runHybridDevelopment(args, persistFail), /negative_evidence_terminalization_failed/);
assert.equal(persistFail.clears, 1);
await assert.rejects(runHybridDevelopment(args.map((x) => x.replace("new-runs=1", "new-runs=0").replace("created-runs=1", "created-runs=0")), persistFail), /negative_evidence_failed_terminal/);
const invalidateFail = binding(); invalidateFail.invalidatePhaseState = async () => { throw new Error("rename"); };
await assert.rejects(runHybridDevelopment(args, invalidateFail), /negative_evidence_terminalization_failed/);
assert.equal(invalidateFail.clears, 0);
console.log("scheduler terminal evidence state: 10 fixtures, 0 failed, 0 skipped, 0 not-run");
