import assert from "node:assert/strict";
import { runHybridDevelopment } from "../scripts/validate-scheduler-development.mjs";

const common = ["--live-development", "--hybrid-sql-editor", "--confirm-development-smoke", "--development-name=development", "--production-name=production"];
const resumeArgs = [...common, "--resume-after-manual-preflight", "--attempt-boundary=2026-01-01T00:00:00Z", "--scheduled-run-baseline=0"];
const baseArgs = common;
let releaseBarrier;
let releaseBarrierResolve;
let negativeStartedResolve;
const negativeStarted = new Promise((resolve) => { negativeStartedResolve = resolve; });
const calls = { claims: 0, releases: 0, reads: 0, clears: 0, writes: 0, negatives: 0 };
let claimed = false;
let phase = { phase: "read_only_preflight_required" };
const binding = {
  async acquireResumeClaim() { calls.claims += 1; if (claimed) throw new Error("scheduler_resume_claim_active"); claimed = true; },
  async releaseResumeClaim() { calls.releases += 1; claimed = false; },
  async readPhaseState() { calls.reads += 1; return phase; },
  async preflight() { return { endpoint: "synthetic" }; },
  async clearWriteArtifacts() { calls.clears += 1; },
  async runNegativeCases(_endpoint, save) {
    calls.negatives += 1; negativeStartedResolve();
    releaseBarrier = new Promise((resolve) => { releaseBarrierResolve = resolve; });
    await releaseBarrier;
    await save([], undefined);
    return [];
  },
  async writeNegativeEvidenceArtifact() {},
  async writePhaseState(next) { calls.writes += 1; phase = next; },
  async prepareAttempt() { await this.acquireResumeClaim(); },
};

const resume = runHybridDevelopment(resumeArgs, binding);
await negativeStarted;
const writesBeforeBase = calls.writes;
await assert.rejects(runHybridDevelopment(baseArgs, binding), /scheduler_resume_claim_active/);
assert.equal(calls.writes, writesBeforeBase);
assert.equal(calls.clears, 1);
assert.equal(calls.negatives, 1);
releaseBarrierResolve();
const result = await resume;
assert.equal(result.phase, "read_only_negative_evidence_required");
assert.equal(calls.claims, 2);
assert.equal(calls.releases, 1);
assert.equal(claimed, false);
assert.equal(calls.writes, 2);
console.log("scheduler resume-after-preflight concurrency: 1 fixture, 1 passed, 0 failed, 0 skipped, 0 not-run");
