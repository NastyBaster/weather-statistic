import { spawn } from "node:child_process";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  buildEnqueueSql as buildGuardedEnqueueSql,
  buildEvidenceSql as buildBoundEvidenceSql,
  buildPreflightSql,
  requireAttemptBoundary,
  requireBaseline,
} from "./scheduler-smoke-artifacts.mjs";

const FUNCTION_NAME = "collect-forecasts";
const EDGE_SECRET_NAME = "FORECAST_SCHEDULER_TOKEN";
const VAULT_SECRET_NAME = "forecast_scheduler_token";
const SAFE_NEGATIVE_CATEGORIES = new Map([[405, "method_not_allowed"], [401, "unauthorized"]]);

const fail = (category) => {
  throw new Error(category);
};

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
  const allowed = ["phase", "negative", "manual_enqueue_required", "resume_ready", "cleanup", "attempt_boundary", "scheduled_run_baseline"];
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
    const timeout = setTimeout(() => {
      child.kill();
      reject(new Error("cli_timeout"));
    }, timeoutMs);
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.on("error", () => { clearTimeout(timeout); reject(new Error("cli_unavailable")); });
    child.on("close", (code) => {
      clearTimeout(timeout);
      if (code !== 0) reject(new Error("cli_command_failed"));
      else resolve(stdout);
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
  const filesystem = dependencies.filesystem ?? { mkdir, writeFile, rename, rm };
  const temporaryDirectory = dependencies.temporaryDirectory ?? join(tmpdir(), "forecast-scheduler-validation");
  const phaseStatePath = join(temporaryDirectory, "scheduler-phase-state.json");

  async function cliJson(args) {
    return parseCliJsonEnvelope(await runCli(args));
  }

  async function preflight({ expectedDevelopment, expectedProduction }) {
    if (!expectedDevelopment || !expectedProduction || expectedDevelopment === expectedProduction) fail("development_target_required");
    if (!(await repositoryClean())) fail("repository_not_clean");
    const [projectEnvelope, functionEnvelope, secretEnvelope, linkedRef] = await Promise.all([
      cliJson(["projects", "list", "--output-format", "json"]),
      cliJson(["functions", "list", "--output-format", "json"]),
      cliJson(["secrets", "list", "--output-format", "json"]),
      readLinkedRef(),
    ]);
    const projects = listFromEnvelope(projectEnvelope, ["projects", "data"]);
    const functions = listFromEnvelope(functionEnvelope, ["functions", "data"]);
    const secrets = listFromEnvelope(secretEnvelope, ["secrets", "data"]);
    const development = projects.filter((project) => project.name === expectedDevelopment);
    if (development.length !== 1 || development[0].ref !== linkedRef) fail("target_verification_failed");
    if (projects.some((project) => project.name === expectedProduction && project.ref === linkedRef)) fail("production_target_refused");
    if (!functions.some((entry) => entry.name === FUNCTION_NAME)) fail("function_missing");
    if (!secrets.some((entry) => entry.name === EDGE_SECRET_NAME)) fail("edge_secret_missing");
    const migrationEnvelope = await cliJson(["migration", "list", "--linked", "--output-format", "json"]);
    const migrationRows = listFromEnvelope(migrationEnvelope, ["migrations", "data"]);
    const present = (value) => value !== undefined && value !== null && value !== "" && value !== false;
    const local = migrationRows.filter((row) => present(row.local ?? row.LOCAL) && !present(row.remote ?? row.REMOTE)).length;
    const remote = migrationRows.filter((row) => present(row.remote ?? row.REMOTE) && !present(row.local ?? row.LOCAL)).length;
    const applied = migrationRows.filter((row) => present(row.local ?? row.LOCAL) && present(row.remote ?? row.REMOTE)).length;
    if (applied !== 6 || local !== 0 || remote !== 0) fail("migration_state_mismatch");
    return Object.freeze({ linkedRef, endpoint: new URL(`/functions/v1/${FUNCTION_NAME}`, `https://${linkedRef}.supabase.co`).toString(), target: "verified", migrations: "6/6/0/0" });
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

  async function writePhaseState(state) {
    await filesystem.mkdir(temporaryDirectory, { recursive: true, mode: 0o700 });
    const staged = `${phaseStatePath}.tmp`;
    await filesystem.writeFile(staged, JSON.stringify(sanitizePhaseState(state)), { encoding: "utf8", mode: 0o600 });
    await filesystem.rename(staged, phaseStatePath);
  }

  async function readPhaseState() {
    const state = sanitizePhaseState(await readPersistedPhaseState(phaseStatePath));
    if (!["read_only_preflight_required", "manual_enqueue_required"].includes(state.phase)) fail("manual_phase_state_invalid");
    return state;
  }

  async function cleanupArtifacts() {
    await filesystem.rm(temporaryDirectory, { recursive: true, force: true });
  }

  return { preflight, runNegativeCases, writePreflightArtifact, writeSqlArtifacts, writePhaseState, readPhaseState, cleanupArtifacts };
}
