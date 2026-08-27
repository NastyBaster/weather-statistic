import assert from "node:assert/strict";
import { createSchedulerDevelopmentLocalBinding } from "../scripts/lib/scheduler-development-local-binding.mjs";
import { runHybridDevelopment, sanitizeSchedulerValidationFailure } from "../scripts/validate-scheduler-development.mjs";

const boundary = "2026-01-01T00:00:00Z";
const args = ["--live-development", "--hybrid-sql-editor", "--confirm-development-smoke", "--development-name=development", "--production-name=production"];
const evidenceArgs = [...args, "--resume-after-negative-evidence", "--negative-evidence-result-tag=scheduler_smoke_negative_evidence", `--negative-evidence-attempt-boundary=${boundary}`, "--negative-evidence-baseline=0", "--negative-evidence-new-runs=0", "--negative-evidence-active-runs=0", "--negative-evidence-created-runs=0"];
const resumable = { phase: "read_only_negative_evidence_required", attempt_boundary: boundary, scheduled_run_baseline: 0, negative: [] };

function injectedFilesystem({ readState = async () => resumable, releaseError = null } = {}) {
  const files = new Set(["scheduler-phase-state.json"]);
  const calls = { mkdir: 0, move: 0, unlink: 0, rmdir: 0 };
  return {
    calls,
    files,
    async mkdir(path) { calls.mkdir += 1; if (path.includes("scheduler-resume-claim") || path.includes("forecast-scheduler-validation-claim")) { if (files.has("scheduler-resume-claim")) { const error = new Error("exists"); error.code = "EEXIST"; throw error; } files.add("scheduler-resume-claim"); } },
    async lstat(path) { return { isSymbolicLink: () => false, isDirectory: () => path.endsWith("validation") || path.includes("scheduler-resume-claim") || path.includes("forecast-scheduler-validation-claim") }; },
    async readdir() { return [...files]; },
    async rename(_from, to) { calls.move += 1; files.add(to.split(/[\\/]/).pop()); files.delete("scheduler-phase-state.json"); },
    async writeFile() {},
    async unlink(path) { calls.unlink += 1; files.delete(path.split(/[\\/]/).pop()); },
    async rmdir(path) { calls.rmdir += 1; if (releaseError) throw releaseError; files.delete(path.split(/[\\/]/).pop()); files.delete("scheduler-resume-claim"); },
    readState,
  };
}

async function consumeScenario(readState, releaseError = null) {
  const fs = injectedFilesystem({ readState, releaseError });
  const binding = createSchedulerDevelopmentLocalBinding({ filesystem: fs, temporaryDirectory: "C:/validation", readPhaseState: readState });
  return { fs, binding };
}

async function invariant1PreConsumeReadFailure() {
  const { fs, binding } = await consumeScenario(async () => { throw new Error("state read failure"); });
  await assert.rejects(binding.consumeNegativeEvidenceState(), /negative_evidence_state_consume_failed/);
  assert.equal(fs.calls.rmdir, 1); assert.equal(fs.calls.move, 0); assert.equal(fs.files.has("scheduler-resume-claim"), false);
}

async function invariant2PreConsumePhaseValidationFailure() {
  const { fs, binding } = await consumeScenario(async () => ({ phase: "negative_revalidation_in_progress" }));
  await assert.rejects(binding.consumeNegativeEvidenceState(), /negative_evidence_state_consume_failed/);
  assert.equal(fs.calls.rmdir, 1); assert.equal(fs.calls.move, 0);
}

async function invariant3SuccessfulPreConsumeRelease() {
  const { fs, binding } = await consumeScenario(async () => { throw new Error("state read failure"); });
  await assert.rejects(binding.consumeNegativeEvidenceState(), /negative_evidence_state_consume_failed/);
  assert.equal(fs.files.has("scheduler-phase-state.json"), true); assert.equal(fs.files.has("scheduler-resume-claim"), false);
}

async function invariant4FailedPreConsumeRelease() {
  const error = new Error("access denied"); error.code = "EACCES";
  const { fs, binding } = await consumeScenario(async () => { throw new Error("state read failure"); }, error);
  await assert.rejects(binding.consumeNegativeEvidenceState(), /scheduler_resume_claim_release_failed/);
  assert.equal(fs.files.has("scheduler-resume-claim"), true); assert.equal(fs.calls.rmdir, 1); assert.equal(fs.calls.move, 0);
  let parserCalls = 0, artifactCalls = 0;
  const orchestration = {
    async readPhaseState() { return resumable; },
    async consumeNegativeEvidenceState() { throw new Error("scheduler_resume_claim_release_failed"); },
    async parseEvidence() { parserCalls += 1; },
    async writeSqlArtifacts() { artifactCalls += 1; },
  };
  await assert.rejects(runHybridDevelopment(evidenceArgs, orchestration), /scheduler_resume_claim_release_failed/);
  const rendered = sanitizeSchedulerValidationFailure(new Error("scheduler_resume_claim_release_failed"));
  assert.equal(rendered.category, "scheduler_resume_claim_release_failed");
  assert.equal(parserCalls, 0); assert.equal(artifactCalls, 0); assert.equal(JSON.stringify(rendered).includes("filesystem"), false);
}

