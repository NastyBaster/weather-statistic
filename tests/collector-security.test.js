import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

const files = (directory) =>
  readdirSync(directory, { withFileTypes: true }).flatMap((entry) =>
    entry.isDirectory()
      ? files(join(directory, entry.name))
      : entry.isFile()
      ? [join(directory, entry.name)]
      : []
  );
const frontend = files("js").map((path) => readFileSync(path, "utf8")).join("\n");
const repositorySources = files(".")
  .filter((path) => {
    const normalized = path.replaceAll("\\", "/");
    return !normalized.startsWith(".git/") &&
      !normalized.startsWith("dist/") &&
      !normalized.startsWith("node_modules/");
  })
  .map((path) => readFileSync(path, "utf8"))
  .join("\n");

test("collector trust boundary remains outside frontend", () => {
  assert.doesNotMatch(frontend, /api\.open-meteo\.com/i);
  assert.doesNotMatch(frontend, /SUPABASE_SERVICE_ROLE_KEY/);
  assert.doesNotMatch(frontend, /forecast_snapshots[\s\S]{0,100}\.(?:insert|upsert|update|delete)\(/);
});

test("scheduler implementation adds no actual-weather schema or repository secret", () => {
  const operationalFiles = [...files("supabase"), ...files(".github")].map((path) => readFileSync(path, "utf8")).join("\n");
  assert.doesNotMatch(operationalFiles, /create\s+table\s+(?:public\.)?weather_observations/i);
  assert.doesNotMatch(operationalFiles, /FORECAST_SCHEDULER_TOKEN\s*=\s*['"][A-Za-z0-9_-]{20,}/);
});

test("scheduler uses database-enforced claim and snapshot write paths", () => {
  const collector = readFileSync("supabase/functions/collect-forecasts/collector.ts", "utf8");
  const migration = readFileSync("supabase/migrations/202608230001_implement_forecast_scheduler.sql", "utf8");
  assert.match(collector, /rpc\("claim_scheduled_forecast_run"/);
  assert.match(collector, /rpc\(\s*"insert_forecast_snapshot_batch"/);
  assert.doesNotMatch(collector, /from\("forecast_snapshots"\)\s*\.upsert/);
  assert.match(migration, /for no key update/i);
  assert.match(migration, /pg_advisory_xact_lock/i);
  assert.match(migration, /interval '15 minutes'/i);
});

test("collector fences terminal updates and applies the overall deadline", () => {
  const collector = readFileSync("supabase/functions/collect-forecasts/collector.ts", "utf8");
  assert.match(collector, /rpc\(\s*"finalize_forecast_run"/);
  assert.doesNotMatch(collector, /from\("forecast_runs"\)[\s\S]{0,200}\.update\(/);
  assert.match(
    collector,
    /const overallMs = options\.overallMs \?\? 120_000/,
  );
  assert.match(collector, /terminalReserveMs = options\.terminalReserveMs \?\? 10_000/);
  assert.match(collector, /\.abortSignal\((?:work|overall)Deadline\.signal\)/);
});

test("finalization is a service-role-only row-locking RPC", () => {
  const migration = readFileSync("supabase/migrations/202608240001_finalize_forecast_runs.sql", "utf8");
  assert.match(migration, /for update/i);
  assert.match(migration, /transaction_timestamp\(\)/i);
  assert.match(migration, /run_no_longer_running/i);
  assert.match(migration, /revoke all[\s\S]+from public/i);
  assert.match(migration, /grant execute[\s\S]+to service_role/i);
  assert.doesNotMatch(migration, /update\s+public\.forecast_snapshots/i);
  assert.doesNotMatch(migration, /delete\s+from\s+public\.forecast_snapshots/i);
});

test("no credential-shaped literal is committed", () => {
  assert.doesNotMatch(repositorySources, /SUPABASE_SERVICE_ROLE_KEY\s*=\s*['"][A-Za-z0-9._-]{20,}/);
  assert.doesNotMatch(repositorySources, /FORECAST_ADMIN_USER_IDS\s*=\s*[0-9a-f]{8}-[0-9a-f-]{27,}/i);
});

test("collector ships its dependency mapping with the function", () => {
  const config = JSON.parse(
    readFileSync(
      "supabase/functions/collect-forecasts/deno.json",
      "utf8",
    ),
  );
  assert.equal(
    config.imports["@supabase/supabase-js"],
    "npm:@supabase/supabase-js@2",
  );
});

test("repository checks do not rely on shell glob expansion", () => {
  const packageJson = JSON.parse(readFileSync("package.json", "utf8"));
  assert.doesNotMatch(packageJson.scripts.check, /js\/\*\.js/);
  assert.doesNotMatch(packageJson.scripts.test, /tests\/\*\.test\.js/);
  assert.match(packageJson.scripts.test, /scripts\/test-node\.mjs/);
});
