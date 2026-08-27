import { spawn } from "node:child_process";
import { lstat, mkdir, readdir, readFile, rename, rm, rmdir, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  buildEnqueueSql as buildGuardedEnqueueSql,
  buildEvidenceSql as buildBoundEvidenceSql,
  buildPreflightSql,
  buildNegativeEvidenceSql,
  requireAttemptBoundary,
  requireBaseline,
} from "./scheduler-smoke-artifacts.mjs";

const FUNCTION_NAME = "collect-forecasts";
const EDGE_SECRET_NAME = "FORECAST_SCHEDULER_TOKEN";
const VAULT_SECRET_NAME = "forecast_scheduler_token";
const SAFE_NEGATIVE_CATEGORIES = new Map([[405, "method_not_allowed"], [401, "unauthorized"]]);
const METADATA_PHASES = Object.freeze([
  "target_metadata_lookup",
  "function_metadata_check",
  "edge_secret_name_metadata_check",
  "migration_metadata_check",
]);
const METADATA_PHASE_SET = new Set(METADATA_PHASES);
const EXIT_CATEGORIES = new Set(["zero", "nonzero", "timeout", "spawn_failed", "not_attempted"]);
const STDOUT_SHAPES = new Set(["empty", "json", "text", "unknown"]);
const STDERR_CATEGORIES = new Set(["empty", "sanitized_error_present"]);
const PARSER_CATEGORIES = new Set(["parsed", "empty", "unsupported_shape", "ambiguous", "not_attempted"]);

const fail = (category) => {
  throw new Error(category);
};

export const schedulerCliMetadataPhases = () => [...METADATA_PHASES];

function metadataRecord(phase, fields = {}) {
  if (!METADATA_PHASE_SET.has(phase)) fail("metadata_phase_unknown");
  const record = {
    phase,
    attempted: false,
    completed: false,
    exitCategory: "not_attempted",
    stdoutShape: "unknown",
    stderrCategory: "empty",
    parserCategory: "not_attempted",
    outcomeCategory: "not_attempted",
    ...fields,
  };
  if (!EXIT_CATEGORIES.has(record.exitCategory) || !STDOUT_SHAPES.has(record.stdoutShape)
    || !STDERR_CATEGORIES.has(record.stderrCategory) || !PARSER_CATEGORIES.has(record.parserCategory)) {
    fail("metadata_phase_record_invalid");
  }
  return Object.freeze(record);
}

export function createSchedulerMetadataPhaseRecords() {
  return Object.freeze(METADATA_PHASES.map((phase) => metadataRecord(phase)));
}

export function createSchedulerMetadataPhaseRecord(phase) {
  return metadataRecord(phase);
}

export class SchedulerMetadataPhaseFailure extends Error {
  constructor(category, phase, records) {
    const knownPhase = METADATA_PHASE_SET.has(phase);
    super(knownPhase ? category : "metadata_phase_unknown");
    this.name = "SchedulerMetadataPhaseFailure";
    this.category = knownPhase ? category : "metadata_phase_unknown";
    this.phase = knownPhase ? phase : undefined;
    this.records = Object.freeze(records.map((record) => Object.freeze({ ...record })));
  }
}

function cliFailureExitCategory(error) {
  if (error?.message === "cli_timeout") return "timeout";
  if (error?.message === "cli_unavailable") return "spawn_failed";
  return "nonzero";
}

function stdoutShape(stdout) {
  if (typeof stdout !== "string") return "unknown";
  if (stdout.trim() === "") return "empty";
  try {
    const parsed = JSON.parse(stdout);
    return parsed !== null && typeof parsed === "object" ? "json" : "text";
  } catch {
    return "text";
  }
}

export function parseCliJsonEnvelope(stdout) {
  try {
    const parsed = JSON.parse(stdout);
    if (parsed === null || typeof parsed !== "object") fail("cli_json_malformed");
    return parsed;
  } catch (error) {
    if (error.message === "cli_json_malformed") throw error;
    fail("cli_json_malformed");
  }
}

