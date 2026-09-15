import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const migration = readFileSync(
  "supabase/migrations/202609150001_add_forecast_collection_health.sql",
  "utf8",
);
const privilegeMigration = readFileSync(
  "supabase/migrations/202609150002_restrict_forecast_health_privileges.sql",
  "utf8",
);

test("forecast health RPC exposes only sanitized scheduled-run signals", () => {
  assert.match(migration, /create function public\.get_forecast_collection_health\(/);
  assert.match(migration, /returns table \(/);
  assert.match(migration, /latest_scheduled_status text/);
  assert.match(migration, /running_scheduled_count bigint/);
  assert.match(migration, /missing_scheduled_acceptance boolean/);
  assert.match(migration, /where trigger_type = 'scheduled'/);
  assert.match(migration, /interval '4 hours 17 minutes'/);
  assert.match(migration, /interval '2 hours'/);
  assert.match(migration, /forecast_health_forbidden/);
  assert.match(migration, /grant execute on function public\.get_forecast_collection_health\(timestamptz\) to service_role/);
  assert.doesNotMatch(migration, /raw|stack|authorization|secret|jwt|response body/i);
});

test("forecast health RPC has no browser privilege", () => {
  assert.match(migration, /revoke all on function public\.get_forecast_collection_health\(timestamptz\) from public/);
  assert.doesNotMatch(migration, /grant execute on function public\.get_forecast_collection_health\(timestamptz\) to (anon|authenticated)/);
  assert.match(privilegeMigration, /from public, anon, authenticated/);
  assert.match(privilegeMigration, /to service_role/);
});
