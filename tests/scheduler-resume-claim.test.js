import assert from "node:assert/strict";
import { createSchedulerDevelopmentLocalBinding } from "../scripts/lib/scheduler-development-local-binding.mjs";

const files = new Set(["scheduler-phase-state.json"]), resetDeletes = [], rootCreates = [];
const fs = {
  async mkdir(path) { if (!path.includes("scheduler-resume-claim") && !path.includes("forecast-scheduler-validation-claim")) { rootCreates.push(path); return; } if (files.has("scheduler-resume-claim")) { const e = new Error("exists"); e.code = "EEXIST"; throw e; } files.add("scheduler-resume-claim"); },
  async lstat(path) { return { isSymbolicLink: () => false, isDirectory: () => path.endsWith("validation") || path.includes("scheduler-resume-claim") || path.includes("forecast-scheduler-validation-claim") }; },
  async readdir(path) { return path.includes("scheduler-resume-claim") || path.includes("forecast-scheduler-validation-claim") ? [] : [...files]; },
  async rename(_from, to) { files.add(to.split(/[\\/]/).pop()); files.delete("scheduler-phase-state.json"); },
  async writeFile() {}, async unlink(path) { resetDeletes.push(path); files.delete(path.split(/[\\/]/).pop()); }, async rmdir(path) { resetDeletes.push(path); files.delete(path.split(/[\\/]/).pop()); files.delete("scheduler-resume-claim"); }, async rm() {},
};
const binding = createSchedulerDevelopmentLocalBinding({ filesystem: fs, temporaryDirectory: "C:/validation", readPhaseState: async () => ({ phase: "read_only_negative_evidence_required", attempt_boundary: "x", scheduled_run_baseline: 0 }) });
await binding.consumeNegativeEvidenceState();
assert.equal(rootCreates.length > 0, true);
assert.equal(files.has("scheduler-resume-claim"), true);
await assert.rejects(binding.consumeNegativeEvidenceState(), /negative_evidence_state_consume_failed/);
assert.equal(files.has("scheduler-resume-claim"), true);
await binding.releaseResumeClaim();
assert.equal(files.has("scheduler-resume-claim"), false);
resetDeletes.length = 0;
files.add("scheduler-resume-claim");
const reset = createSchedulerDevelopmentLocalBinding({ filesystem: fs, temporaryDirectory: "C:/validation", readPhaseState: async () => ({ phase: "read_only_preflight_required" }) });
await assert.rejects(reset.prepareAttempt(), /scheduler_resume_claim_active/);
assert.equal(files.has("scheduler-resume-claim"), true);
assert.equal(resetDeletes.length, 0);
assert.equal(JSON.stringify([...files]).includes("C:/"), false);
const cleanup = createSchedulerDevelopmentLocalBinding({ filesystem: fs, temporaryDirectory: "C:/validation" });
await assert.rejects(cleanup.cleanupArtifacts(), /scheduler_resume_claim_active/);
assert.equal(resetDeletes.length, 0);
const failureFiles = new Set(), failureCalls = { release: 0, move: 0 };
const failureFs = {
  async mkdir(path) { if (path.includes("scheduler-resume-claim") || path.includes("forecast-scheduler-validation-claim")) failureFiles.add("scheduler-resume-claim"); },
  async lstat(path) { return { isSymbolicLink: () => false, isDirectory: () => path.endsWith("validation") || path.includes("scheduler-resume-claim") || path.includes("forecast-scheduler-validation-claim") }; },
  async rename() { failureCalls.move += 1; },
  async writeFile() {},
  async rmdir() { failureCalls.release += 1; failureFiles.delete("scheduler-resume-claim"); },
};
const readFailure = createSchedulerDevelopmentLocalBinding({ filesystem: failureFs, temporaryDirectory: "C:/validation", readPhaseState: async () => { throw new Error("state_read_failed"); } });
await assert.rejects(readFailure.consumeNegativeEvidenceState(), /negative_evidence_state_consume_failed/);
assert.equal(failureCalls.release, 1);
assert.equal(failureCalls.move, 0);
assert.equal(failureFiles.has("scheduler-resume-claim"), false);
console.log("scheduler resume claim: 9 fixtures, 0 failed, 0 skipped, 0 not-run");