export function immutableNegativeRecords(records) {
  return records.map((record) => Object.freeze({
    label: record.label,
    status: record.status,
    category: record.category,
    reachedEndpoint: record.reachedEndpoint,
  }));
}

export function sanitizePhaseState(state) {
  const allowed = ["phase", "negative", "manual_enqueue_required", "resume_ready", "cleanup", "attempt_boundary", "scheduled_run_baseline", "negative_evidence_required", "negative_evidence_passed", "negative_evidence_failure"];
  const output = {};
  for (const key of allowed) if (key in state) output[key] = state[key];
  return JSON.parse(JSON.stringify(output));
}

export function assertResumeInput(input) {
  if (input?.enqueueCommitted !== true) fail("manual_enqueue_confirmation_required");
  const evidence = input?.evidence;
  if (!evidence || !Number.isInteger(evidence.newScheduledRuns) || !Number.isInteger(evidence.duplicateIdentityCount)) {
    fail("manual_evidence_invalid");
  }
  if (evidence.newScheduledRuns > 1 || evidence.duplicateIdentityCount !== 0 || evidence.counterInvariant !== true) {
    fail("manual_evidence_rejected");
  }
  return { phase: "complete", resume_ready: true, cleanup: "required" };
}

export function createSubprocessRunner({ executable = "supabase", timeoutMs = 30_000 } = {}) {
  return (args) => new Promise((resolve, reject) => {
    const child = spawn(executable, args, { stdio: ["ignore", "pipe", "pipe"], windowsHide: true });
    let stdout = "";
    let stderr = "";
    let settled = false;
    const rejectSanitized = (category) => {
      if (settled) return;
      settled = true;
      const error = new Error(category);
      error.stderrCategory = stderr === "" ? "empty" : "sanitized_error_present";
      reject(error);
    };
    const timeout = setTimeout(() => {
      child.kill();
      rejectSanitized("cli_timeout");
    }, timeoutMs);
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.on("error", () => { clearTimeout(timeout); rejectSanitized("cli_unavailable"); });
    child.on("close", (code) => {
      clearTimeout(timeout);
      if (settled) return;
      if (code !== 0) rejectSanitized("cli_command_failed");
      else {
        settled = true;
        resolve(Object.freeze({ stdout, stderrCategory: stderr === "" ? "empty" : "sanitized_error_present" }));
      }
    });
  });
}

export function createRepositoryCleanReader({ timeoutMs = 10_000 } = {}) {
  return () => new Promise((resolve, reject) => {
    const child = spawn("git", ["status", "--porcelain"], { stdio: ["ignore", "pipe", "ignore"], windowsHide: true });
    let stdout = "";
    const timeout = setTimeout(() => { child.kill(); reject(new Error("repository_status_timeout")); }, timeoutMs);
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.on("error", () => { clearTimeout(timeout); reject(new Error("repository_status_unavailable")); });
    child.on("close", (code) => {
      clearTimeout(timeout);
      if (code !== 0) reject(new Error("repository_status_unavailable"));
      else resolve(stdout.trim() === "");
    });
  });
}

function listFromEnvelope(envelope, keys) {
  for (const key of keys) if (Array.isArray(envelope[key])) return envelope[key];
  if (Array.isArray(envelope)) return envelope;
  fail("cli_json_malformed");
}

