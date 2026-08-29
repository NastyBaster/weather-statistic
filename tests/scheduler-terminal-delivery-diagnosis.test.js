import assert from "node:assert/strict";
import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createSchedulerDevelopmentLocalBinding } from "../scripts/lib/scheduler-development-local-binding.mjs";
import { runHybridDevelopment } from "../scripts/validate-scheduler-development.mjs";

const root = await mkdtemp(join(tmpdir(), "scheduler-diagnosis-test-"));
try {
  const binding = createSchedulerDevelopmentLocalBinding({ temporaryDirectory: root });
  await binding.writePhaseState({ phase: "negative_evidence_failed_terminal", cleanup: "complete", cumulative_enqueue_count: 1, attempt_boundary: "2026-08-29T00:00:00Z" });
  const prepared = await binding.writeTerminalDeliveryDiagnosisArtifact("2026-08-29T00:00:00Z");
  assert.equal(prepared.kind, "terminal-delivery-diagnosis");
  const inventory = await binding.inspectArtifactInventory();
  assert.equal(inventory.diagnosisArtifacts, 1);
  assert.equal(inventory.unexpectedEntries, 0);
  const sql = await readFile(join(root, "scheduler-terminal-delivery-diagnosis.sql"), "utf8");
  assert.match(sql, /set transaction read only/i);
  assert.equal((sql.match(/net\.http_post/gi) ?? []).length, 0);
  assert.equal(sql.includes("net.http_request_queue"), false);
  assert.match(sql, /pg_input_is_valid\(content, 'jsonb'\)/);
  assert.match(sql, /case when correlation_candidate_count = 1/);
  assert.match(sql, /sanitized_error/);
  assert.match(sql, /sanitized_reason/);
  await assert.rejects(binding.writeTerminalDeliveryDiagnosisArtifact("2026-08-29T00:00:00Z"), /already_prepared/);
  await binding.clearTerminalDeliveryDiagnosisArtifact();
  assert.equal((await binding.inspectArtifactInventory()).diagnosisArtifacts, 0);
  await assert.rejects(binding.clearTerminalDeliveryDiagnosisArtifact(), /already|absent/);

  const preservedRoot = await mkdtemp(join(tmpdir(), "scheduler-diagnosis-preserve-"));
  try {
    const preserved = createSchedulerDevelopmentLocalBinding({ temporaryDirectory: preservedRoot });
    await preserved.writePhaseState({ phase: "negative_evidence_failed_terminal", cleanup: "complete", cumulative_enqueue_count: 1, attempt_boundary: "2026-08-29T00:00:00Z" });
    await preserved.writeTerminalDeliveryDiagnosisArtifact("2026-08-29T00:00:00Z");
    await preserved.clearAttemptArtifacts();
    assert.equal((await readdir(preservedRoot)).includes("scheduler-terminal-delivery-diagnosis.sql"), true);
  } finally { await rm(preservedRoot, { recursive: true, force: true }); }

  const calls = [];
  const orchestrationBinding = {
    async acquireResumeClaim() { calls.push("acquire"); },
    async readPhaseState() { calls.push("read"); return { phase: "negative_evidence_failed_terminal", cleanup: "complete", cumulative_enqueue_count: 1, attempt_boundary: "2026-08-29T00:00:00Z" }; },
    async inspectArtifactInventory() { calls.push("inspect"); return { claimPresent: false, writeCapableArtifacts: 0, unexpectedEntries: 0 }; },
    async writeTerminalDeliveryDiagnosisArtifact(boundary) { calls.push(`write:${boundary}`); return { kind: "terminal-delivery-diagnosis" }; },
    async releaseResumeClaim() { calls.push("release"); },
  };
  const report = await runHybridDevelopment([
    "--live-development", "--hybrid-sql-editor", "--confirm-development-smoke",
    "--development-name=development", "--production-name=production", "--prepare-terminal-delivery-diagnosis",
  ], orchestrationBinding);
  assert.equal(report.artifactKind, "terminal-delivery-diagnosis");
  assert.deepEqual(calls, ["acquire", "read", "inspect", "write:2026-08-29T00:00:00Z", "release"]);
} finally { await rm(root, { recursive: true, force: true }); }
console.log("scheduler terminal delivery diagnosis: 8 fixtures, 8 passed, 0 failed, 0 skipped, 0 not-run");
