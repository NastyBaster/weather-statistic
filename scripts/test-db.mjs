import { randomUUID } from "node:crypto";
import { basename } from "node:path";
import { spawn, spawnSync } from "node:child_process";

const projectName = basename(process.cwd());
const expectedCases = 14;
const commandTimeoutMs = 30_000;
const pgTapTimeoutMs = 120_000;
const passed = [];
const failed = [];
let databaseContainer;
let fixtureUserId;
let fixtureLocationId;
const fixtureRunIds = new Set();
const activeSessions = new Set();

function command(commandName, args, options = {}) {
  return spawnSync(commandName, args, {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    timeout: commandTimeoutMs,
    ...options,
  });
}

function requireSuccess(result, category) {
  if (result.error || result.status !== 0) {
    throw new Error(category);
  }
  return result.stdout.trim();
}

function verifyLocalTarget() {
  requireSuccess(command("docker", ["info", "--format", "{{.ServerVersion}}"]), "docker_unavailable");
  requireSuccess(command("supabase", ["--version"]), "supabase_cli_unavailable");

  const candidateIds = requireSuccess(
    command("docker", [
      "ps",
      "--filter",
      `label=com.supabase.cli.project=${projectName}`,
      "--format",
      "{{.ID}}",
    ]),
    "local_database_discovery_failed",
  ).split(/\r?\n/).filter(Boolean);

  const candidates = candidateIds.map((candidate) => {
    const [labelsJson, image, running, id] = requireSuccess(
      command("docker", ["inspect", "--format", "{{json .Config.Labels}}\t{{.Config.Image}}\t{{.State.Running}}\t{{.Id}}", candidate]),
      "local_database_inspection_failed",
    ).split("\t");
    return {
      Config: { Labels: JSON.parse(labelsJson), Image: image },
      Id: id,
      State: { Running: running === "true" },
    };
  }).filter((details) => {
    const labels = details?.Config?.Labels ?? {};
    return (
      details?.State?.Running === true
      && labels["com.supabase.cli.project"] === projectName
      && labels["com.supabase.cli.workdir"]?.toLowerCase() === process.cwd().toLowerCase()
      && /(^|\/)supabase\/postgres(?::|$)/.test(details?.Config?.Image ?? "")
    );
  });

  if (candidates.length !== 1) throw new Error("local_database_not_unique");
  const details = candidates[0];
  const labels = details?.Config?.Labels ?? {};
  const image = details?.Config?.Image ?? "";

  if (
    details?.State?.Running !== true
    || labels["com.supabase.cli.project"] !== projectName
    || labels["com.supabase.cli.workdir"]?.toLowerCase() !== process.cwd().toLowerCase()
    || !/(^|\/)supabase\/postgres(?::|$)/.test(image)
  ) {
    throw new Error("local_database_target_rejected");
  }
  databaseContainer = details.Id;
}

function psqlArgs(sql) {
  return [
    "exec", "-i", databaseContainer, "psql", "-X", "-qAt", "-U", "postgres",
    "-v", "ON_ERROR_STOP=1", "-d", "postgres", "-c", sql,
  ];
}

function sql(sqlText, category) {
  return requireSuccess(command("docker", psqlArgs(sqlText)), category);
}

function sqlResult(sqlText) {
  return command("docker", psqlArgs(sqlText));
}

function sqlAsync(sqlText) {
  const child = spawn("docker", psqlArgs(sqlText), {
    stdio: ["ignore", "pipe", "pipe"],
  });
  let stdout = "";
  let stderr = "";
  const timeout = setTimeout(() => child.kill(), commandTimeoutMs);
  child.stdout.on("data", (chunk) => { stdout += chunk; });
  child.stderr.on("data", (chunk) => { stderr += chunk; });
  return new Promise((resolve) => {
    child.on("error", () => {
      clearTimeout(timeout);
      resolve({ status: 1, stdout, stderr });
    });
    child.on("close", (status) => {
      clearTimeout(timeout);
      resolve({ status, stdout, stderr });
    });
  });
}

