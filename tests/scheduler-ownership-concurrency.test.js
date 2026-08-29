import assert from "node:assert/strict";
import { runHybridDevelopment } from "../scripts/validate-scheduler-development.mjs";

const common = ["--live-development", "--hybrid-sql-editor", "--confirm-development-smoke", "--development-name=development", "--production-name=production"];
const finalArgs = [...common, "--resume-after-manual-enqueue", "--enqueue-committed=true", "--evidence-result-tag=scheduler_smoke_evidence", "--evidence-run-category=one_terminal_scheduled_run", "--new-scheduled-runs=1", "--terminal-scheduled-runs=1", "--running-scheduled-runs=0", "--terminal-status=succeeded", "--locations-total=1", "--locations-succeeded=1", "--locations-failed=0", "--snapshots-created=1", "--duplicate-identity-count=0", "--unexpected-active-scheduled-runs=0", "--counter-invariant=true"];

function sharedClaim() {
  let held = false;
  return {
    async acquire() { if (held) throw new Error("scheduler_resume_claim_active"); held = true; },
    async release() { held = false; },
    get held() { return held; },
  };
}

function baseBinding(claim, calls, hooks = {}) {
  return {
    async prepareAttempt() { await claim.acquire(); calls.deletes += 1; },
    async preflight() { calls.preflight += 1; if (hooks.preflight) await hooks.preflight(); return { endpoint: "mocked" }; },
    async writePreflightArtifact() { calls.artifactWrites += 1; if (hooks.artifact) await hooks.artifact(); },
    async writePhaseState(state) { calls.stateWrites += 1; calls.phase = state; },
    async clearAttemptArtifacts() { calls.cleanup += 1; calls.artifactExists = false; },
    async releaseResumeClaim() { calls.release += 1; await claim.release(); },
  };
}

const firstClaim = sharedClaim();
const firstCalls = { deletes: 0, preflight: 0, artifactWrites: 0, stateWrites: 0, cleanup: 0, release: 0, artifactExists: true };
let artifactWritten;
let continuePublication;
const artifactPause = new Promise((resolve) => { artifactWritten = resolve; });
const publicationGate = new Promise((resolve) => { continuePublication = resolve; });
const first = runHybridDevelopment(common, baseBinding(firstClaim, firstCalls, { artifact: async () => { artifactWritten(); await publicationGate; } }));
await artifactPause;
const secondCalls = { deletes: 0, preflight: 0, artifactWrites: 0, stateWrites: 0, cleanup: 0, release: 0, artifactExists: true };
await assert.rejects(runHybridDevelopment(common, baseBinding(firstClaim, secondCalls)), /scheduler_resume_claim_active/);
assert.equal(secondCalls.deletes, 0);
assert.equal(secondCalls.stateWrites, 0);
continuePublication();
await first;
assert.equal(firstCalls.phase.phase, "read_only_preflight_required");
assert.equal(firstCalls.artifactExists, true);
assert.equal(firstCalls.release, 1);
assert.equal(firstClaim.held, false);

const preflightClaim = sharedClaim();
const preflightCalls = { deletes: 0, preflight: 0, artifactWrites: 0, stateWrites: 0, cleanup: 0, release: 0, artifactExists: true };
await assert.rejects(runHybridDevelopment(common, baseBinding(preflightClaim, preflightCalls, { preflight: async () => { throw new Error("mocked_failure"); } })), /mocked_failure/);
assert.deepEqual([preflightCalls.deletes, preflightCalls.cleanup, preflightCalls.release], [1, 1, 1]);
assert.equal(preflightCalls.stateWrites, 0);

const publishClaim = sharedClaim();
const publishCalls = { deletes: 0, preflight: 0, artifactWrites: 0, stateWrites: 0, cleanup: 0, release: 0, artifactExists: true };
const writeFail = baseBinding(publishClaim, publishCalls);
writeFail.writePhaseState = async () => { publishCalls.stateWrites += 1; throw new Error("mocked_state_failure"); };
await assert.rejects(runHybridDevelopment(common, writeFail), /mocked_state_failure/);
assert.deepEqual([publishCalls.artifactWrites, publishCalls.cleanup, publishCalls.release], [1, 1, 1]);
assert.equal(publishCalls.artifactExists, false);

