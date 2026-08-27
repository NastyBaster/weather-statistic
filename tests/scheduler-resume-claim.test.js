import assert from "node:assert/strict";
import { createSchedulerDevelopmentLocalBinding } from "../scripts/lib/scheduler-development-local-binding.mjs";

const files = new Set(["scheduler-phase-state.json"]);
const fs = {
  async mkdir(path) { if (!path.endsWith("scheduler-resume-claim")) return; if (files.has("scheduler-resume-claim")) { const e = new Error("exists"); e.code = "EEXIST"; throw e; } files.add("scheduler-resume-claim"); },
  async lstat(path) { return { isSymbolicLink: () => false, isDirectory: () => path.endsWith("validation") || path.endsWith("scheduler-resume-claim") }; },
  async readdir(path) { return path.endsWith("scheduler-resume-claim") ? [] : [...files]; },
  async rename(_from, to) { files.add(to.split(/[\\/]/).pop()); files.delete("scheduler-phase-state.json"); },
  async writeFile() {}, async unlink(path) { files.delete(path.split(/[\\/]/).pop()); }, async rmdir(path) { files.delete(path.split(/[\\/]/).pop()); }, async rm() {},
};
const binding = createSchedulerDevelopmentLocalBinding({ filesystem: fs, temporaryDirectory: "C:/validation", readPhaseState: async () => ({ phase: "read_only_negative_evidence_required", attempt_boundary: "x", scheduled_run_baseline: 0 }) });
await binding.consumeNegativeEvidenceState();
assert.equal(files.has("scheduler-resume-claim"), true);
await assert.rejects(binding.consumeNegativeEvidenceState(), /negative_evidence_state_consume_failed/);
assert.equal(files.has("scheduler-resume-claim"), true);
await binding.releaseResumeClaim();
assert.equal(files.has("scheduler-resume-claim"), false);
files.add("scheduler-resume-claim");
const reset = createSchedulerDevelopmentLocalBinding({ filesystem: fs, temporaryDirectory: "C:/validation", readPhaseState: async () => ({ phase: "read_only_preflight_required" }) });
await reset.prepareAttempt();
assert.equal(files.has("scheduler-resume-claim"), false);
console.log("scheduler resume claim: 4 fixtures, 0 failed, 0 skipped, 0 not-run");
