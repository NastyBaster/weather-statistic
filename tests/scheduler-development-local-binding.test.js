import assert from "node:assert/strict";
import {
  assertResumeInput,
  createSchedulerDevelopmentLocalBinding,
  parseCliJsonEnvelope,
  sanitizePhaseState,
} from "../scripts/lib/scheduler-development-local-binding.mjs";
import { buildEnqueueSql, buildEvidenceSql, buildPreflightSql } from "../scripts/lib/scheduler-smoke-artifacts.mjs";
import { runHybridDevelopment } from "../scripts/validate-scheduler-development.mjs";

const ref = "synthetic-development";
const projects = JSON.stringify({ projects: [{ name: "development", ref }, { name: "production", ref: "synthetic-production" }] });
const functions = JSON.stringify({ functions: [{ name: "collect-forecasts" }] });
const secrets = JSON.stringify({ secrets: [{ name: "FORECAST_SCHEDULER_TOKEN" }] });
const migrations = JSON.stringify({ migrations: Array.from({ length: 6 }, () => ({ local: true, remote: true })) });
const fixtureRunner = async (args) => {
  if (args[0] === "projects") return projects;
  if (args[0] === "functions") return functions;
  if (args[0] === "secrets") return secrets;
  if (args[0] === "migration") return migrations;
  throw new Error("unexpected_cli_command");
};
const files = {
  created: [],
  async mkdir() {},
  async writeFile(path, content) { this.created.push([path, content]); },
  async rename() {},
  async rm() { this.cleaned = true; },
};
const responses = [405, 401, 401, 401].map((status) => new Response(JSON.stringify({ error: status === 405 ? "method_not_allowed" : "unauthorized" }), { status }));
const binding = createSchedulerDevelopmentLocalBinding({
  runCli: fixtureRunner,
  readLinkedRef: async () => ref,
  repositoryClean: async () => true,
  fetchImpl: async () => responses.shift(),
  filesystem: files,
  temporaryDirectory: "synthetic-temp",
});