export function createSchedulerDevelopmentLocalBinding(dependencies = {}) {
  const runCli = dependencies.runCli ?? createSubprocessRunner();
  const fetchImpl = Object.hasOwn(dependencies, "fetchImpl") ? dependencies.fetchImpl : globalThis.fetch;
  const readLinkedRef = dependencies.readLinkedRef ?? (() => readFile("supabase/.temp/project-ref", "utf8").then((value) => value.trim()));
  const repositoryClean = dependencies.repositoryClean ?? createRepositoryCleanReader();
  const readPersistedPhaseState = dependencies.readPhaseState ?? ((path) => readFile(path, "utf8").then(JSON.parse));
  const filesystem = dependencies.filesystem ?? { mkdir, writeFile, rename, rm, rmdir, readdir, lstat, unlink };
  const temporaryDirectory = dependencies.temporaryDirectory ?? join(tmpdir(), "forecast-scheduler-validation");
  const phaseStatePath = join(temporaryDirectory, "scheduler-phase-state.json");
  const artifactNames = new Set(["scheduler-phase-state.json", "scheduler-phase-state.invalidated", "scheduler-phase-state.consumed", "scheduler-resume-claim", "scheduler-pre-enqueue-preflight.sql", "scheduler-negative-evidence.sql", "scheduler-exactly-once-enqueue.sql", "scheduler-post-enqueue-evidence.sql", "scheduler-pre-enqueue-preflight.sql.tmp", "scheduler-negative-evidence.sql.tmp", "scheduler-exactly-once-enqueue.sql.tmp", "scheduler-post-enqueue-evidence.sql.tmp", "scheduler-phase-state.json.tmp"]);
  const writeArtifactNames = new Set(["scheduler-negative-evidence.sql", "scheduler-exactly-once-enqueue.sql", "scheduler-post-enqueue-evidence.sql", "scheduler-negative-evidence.sql.tmp", "scheduler-exactly-once-enqueue.sql.tmp", "scheduler-post-enqueue-evidence.sql.tmp"]);

  async function removeArtifacts(names) {
    await filesystem.mkdir(temporaryDirectory, { recursive: true, mode: 0o700 });
    if (typeof filesystem.lstat === "function") {
      const rootStat = await filesystem.lstat(temporaryDirectory);
      if (rootStat.isSymbolicLink?.() || !rootStat.isDirectory?.()) fail("validation_artifact_path_unsafe");
    }
    const entries = typeof filesystem.readdir === "function" ? await filesystem.readdir(temporaryDirectory) : [];
    for (const entry of entries) {
      const name = typeof entry === "string" ? entry : entry.name;
      if (!artifactNames.has(name)) fail("validation_artifact_path_unsafe");
      if (!names.has(name)) continue;
      const path = join(temporaryDirectory, name);
      if (typeof filesystem.lstat === "function") {
        const stat = await filesystem.lstat(path);
        if (stat.isSymbolicLink?.() || stat.isDirectory?.()) fail("validation_artifact_path_unsafe");
      }
      if (typeof filesystem.unlink === "function") await filesystem.unlink(path);
      else await filesystem.rm(path, { force: true });
    }
  }

  async function prepareAttempt() {
    try { await removeArtifacts(artifactNames); } catch (error) { if (error?.message === "validation_artifact_path_unsafe") throw error; fail("validation_artifact_cleanup_failed"); }
  }

  async function clearWriteArtifacts() {
    try { await removeArtifacts(writeArtifactNames); } catch (error) { if (error?.message === "validation_artifact_path_unsafe") throw error; fail("validation_artifact_cleanup_failed"); }
  }

  async function invalidatePhaseState(expectedState) {
    if (!expectedState || expectedState.phase !== "read_only_negative_evidence_required") fail("negative_evidence_terminalization_failed");
    await filesystem.rename(phaseStatePath, join(temporaryDirectory, "scheduler-phase-state.invalidated"));
    try {
      await filesystem.writeFile(`${phaseStatePath}.tmp`, JSON.stringify({ phase: "negative_evidence_terminalizing", cleanup: "terminal" }), { encoding: "utf8", mode: 0o600 });
      await filesystem.rename(`${phaseStatePath}.tmp`, phaseStatePath);
    } catch {
      // A missing state file is itself non-resumable; do not restore the old state.
      throw new Error("negative_evidence_terminalization_failed");
    }
  }

  async function consumeNegativeEvidenceState() {
    const claimPath = join(temporaryDirectory, "scheduler-resume-claim");
    try { await filesystem.mkdir(claimPath); } catch (error) {
      if (error?.code === "EEXIST" || error?.code === "EACCES" || error?.code === "EPERM") fail("negative_evidence_state_consume_failed");
      fail("negative_evidence_state_consume_failed");
    }
    let state;
    try { state = await readPhaseState(); } catch (error) { throw error; }
    if (state.phase !== "read_only_negative_evidence_required") fail("negative_evidence_state_consume_failed");
    const consumedPath = join(temporaryDirectory, "scheduler-phase-state.consumed");
    try {
      await filesystem.rename(phaseStatePath, consumedPath);
      await filesystem.writeFile(`${phaseStatePath}.tmp`, JSON.stringify({ phase: "negative_evidence_terminalizing", cleanup: "terminal" }), { encoding: "utf8", mode: 0o600 });
      await filesystem.rename(`${phaseStatePath}.tmp`, phaseStatePath);
    } catch {
      throw new Error("negative_evidence_state_consume_failed");
    }
    return state;
  }

  async function runMetadataPreflightPhase(records, phase, args, listKeys) {
    if (!METADATA_PHASE_SET.has(phase)) fail("metadata_phase_unknown");
    const index = METADATA_PHASES.indexOf(phase);
    const replace = (fields) => { records[index] = metadataRecord(phase, fields); };
    let execution;
    try {
      execution = await runCli(args);
    } catch (error) {
      const exitCategory = cliFailureExitCategory(error);
      const category = exitCategory === "timeout" ? "cli_timeout" : exitCategory === "spawn_failed" ? "cli_unavailable" : "cli_command_failed";
      replace({
        attempted: true,
        completed: true,
        exitCategory,
        stdoutShape: "unknown",
        stderrCategory: error?.stderrCategory === "sanitized_error_present" ? "sanitized_error_present" : "empty",
        parserCategory: "not_attempted",
        outcomeCategory: category,
      });
      throw new SchedulerMetadataPhaseFailure(category, phase, records);
    }
    const stdout = typeof execution === "string" ? execution : execution?.stdout;
    const stderrCategory = execution?.stderrCategory === "sanitized_error_present" ? "sanitized_error_present" : "empty";
    const shape = stdoutShape(stdout);
    if (shape === "empty") {
      replace({ attempted: true, completed: true, exitCategory: "zero", stdoutShape: shape, stderrCategory, parserCategory: "empty", outcomeCategory: "cli_response_empty" });
      throw new SchedulerMetadataPhaseFailure("cli_response_empty", phase, records);
    }
    let envelope;
    try {
      envelope = parseCliJsonEnvelope(stdout);
    } catch {
      replace({ attempted: true, completed: true, exitCategory: "zero", stdoutShape: shape, stderrCategory, parserCategory: "unsupported_shape", outcomeCategory: "cli_response_shape_unsupported" });
      throw new SchedulerMetadataPhaseFailure("cli_response_shape_unsupported", phase, records);
    }
    let entries;
    try {
      entries = listFromEnvelope(envelope, listKeys);
    } catch {
      replace({ attempted: true, completed: true, exitCategory: "zero", stdoutShape: shape, stderrCategory, parserCategory: "unsupported_shape", outcomeCategory: "cli_response_shape_unsupported" });
      throw new SchedulerMetadataPhaseFailure("cli_response_shape_unsupported", phase, records);
    }
    replace({ attempted: true, completed: true, exitCategory: "zero", stdoutShape: shape, stderrCategory, parserCategory: "parsed", outcomeCategory: "success" });
    return entries;
  }

  function rejectMetadataSemanticFailure(records, phase, category, parserCategory = "parsed") {
    if (!METADATA_PHASE_SET.has(phase)) fail("metadata_phase_unknown");
    const index = METADATA_PHASES.indexOf(phase);
    records[index] = metadataRecord(phase, { ...records[index], parserCategory, outcomeCategory: category });
    throw new SchedulerMetadataPhaseFailure(category, phase, records);
  }

  async function preflight({ expectedDevelopment, expectedProduction }) {
    if (!expectedDevelopment || !expectedProduction || expectedDevelopment === expectedProduction) fail("development_target_required");
    if (!(await repositoryClean())) fail("repository_not_clean");
    const records = [...createSchedulerMetadataPhaseRecords()];
    const projects = await runMetadataPreflightPhase(records, "target_metadata_lookup", ["projects", "list", "--output-format", "json"], ["projects", "data"]);
    let linkedRef;
    try {
      linkedRef = await readLinkedRef();
    } catch {
      rejectMetadataSemanticFailure(records, "target_metadata_lookup", "linked_context_unavailable");
    }
    const development = projects.filter((project) => project.name === expectedDevelopment);
    if (development.length !== 1) rejectMetadataSemanticFailure(records, "target_metadata_lookup", "target_verification_failed", development.length > 1 ? "ambiguous" : "parsed");
    if (development[0].ref !== linkedRef) rejectMetadataSemanticFailure(records, "target_metadata_lookup", "target_verification_failed");
    if (projects.some((project) => project.name === expectedProduction && project.ref === linkedRef)) rejectMetadataSemanticFailure(records, "target_metadata_lookup", "production_target_refused");
    const functions = await runMetadataPreflightPhase(records, "function_metadata_check", ["functions", "list", "--output-format", "json"], ["functions", "data"]);
    if (!functions.some((entry) => entry.name === FUNCTION_NAME)) rejectMetadataSemanticFailure(records, "function_metadata_check", "function_missing");
    const secrets = await runMetadataPreflightPhase(records, "edge_secret_name_metadata_check", ["secrets", "list", "--output-format", "json"], ["secrets", "data"]);
    if (!secrets.some((entry) => entry.name === EDGE_SECRET_NAME)) rejectMetadataSemanticFailure(records, "edge_secret_name_metadata_check", "edge_secret_missing");
    const migrationRows = await runMetadataPreflightPhase(records, "migration_metadata_check", ["migration", "list", "--linked", "--output-format", "json"], ["migrations", "data"]);
    const present = (value) => value !== undefined && value !== null && value !== "" && value !== false;
    const local = migrationRows.filter((row) => present(row.local ?? row.LOCAL) && !present(row.remote ?? row.REMOTE)).length;
    const remote = migrationRows.filter((row) => present(row.remote ?? row.REMOTE) && !present(row.local ?? row.LOCAL)).length;
    const applied = migrationRows.filter((row) => present(row.local ?? row.LOCAL) && present(row.remote ?? row.REMOTE)).length;
    if (applied !== 6 || local !== 0 || remote !== 0) rejectMetadataSemanticFailure(records, "migration_metadata_check", "migration_state_mismatch");
    return Object.freeze({ linkedRef, endpoint: new URL(`/functions/v1/${FUNCTION_NAME}`, `https://${linkedRef}.supabase.co`).toString(), target: "verified", migrations: "6/6/0/0", metadataPhases: Object.freeze(records.map((record) => Object.freeze({ ...record }))) });
  }

  async function runNegativeCases(endpoint, save = async () => {}) {
    if (typeof fetchImpl !== "function") fail("local_http_client_unavailable");
    const cases = [
      ["get_no_auth", "GET", undefined, undefined],
      ["post_no_auth", "POST", "{}", undefined],
      ["post_wrong_bearer", "POST", "{}", { Authorization: "Bearer invalid-machine-auth-test" }],
      ["post_unexpected_body", "POST", '{"unexpected":true}', undefined],
    ];
    const records = [];
    for (const [label, method, body, headers] of cases) {
      await save(immutableNegativeRecords(records), label);
      let response;
      try {
        response = await fetchImpl(endpoint, { method, body, headers, redirect: "error" });
      } catch {
        fail("negative_request_submission_failed");
      }
      if (response.redirected || !SAFE_NEGATIVE_CATEGORIES.has(response.status)) fail("negative_response_unexpected");
      let payload;
      try { payload = await response.json(); } catch { fail("negative_response_unparseable"); }
      const category = SAFE_NEGATIVE_CATEGORIES.get(response.status);
      if (payload?.error !== category) fail("negative_response_unexpected");
      records.push(Object.freeze({ label, status: response.status, category, reachedEndpoint: true }));
      await save(immutableNegativeRecords(records), null);
    }
    return immutableNegativeRecords(records);
  }

  async function writePreflightArtifact() {
    await filesystem.mkdir(temporaryDirectory, { recursive: true, mode: 0o700 });
    const preflightPath = join(temporaryDirectory, "scheduler-pre-enqueue-preflight.sql");
    const staged = `${preflightPath}.tmp`;
    await filesystem.writeFile(staged, buildPreflightSql(), { encoding: "utf8", mode: 0o600 });
    await filesystem.rename(staged, preflightPath);
    return { preflightPath };
  }

  async function writeSqlArtifacts(projectRef, attemptBoundary, scheduledRunBaseline) {
    requireAttemptBoundary(attemptBoundary);
    requireBaseline(scheduledRunBaseline);
    await filesystem.mkdir(temporaryDirectory, { recursive: true, mode: 0o700 });
    const enqueuePath = join(temporaryDirectory, "scheduler-exactly-once-enqueue.sql");
    const evidencePath = join(temporaryDirectory, "scheduler-post-enqueue-evidence.sql");
    for (const [path, content] of [[enqueuePath, buildGuardedEnqueueSql(projectRef, attemptBoundary, scheduledRunBaseline)], [evidencePath, buildBoundEvidenceSql(attemptBoundary)]]) {
      const staged = `${path}.tmp`;
      await filesystem.writeFile(staged, content, { encoding: "utf8", mode: 0o600 });
      await filesystem.rename(staged, path);
    }
    return { enqueuePath, evidencePath };
  }

  async function writeNegativeEvidenceArtifact(attemptBoundary, scheduledRunBaseline) {
    requireAttemptBoundary(attemptBoundary);
    requireBaseline(scheduledRunBaseline);
    await clearWriteArtifacts();
    const path = join(temporaryDirectory, "scheduler-negative-evidence.sql");
    const staged = `${path}.tmp`;
    await filesystem.writeFile(staged, buildNegativeEvidenceSql(attemptBoundary, scheduledRunBaseline), { encoding: "utf8", mode: 0o600 });
    await filesystem.rename(staged, path);
    return { negativeEvidencePath: path };
  }

  async function writePhaseState(state) {
    await filesystem.mkdir(temporaryDirectory, { recursive: true, mode: 0o700 });
    const staged = `${phaseStatePath}.tmp`;
    await filesystem.writeFile(staged, JSON.stringify(sanitizePhaseState(state)), { encoding: "utf8", mode: 0o600 });
    await filesystem.rename(staged, phaseStatePath);
  }

  async function readPhaseState() {
    const state = sanitizePhaseState(await readPersistedPhaseState(phaseStatePath));
    if (!["read_only_preflight_required", "preflight_passed_negative_revalidation_required", "negative_revalidation_in_progress", "read_only_negative_evidence_required", "negative_evidence_passed", "manual_enqueue_required", "negative_evidence_terminalizing", "negative_evidence_failed_terminal"].includes(state.phase)) fail("manual_phase_state_invalid");
    return state;
  }

  async function cleanupArtifacts() {
    try {
      await removeArtifacts(artifactNames);
      if (typeof filesystem.rmdir === "function") await filesystem.rmdir(temporaryDirectory);
      else await filesystem.rm(temporaryDirectory, { recursive: false, force: true });
    } catch (error) {
      if (error?.code === "ENOENT") return;
      if (error?.message === "validation_artifact_path_unsafe") throw error;
      fail("validation_artifact_cleanup_failed");
    }
  }

  async function releaseResumeClaim() {
    try { if (typeof filesystem.rmdir === "function") await filesystem.rmdir(join(temporaryDirectory, "scheduler-resume-claim")); else await filesystem.rm(join(temporaryDirectory, "scheduler-resume-claim"), { recursive: false, force: true }); }
    catch (error) { if (error?.code === "ENOENT") return; fail("validation_artifact_cleanup_failed"); }
  }

  return { preflight, runNegativeCases, writePreflightArtifact, writeNegativeEvidenceArtifact, writeSqlArtifacts, writePhaseState, readPhaseState, cleanupArtifacts, prepareAttempt, clearWriteArtifacts, invalidatePhaseState, consumeNegativeEvidenceState, releaseResumeClaim };
}