function interactiveSession(sqlText, marker) {
  const child = spawn("docker", [
    "exec", "-i", databaseContainer, "psql", "-X", "-qAt", "-U", "postgres",
    "-v", "ON_ERROR_STOP=1", "-d", "postgres",
  ], { stdio: ["pipe", "pipe", "pipe"] });
  let stdout = "";
  let stderr = "";
  let markerResolve;
  let markerReject;
  const timeout = setTimeout(() => {
    markerReject(new Error("session_timeout"));
    child.kill();
  }, commandTimeoutMs);
  const markerReady = new Promise((resolve, reject) => {
    markerResolve = resolve;
    markerReject = reject;
  });
  const closed = new Promise((resolve) => {
    child.on("close", (status) => resolve({ status, stdout, stderr }));
    child.on("error", () => resolve({ status: 1, stdout, stderr }));
  });

  child.stdout.on("data", (chunk) => {
    stdout += chunk;
    if (stdout.includes(marker)) markerResolve();
  });
  child.stderr.on("data", (chunk) => { stderr += chunk; });
  child.on("error", () => {
    clearTimeout(timeout);
    markerReject(new Error("session_start_failed"));
  });
  child.on("close", () => {
    clearTimeout(timeout);
    markerReject(new Error("session_closed_before_lock"));
  });
  child.stdin.write(`begin; ${sqlText}; select '${marker}';\n`);

  const session = {
    markerReady,
    async commit(category) {
      clearTimeout(timeout);
      child.stdin.end("commit;\\q\n");
      const result = await closed;
      activeSessions.delete(session);
      if (result.status !== 0) throw new Error(category);
    },
    async rollback() {
      clearTimeout(timeout);
      if (!child.killed && !child.stdin.destroyed) child.stdin.end("rollback;\\q\n");
      await closed;
      activeSessions.delete(session);
    },
  };
  activeSessions.add(session);
  return session;
}

function assertCase(name, condition) {
  if (!condition) throw new Error(name);
  passed.push(name);
  process.stdout.write(`PASS database concurrency: ${name}\n`);
}

async function runCase(name, callback) {
  try {
    await callback();
  } catch {
    failed.push(name);
    process.stdout.write(`FAIL database concurrency: ${name}\n`);
  }
}

function newRunId() {
  const id = randomUUID();
  fixtureRunIds.add(id);
  return id;
}

function createScheduledRun(minutesOld = 16) {
  const id = newRunId();
  sql(
    `insert into public.forecast_runs (id, trigger_type, started_at, locations_total) values ('${id}', 'scheduled', transaction_timestamp() - interval '${minutesOld} minutes', 0)`,
    "scheduled_fixture_create_failed",
  );
  return id;
}

function finishFixtureScheduledRuns() {
  if (fixtureRunIds.size === 0) return;
  const ids = [...fixtureRunIds].map((id) => `'${id}'`).join(",");
  sql(
    `update public.forecast_runs set status = 'failed', completed_at = transaction_timestamp(), locations_failed = locations_total where id in (${ids}) and status = 'running'`,
    "scheduled_fixture_terminalization_failed",
  );
}

function parseClaim(output) {
  const [result, runId] = output.trim().split("|");
  if (runId) fixtureRunIds.add(runId);
  return { result, runId };
}

function snapshotBatch(runId, dayOffset) {
  return `select inserted_count from public.insert_forecast_snapshot_batch('${runId}', jsonb_build_array(jsonb_build_object('location_id', '${fixtureLocationId}', 'collected_at', now(), 'collection_date', current_date ${dayOffset}, 'target_date', current_date ${dayOffset}, 'temperature_min', 1)))`;
}

async function assertPending(promise, name) {
  let settled = false;
  promise.finally(() => { settled = true; });
  await new Promise((resolve) => setTimeout(resolve, 250));
  assertCase(name, !settled);
}