function finalBinding(claim, calls, hooks = {}) {
  return {
    async acquireResumeClaim() { calls.claims += 1; await claim.acquire(); },
    async releaseResumeClaim() { calls.releases += 1; if (hooks.release) await hooks.release(); else await claim.release(); },
    async readPhaseState() { calls.reads += 1; if (hooks.read) await hooks.read(); return { phase: "manual_enqueue_required", attempt_boundary: "2026-01-01T00:00:00Z", scheduled_run_baseline: 0 }; },
    async clearAttemptArtifacts() { calls.deletes += 1; },
    async writePhaseState() { calls.writes += 1; },
  };
}

const finalClaim = sharedClaim();
const finalCalls = { claims: 0, releases: 0, reads: 0, deletes: 0, writes: 0 };
let finalRead;
let continueFinal;
const finalPause = new Promise((resolve) => { finalRead = resolve; });
const finalGate = new Promise((resolve) => { continueFinal = resolve; });
const final = runHybridDevelopment(finalArgs, finalBinding(finalClaim, finalCalls, { read: async () => { finalRead(); await finalGate; } }));
await finalPause;
const blockedBase = { deletes: 0, preflight: 0, artifactWrites: 0, stateWrites: 0, cleanup: 0, release: 0, artifactExists: true };
await assert.rejects(runHybridDevelopment(common, baseBinding(finalClaim, blockedBase)), /scheduler_resume_claim_active/);
assert.equal(blockedBase.deletes, 0);
continueFinal();
await final;
assert.deepEqual([finalCalls.reads, finalCalls.deletes, finalCalls.writes, finalCalls.releases], [1, 1, 1, 1]);

const staleClaim = sharedClaim();
await staleClaim.acquire();
const staleCalls = { claims: 0, releases: 0, reads: 0, deletes: 0, writes: 0 };
await assert.rejects(runHybridDevelopment(finalArgs, finalBinding(staleClaim, staleCalls)), /scheduler_resume_claim_active/);
assert.deepEqual([staleCalls.reads, staleCalls.deletes, staleCalls.writes], [0, 0, 0]);

const doubleClaim = sharedClaim();
const winnerCalls = { claims: 0, releases: 0, reads: 0, deletes: 0, writes: 0 };
let winnerRead;
let continueWinner;
const winnerPause = new Promise((resolve) => { winnerRead = resolve; });
const winnerGate = new Promise((resolve) => { continueWinner = resolve; });
const winner = runHybridDevelopment(finalArgs, finalBinding(doubleClaim, winnerCalls, { read: async () => { winnerRead(); await winnerGate; } }));
await winnerPause;
const loserCalls = { claims: 0, releases: 0, reads: 0, deletes: 0, writes: 0 };
await assert.rejects(runHybridDevelopment(finalArgs, finalBinding(doubleClaim, loserCalls)), /scheduler_resume_claim_active/);
assert.deepEqual([loserCalls.reads, loserCalls.deletes, loserCalls.writes], [0, 0, 0]);
continueWinner();
await winner;

const releaseClaim = sharedClaim();
const releaseCalls = { claims: 0, releases: 0, reads: 0, deletes: 0, writes: 0 };
await assert.rejects(runHybridDevelopment(finalArgs.map((arg) => arg.replace("--new-scheduled-runs=1", "--new-scheduled-runs=0")), finalBinding(releaseClaim, releaseCalls, { release: async () => { throw new Error("scheduler_resume_claim_release_failed"); } })), /scheduler_resume_claim_release_failed/);
assert.deepEqual([releaseCalls.reads, releaseCalls.deletes, releaseCalls.writes, releaseCalls.releases], [1, 1, 1, 1]);
console.log("scheduler ownership concurrency: 7 fixtures, 7 passed, 0 failed, 0 skipped, 0 not-run");
