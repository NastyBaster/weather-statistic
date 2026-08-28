import assert from "node:assert/strict";
import { createSchedulerDevelopmentLocalBinding } from "../scripts/lib/scheduler-development-local-binding.mjs";
import { runHybridDevelopment, sanitizeSchedulerValidationFailure } from "../scripts/validate-scheduler-development.mjs";

function fixture({ releaseError = null } = {}) {
  const calls = { order: [], unlink: 0, rootRemoval: 0, claimRemoval: 0 };
  const files = new Set(["scheduler-phase-state.json"]);
  const filesystem = {
    async mkdir(path) { if (path.includes("forecast-scheduler-validation-claim")) calls.order.push("claim-acquire"); },
    async lstat(path) { return { isSymbolicLink: () => false, isDirectory: () => path.endsWith("validation") || path.includes("forecast-scheduler-validation-claim") }; },
    async readdir() { return [...files]; },
    async unlink(path) { calls.unlink += 1; calls.order.push("artifact-remove"); files.delete(path.split(/[\\/]/).pop()); },
    async rmdir(path) {
      if (path.includes("forecast-scheduler-validation-claim")) {
        calls.claimRemoval += 1; calls.order.push("claim-release");
        if (releaseError) throw releaseError;
      } else { calls.rootRemoval += 1; calls.order.push("root-remove"); }
    },
  };
  return { calls, filesystem, files };
}

const releaseError = new Error("sensitive filesystem path"); releaseError.code = "EACCES";
const failed = fixture({ releaseError });
const failedBinding = createSchedulerDevelopmentLocalBinding({ filesystem: failed.filesystem, temporaryDirectory: "C:/validation" });
await assert.rejects(failedBinding.cleanupArtifacts(), /scheduler_resume_claim_release_failed/);
assert.deepEqual(failed.calls.order, ["claim-acquire", "artifact-remove", "root-remove", "claim-release"]);
assert.equal(failed.calls.rootRemoval, 1);
assert.equal(failed.calls.claimRemoval, 1);
assert.equal(failed.files.has("scheduler-phase-state.json"), false);
const safeRelease = sanitizeSchedulerValidationFailure(new Error("scheduler_resume_claim_release_failed"));
assert.equal(safeRelease.category, "scheduler_resume_claim_release_failed");
assert.equal(JSON.stringify(safeRelease).includes("sensitive filesystem path"), false);

const successful = fixture();
const successfulBinding = createSchedulerDevelopmentLocalBinding({ filesystem: successful.filesystem, temporaryDirectory: "C:/validation" });
await successfulBinding.cleanupArtifacts();
assert.deepEqual(successful.calls.order, ["claim-acquire", "artifact-remove", "root-remove", "claim-release"]);
assert.equal(successful.calls.claimRemoval, 1);
assert.equal(successful.calls.rootRemoval, 1);
console.log("scheduler final cleanup release: 2 fixtures, 2 passed, 0 failed, 0 skipped, 0 not-run");