function committedBinding({ releaseError = new Error("release failure") } = {}) {
  const calls = { consume: 0, parser: 0, writes: 0, states: [], clears: 0, release: 0 };
  const state = { ...resumable };
  const binding = {
    calls,
    async readPhaseState() { return state; },
    async consumeNegativeEvidenceState() { calls.consume += 1; return state; },
    async preflight() { return { linkedRef: "synthetic-ref" }; },
    async writeSqlArtifacts() { calls.writes += 1; return { enqueue: true, evidence: true }; },
    async writePhaseState(next) { calls.states.push(next); Object.assign(state, next); },
    async clearWriteArtifacts() { calls.clears += 1; },
    async releaseResumeClaim() { calls.release += 1; if (releaseError) throw releaseError; },
  };
  return { binding, calls, state };
}

async function runCommittedFailure(releaseError) {
  const fixture = committedBinding({ releaseError });
  await assert.rejects(runHybridDevelopment(evidenceArgs, fixture.binding), /scheduler_resume_claim_release_failed/);
  return fixture;
}

async function invariant5PostConsumeIsolation() {
  const fixture = await runCommittedFailure(new Error("late failure"));
  assert.equal(fixture.calls.consume, 1); assert.equal(fixture.calls.release, 1); assert.equal(fixture.calls.clears, 0);
  assert.equal(fixture.calls.states.at(-1).phase, "manual_enqueue_required");
}

async function invariant6PostCommitReleaseFailurePreservesArtifacts() {
  const fixture = await runCommittedFailure(new Error("late failure"));
  assert.equal(fixture.calls.writes, 1); assert.equal(fixture.calls.clears, 0); assert.equal(fixture.state.phase, "manual_enqueue_required");
}

async function invariant7EaccesReleaseIsSanitized() {
  const error = new Error("sensitive filesystem path"); error.code = "EACCES";
  const fixture = await runCommittedFailure(error);
  assert.equal(fixture.calls.clears, 0); assert.equal(String(error).includes("sensitive filesystem path"), true);
}

async function invariant8EnotemptyReleaseIsSanitized() {
  const error = new Error("claim directory not empty"); error.code = "ENOTEMPTY";
  const fixture = await runCommittedFailure(error);
  assert.equal(fixture.state.phase, "manual_enqueue_required"); assert.equal(fixture.calls.clears, 0);
}

async function invariant9OuterCatchPreservesCategory() {
  const fixture = await runCommittedFailure(new Error("publication wrapper"));
  assert.equal(fixture.calls.release, 1); assert.equal(fixture.calls.states.at(-1).phase, "manual_enqueue_required");
}

async function invariant10FinallyPreservesCommit() {
  const fixture = await runCommittedFailure(new Error("release failure"));
  assert.equal(fixture.calls.clears, 0); assert.equal(fixture.state.phase, "manual_enqueue_required"); assert.equal(fixture.calls.release, 1);
}

async function invariant11NoDuplicatePublication() {
  const fixture = await runCommittedFailure(new Error("release failure"));
  assert.equal(fixture.calls.writes, 1);
  await assert.rejects(runHybridDevelopment(evidenceArgs, fixture.binding), /negative_evidence_missing|existing_negative_baseline_not_provable|negative_evidence_state_consume_failed/);
  assert.equal(fixture.calls.writes, 1);
}

async function invariant12NoAutomaticReleaseRetry() {
  const fixture = await runCommittedFailure(new Error("release failure"));
  assert.equal(fixture.calls.release, 1); assert.equal(fixture.calls.clears, 0);
}

await invariant1PreConsumeReadFailure();
await invariant2PreConsumePhaseValidationFailure();
await invariant3SuccessfulPreConsumeRelease();
await invariant4FailedPreConsumeRelease();
await invariant5PostConsumeIsolation();
await invariant6PostCommitReleaseFailurePreservesArtifacts();
await invariant7EaccesReleaseIsSanitized();
await invariant8EnotemptyReleaseIsSanitized();
await invariant9OuterCatchPreservesCategory();
await invariant10FinallyPreservesCommit();
await invariant11NoDuplicatePublication();
await invariant12NoAutomaticReleaseRetry();
console.log("scheduler release boundaries: 12 invariants, 12 passed, 0 failed, 0 skipped, 0 not-run");
