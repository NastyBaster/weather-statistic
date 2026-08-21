import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

const files = (directory) => readdirSync(directory, { withFileTypes: true }).flatMap((entry) => entry.isDirectory() ? files(join(directory, entry.name)) : [join(directory, entry.name)]);
const frontend = files("js").map((path) => readFileSync(path, "utf8")).join("\n");
const repositorySources = files(".").filter((path) => !path.startsWith(".git/") && !path.startsWith("dist/")).map((path) => readFileSync(path, "utf8")).join("\n");

test("collector trust boundary remains outside frontend", () => {
  assert.doesNotMatch(frontend, /api\.open-meteo\.com/i);
  assert.doesNotMatch(frontend, /SUPABASE_SERVICE_ROLE_KEY/);
  assert.doesNotMatch(frontend, /forecast_snapshots[\s\S]{0,100}\.(?:insert|upsert|update|delete)\(/);
});

test("stage 5.1 adds neither scheduler nor actual-weather schema", () => {
  const operationalFiles = [...files("supabase"), ...files(".github")].map((path) => readFileSync(path, "utf8")).join("\n");
  assert.doesNotMatch(operationalFiles, /create\s+table\s+(?:public\.)?weather_observations/i);
  assert.doesNotMatch(operationalFiles, /(?:cron\.schedule|pg_cron)/i);
});

test("no credential-shaped literal is committed", () => {
  assert.doesNotMatch(repositorySources, /SUPABASE_SERVICE_ROLE_KEY\s*=\s*['"][A-Za-z0-9._-]{20,}/);
  assert.doesNotMatch(repositorySources, /FORECAST_ADMIN_USER_IDS\s*=\s*[0-9a-f]{8}-[0-9a-f-]{27,}/i);
});