async function runConcurrencyCases() {
  fixtureUserId = randomUUID();
  fixtureLocationId = randomUUID();
  sql(`insert into auth.users (id) values ('${fixtureUserId}')`, "fixture_user_create_failed");
  sql(
    `insert into public.locations (id, user_id, name, country_code, latitude, longitude, timezone) values ('${fixtureLocationId}', '${fixtureUserId}', 'Concurrency fixture', 'UA', 50, 30, 'Europe/Kyiv')`,
    "fixture_location_create_failed",
  );

  const concurrentStaleId = createScheduledRun();
  const [firstClaim, secondClaim] = await Promise.all([
    sqlAsync("select result || '|' || coalesce(run_id::text, '') from public.claim_scheduled_forecast_run(0)"),
    sqlAsync("select result || '|' || coalesce(run_id::text, '') from public.claim_scheduled_forecast_run(0)"),
  ]);
  const claims = [parseClaim(requireSuccess(firstClaim, "concurrent_claim_failed")), parseClaim(requireSuccess(secondClaim, "concurrent_claim_failed"))];
  await runCase("concurrent claim has one winner", () => assertCase("concurrent claim has one winner", claims.filter((claim) => claim.result === "claimed").length === 1));
  await runCase("concurrent claim has one overlap", () => assertCase("concurrent claim has one overlap", claims.filter((claim) => claim.result === "scheduled_run_active").length === 1));
  await runCase("concurrent recovery terminalizes stale run once", () => assertCase(
    "concurrent recovery terminalizes stale run once",
    sql(`select status from public.forecast_runs where id = '${concurrentStaleId}'`, "concurrent_status_query_failed") === "failed",
  ));

  await runCase("recovery never assigns snapshots_created", () => assertCase(
    "recovery never assigns snapshots_created",
    sql("select (pg_get_functiondef('public.claim_scheduled_forecast_run(integer)'::regprocedure) not ilike '%snapshots_created =%')::text", "claim_definition_query_failed") === "true",
  ));
  await runCase("finalize never updates or deletes snapshots", () => assertCase(
    "finalize never updates or deletes snapshots",
    sql("select (pg_get_functiondef('public.finalize_forecast_run(uuid,text,integer,integer,integer,text)'::regprocedure) not ilike '%forecast_snapshots%')::text", "finalize_definition_query_failed") === "true",
  ));

  finishFixtureScheduledRuns();
  const rollbackStaleId = createScheduledRun();
  const triggerSuffix = randomUUID().replaceAll("-", "");
  const triggerName = `scheduler_test_reject_${triggerSuffix}`;
  const functionName = `scheduler_test_reject_fn_${triggerSuffix}`;
  try {
    sql(`create function public.${functionName}() returns trigger language plpgsql set search_path = '' as $$ begin raise exception 'forced replacement failure'; end; $$`, "replacement_trigger_function_create_failed");
    sql(`create trigger ${triggerName} before insert on public.forecast_runs for each row when (new.trigger_type = 'scheduled') execute function public.${functionName}()`, "replacement_trigger_create_failed");
    await runCase("failed stale replacement rolls back the claim transaction", () => {
      const result = sqlResult("select * from public.claim_scheduled_forecast_run(0)");
      assertCase("failed stale replacement rolls back the claim transaction", result.status !== 0 && `${result.stdout}${result.stderr}`.includes("forced replacement failure"));
    });
    await runCase("failed stale transaction leaves original run running", () => assertCase(
      "failed stale transaction leaves original run running",
      sql(`select status from public.forecast_runs where id = '${rollbackStaleId}'`, "rollback_status_query_failed") === "running",
    ));
  } finally {
    sql(`drop trigger if exists ${triggerName} on public.forecast_runs`, "replacement_trigger_drop_failed");
    sql(`drop function if exists public.${functionName}()`, "replacement_trigger_function_drop_failed");
  }

  const writer = interactiveSession(snapshotBatch(rollbackStaleId, "- 1"), "writer_locked");
  await writer.markerReady;
  const recoveryAfterWriter = sqlAsync("select result || '|' || coalesce(run_id::text, '') from public.claim_scheduled_forecast_run(0)");
  await runCase("snapshot-writer-first makes recovery wait", () => assertPending(recoveryAfterWriter, "snapshot-writer-first makes recovery wait"));
  await writer.commit("writer_commit_failed");
  parseClaim(requireSuccess(await recoveryAfterWriter, "writer_first_recovery_failed"));
  await runCase("writer-first recovery terminalizes after snapshot commit", () => assertCase(
    "writer-first recovery terminalizes after snapshot commit",
    sql(`select status from public.forecast_runs where id = '${rollbackStaleId}'`, "writer_first_status_query_failed") === "failed",
  ));

  finishFixtureScheduledRuns();
  const recoveryFirstId = createScheduledRun();
  const recovery = interactiveSession("select result || '|' || coalesce(run_id::text, '') from public.claim_scheduled_forecast_run(0)", "recovery_locked");
  await recovery.markerReady;
  const lateWriter = sqlAsync(snapshotBatch(recoveryFirstId, "- 2"));
  await runCase("recovery-first makes late snapshot writer wait", () => assertPending(lateWriter, "recovery-first makes late snapshot writer wait"));
  await recovery.commit("recovery_commit_failed");
  const lateWriterResult = await lateWriter;
  await runCase("recovery-first rejects complete late snapshot batch", () => assertCase(
    "recovery-first rejects complete late snapshot batch",
    lateWriterResult.status !== 0 && `${lateWriterResult.stdout}${lateWriterResult.stderr}`.includes("forecast_run_not_running"),
  ));
  await runCase("recovery-first commits no late snapshot", () => assertCase(
    "recovery-first commits no late snapshot",
    sql(`select count(*) from public.forecast_snapshots where forecast_run_id = '${recoveryFirstId}' and collection_date = current_date - 2`, "late_snapshot_count_query_failed") === "0",
  ));

  const deletionRunId = newRunId();
  sql(`insert into public.forecast_runs (id, trigger_type, locations_total) values ('${deletionRunId}', 'manual', 1)`, "deletion_fixture_run_create_failed");
  sql(snapshotBatch(deletionRunId, "- 3"), "deletion_fixture_snapshot_create_failed");
  sql(`select result from public.finalize_forecast_run('${deletionRunId}', 'succeeded', 1, 0, 1, null)`, "deletion_fixture_finalize_failed");
  await runCase("post-recovery location deletion remains lawful", () => {
    sql(`delete from public.locations where id = '${fixtureLocationId}'`, "post_recovery_location_delete_failed");
    assertCase("post-recovery location deletion remains lawful", true);
  });
  await runCase("location deletion does not rewrite historical counter", () => assertCase(
    "location deletion does not rewrite historical counter",
    sql(`select snapshots_created from public.forecast_runs where id = '${deletionRunId}'`, "historical_counter_query_failed") === "1",
  ));
}

