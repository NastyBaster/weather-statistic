import { spawn } from "node:child_process";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

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

export function buildEnqueueSql(projectRef) {
  if (!/^[a-z0-9-]+$/.test(projectRef)) fail("linked_reference_invalid");
  return `begin;
with vault_token as (
  select min(decrypted_secret) as token
  from vault.decrypted_secrets
  where name = '${VAULT_SECRET_NAME}'
  having count(*) = 1
), enqueued as (
  select net.http_post(
    url := 'https://${projectRef}.supabase.co/functions/v1/${FUNCTION_NAME}',
    body := '{}'::jsonb,
    params := '{}'::jsonb,
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || token
    ),
    timeout_milliseconds := 140000
  ) as ignored_request_id
  from vault_token
)
select exists(select 1 from enqueued) as enqueue_committed;
commit;
`;
}

export function buildEvidenceSql() {
  return `begin;
set transaction read only;
with validation_window as (
  select date_trunc('minute', now()) - interval '20 minutes' as started_at
), candidate_runs as (
  select status, locations_total, locations_succeeded, locations_failed, snapshots_created
  from public.forecast_runs, validation_window
  where trigger_type = 'scheduled' and created_at >= validation_window.started_at
), summary as (
  select
    count(*) filter (where status in ('success', 'partial', 'failed'))::integer as terminal_runs,
    count(*) filter (where status = 'running')::integer as running_runs,
    count(*)::integer as new_scheduled_runs,
    coalesce(max(locations_total), 0)::integer as locations_total,
    coalesce(max(locations_succeeded), 0)::integer as locations_succeeded,
    coalesce(max(locations_failed), 0)::integer as locations_failed,
    coalesce(max(snapshots_created), 0)::integer as snapshots_created,
    coalesce(max(case when status in ('success', 'partial', 'failed') then status end), 'none') as terminal_status
  from candidate_runs
), duplicate_identities as (
  select count(*)::integer as duplicate_immutable_identity_count
  from (
    select snapshots.location_id, snapshots.collection_date, snapshots.target_date
    from public.forecast_snapshots as snapshots
    join public.forecast_runs as runs on runs.id = snapshots.forecast_run_id
    join validation_window on true
    where runs.trigger_type = 'scheduled' and runs.created_at >= validation_window.started_at
    group by snapshots.location_id, snapshots.collection_date, snapshots.target_date
    having count(*) > 1
  ) as duplicate_keys
)
select
  new_scheduled_runs,
  terminal_runs,
  running_runs,
  terminal_status,
  locations_total,
  locations_succeeded,
  locations_failed,
  snapshots_created,
  (locations_total >= 0 and locations_succeeded >= 0 and locations_failed >= 0
    and locations_succeeded + locations_failed = locations_total) as counter_invariant,
  duplicate_immutable_identity_count
from summary cross join duplicate_identities;
rollback;
`;
}

export function sanitizePhaseState(state) {
  const allowed = ["phase", "negative", "manual_enqueue_required", "resume_ready", "cleanup"];
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
      await save(immutableNegativeRecords(records));
    }
    return immutableNegativeRecords(records);
  }

  async function writeSqlArtifacts(projectRef) {
    await filesystem.mkdir(temporaryDirectory, { recursive: true, mode: 0o700 });
    const enqueuePath = join(temporaryDirectory, "scheduler-enqueue.sql");
    const evidencePath = join(temporaryDirectory, "scheduler-evidence.sql");
    for (const [path, content] of [[enqueuePath, buildEnqueueSql(projectRef)], [evidencePath, buildEvidenceSql()]]) {
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
    if (state.phase !== "manual_enqueue_required" || state.manual_enqueue_required !== true) fail("manual_phase_state_invalid");
    return state;
  }

  async function cleanupArtifacts() {
    await filesystem.rm(temporaryDirectory, { recursive: true, force: true });
  }

  return { preflight, runNegativeCases, writeSqlArtifacts, writePhaseState, readPhaseState, cleanupArtifacts };
}