assert.deepEqual(parseCliJsonEnvelope('{"ok":true}'), { ok: true });
assert.throws(() => parseCliJsonEnvelope("not-json"), /cli_json_malformed/);
const preflight = await binding.preflight({ expectedDevelopment: "development", expectedProduction: "production" });
assert.equal(preflight.target, "verified");
assert.equal(preflight.migrations, "6/6/0/0");
const saved = [];
const negative = await binding.runNegativeCases(preflight.endpoint, async (records) => saved.push(records));
assert.equal(negative.length, 4);
assert.equal(saved.length, 8);
assert.equal(saved[0].length, 0);
assert.equal(saved[1].length, 1);
assert.equal(saved[7].length, 4);
assert.deepEqual(saved[1][0], negative[0]);
await binding.writePreflightArtifact();
await binding.writeSqlArtifacts(ref, "2026-01-01T00:00:00Z", 0);
assert.equal(files.created.length, 3);
const enqueue = files.created[1][1];
assert.equal((enqueue.match(/select net\.http_post\(/g) ?? []).length, 1);
assert.match(enqueue, /vault\.decrypted_secrets/);
assert.match(enqueue, /commit;/);
assert.doesNotMatch(enqueue, /select\s+decrypted_secret\s*;/i);
assert.doesNotMatch(enqueue, /request_id\s*;/i);
const evidence = files.created[2][1];
assert.match(evidence, /set transaction read only;/i);
assert.match(evidence, /rollback;/i);
assert.doesNotMatch(evidence, /error_message|uuid|request_id/i);
assert.deepEqual(assertResumeInput({ enqueueCommitted: true, evidence: { newScheduledRuns: 1, duplicateIdentityCount: 0, counterInvariant: true } }).phase, "complete");
assert.throws(() => assertResumeInput({ enqueueCommitted: false }), /manual_enqueue_confirmation_required/);
assert.deepEqual(sanitizePhaseState({ phase: "x", linkedRef: ref, endpoint: "sensitive", cleanup: "yes" }), { phase: "x", cleanup: "yes" });

let entrypointCalled = false;
let persistedState;
const entrypoint = {
  async preflight() { entrypointCalled = true; return { linkedRef: ref, endpoint: "synthetic", target: "verified", migrations: "6/6/0/0" }; },
  async runNegativeCases() { return negative; },
  async writePreflightArtifact() { return {}; },
  async writeSqlArtifacts() { return {}; },
  async writePhaseState(state) { persistedState = state; },
  async readPhaseState() { return persistedState; },
  async cleanupArtifacts() { entrypoint.cleaned = true; },
};
const phaseA = await runHybridDevelopment([
  "--live-development", "--hybrid-sql-editor", "--confirm-development-smoke",
  "--development-name=development", "--production-name=production",
], entrypoint);
assert.equal(entrypointCalled, true);
assert.equal(phaseA.phase, "read_only_preflight_required");
persistedState = phaseA;
const afterManualPreflight = await runHybridDevelopment([
  "--live-development", "--hybrid-sql-editor", "--confirm-development-smoke", "--resume-after-manual-preflight",
  "--development-name=development", "--production-name=production", "--attempt-boundary=2026-01-01T00:00:00Z", "--scheduled-run-baseline=0",
], entrypoint);
assert.equal(afterManualPreflight.phase, "manual_enqueue_required");
assert.equal(afterManualPreflight.negative.length, 4);
const progressStates = [];
const interruptedBinding = {
  ...entrypoint,
  async readPhaseState() { return { phase: "read_only_preflight_required" }; },
  async runNegativeCases(_endpoint, save) {
    await save([negative[0]], "post_no_auth");
    throw new Error("negative_request_submission_failed");
  },
  async writePhaseState(state) { progressStates.push(state); },
};
await assert.rejects(runHybridDevelopment([
  "--live-development", "--hybrid-sql-editor", "--confirm-development-smoke", "--resume-after-manual-preflight",
  "--development-name=development", "--production-name=production", "--attempt-boundary=2026-01-01T00:00:00Z", "--scheduled-run-baseline=0",
], interruptedBinding), /negative_request_submission_failed/);
assert.equal(progressStates[0].phase, "negative_request_in_flight");
assert.equal(progressStates[0].negative.length, 1);
persistedState = { phase: "manual_enqueue_required", manual_enqueue_required: true, attempt_boundary: "2026-01-01T00:00:00Z", scheduled_run_baseline: 0 };
const resumed = await runHybridDevelopment([
  "--live-development", "--hybrid-sql-editor", "--confirm-development-smoke", "--resume-after-manual-enqueue",
  "--development-name=development", "--production-name=production", "--enqueue-committed=true",
  "--evidence-result-tag=scheduler_smoke_evidence", "--evidence-run-category=one_terminal_scheduled_run",
  "--new-scheduled-runs=1", "--terminal-scheduled-runs=1", "--running-scheduled-runs=0", "--terminal-status=succeeded",
  "--locations-total=0", "--locations-succeeded=0", "--locations-failed=0", "--snapshots-created=0",
  "--duplicate-identity-count=0", "--unexpected-active-scheduled-runs=0", "--counter-invariant=true",
], entrypoint);
assert.equal(resumed.phase, "complete");
assert.equal(entrypoint.cleaned, true);
await assert.rejects(runHybridDevelopment([
  "--live-development", "--hybrid-sql-editor", "--confirm-development-smoke", "--resume-after-manual-enqueue",
  "--development-name=development", "--production-name=production", "--enqueue-committed=true",
  "--evidence-result-tag=scheduler_smoke_evidence", "--evidence-run-category=no_new_scheduled_run",
  "--new-scheduled-runs=0", "--terminal-scheduled-runs=0", "--running-scheduled-runs=0", "--terminal-status=none",
  "--locations-total=0", "--locations-succeeded=0", "--locations-failed=0", "--snapshots-created=0",
  "--duplicate-identity-count=0", "--unexpected-active-scheduled-runs=0", "--counter-invariant=true",
], { ...entrypoint, readPhaseState: async () => ({ phase: "manual_enqueue_required", attempt_boundary: "2026-01-01T00:00:00Z", scheduled_run_baseline: 0 }) }), /manual_evidence_rejected/);
assert.throws(() => buildEnqueueSql("invalid value", "2026-01-01T00:00:00Z", 0), /linked_reference_invalid/);
assert.match(buildEvidenceSql("2026-01-01T00:00:00Z"), /read only/i);
assert.match(buildPreflightSql(), /read only/i);
await binding.cleanupArtifacts();
assert.equal(files.cleaned, true);

async function expectPreflight(category, overrides = {}) {
  const candidate = createSchedulerDevelopmentLocalBinding({
    runCli: async (args) => {
      if (args[0] === "projects") return overrides.projects ?? projects;
      if (args[0] === "functions") return overrides.functions ?? functions;
      if (args[0] === "secrets") return overrides.secrets ?? secrets;
      return overrides.migrations ?? migrations;
    },
    readLinkedRef: async () => overrides.linkedRef ?? ref,
    repositoryClean: async () => overrides.clean ?? true,
  });
  await assert.rejects(candidate.preflight({ expectedDevelopment: "development", expectedProduction: "production" }), new RegExp(category));
}

await expectPreflight("target_verification_failed", { projects: JSON.stringify({ projects: [] }) });
await expectPreflight("target_verification_failed", { projects: JSON.stringify({ projects: [{ name: "development", ref }, { name: "development", ref: "another" }] }) });
await expectPreflight("target_verification_failed", { linkedRef: "other" });
await expectPreflight("production_target_refused", { projects: JSON.stringify({ projects: [{ name: "development", ref }, { name: "production", ref }] }) });
await expectPreflight("migration_state_mismatch", { migrations: JSON.stringify({ migrations: [{ local: true, remote: true }] }) });
await expectPreflight("function_missing", { functions: JSON.stringify({ functions: [] }) });
await expectPreflight("edge_secret_missing", { secrets: JSON.stringify({ secrets: [] }) });
await expectPreflight("repository_not_clean", { clean: false });
await expectPreflight("cli_json_malformed", { projects: "not-json" });
const redirectBinding = createSchedulerDevelopmentLocalBinding({
  fetchImpl: async () => ({ redirected: true, status: 405, json: async () => ({ error: "method_not_allowed" }) }),
});
await assert.rejects(redirectBinding.runNegativeCases("synthetic"), /negative_response_unexpected/);
const unavailableBinding = createSchedulerDevelopmentLocalBinding({ fetchImpl: undefined });
await assert.rejects(unavailableBinding.runNegativeCases("synthetic"), /local_http_client_unavailable/);
assert.equal((buildEnqueueSql(ref, "2026-01-01T00:00:00Z", 0).match(/retry/gi) ?? []).length, 0);
console.log("scheduler local binding: 30 fixtures, 0 failed, 0 skipped, 0 not-run");