async function cleanupFixtures() {
  if (!databaseContainer) return;
  try {
    await Promise.all([...activeSessions].map((session) => session.rollback()));
    if (fixtureLocationId) sql(`delete from public.locations where id = '${fixtureLocationId}'`, "fixture_location_cleanup_failed");
    if (fixtureRunIds.size > 0) {
      const ids = [...fixtureRunIds].map((id) => `'${id}'`).join(",");
      sql(`delete from public.forecast_runs where id in (${ids})`, "fixture_run_cleanup_failed");
    }
    if (fixtureUserId) sql(`delete from auth.users where id = '${fixtureUserId}'`, "fixture_user_cleanup_failed");
  } catch {
    failed.push("local fixture cleanup");
    process.stdout.write("FAIL database concurrency: local fixture cleanup\n");
  }
}

function runPgTap() {
  const result = spawnSync("supabase", ["test", "db"], {
    stdio: "inherit",
    timeout: pgTapTimeoutMs,
  });
  return result.status === 0;
}

let pgTapPassed = false;
try {
  verifyLocalTarget();
  pgTapPassed = runPgTap();
  if (pgTapPassed) await runConcurrencyCases();
} catch (error) {
  const category = error instanceof Error ? error.message : "database_test_orchestrator_failed";
  failed.push(category);
  process.stdout.write(`FAIL database concurrency: ${category}\n`);
} finally {
  await cleanupFixtures();
}

if (!pgTapPassed) {
  failed.push("pgtap assertions");
  process.stdout.write("FAIL database concurrency: pgtap assertions\n");
}

process.stdout.write(`Database concurrency summary: passed=${passed.length} failed=${failed.length} skipped=${expectedCases - passed.length - failed.length}\n`);
process.exit(pgTapPassed && passed.length === expectedCases && failed.length === 0 ? 0 : 1);
