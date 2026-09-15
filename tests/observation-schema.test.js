import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import test from "node:test";

const migrationName = "202609150003_create_observation_contract.sql";
const migrationPath = new URL(`../supabase/migrations/${migrationName}`, import.meta.url);
const sql = await readFile(migrationPath, "utf8");

test("observation schema is introduced by a new migration after the forecast contract", async () => {
  const migrations = await readdir(new URL("../supabase/migrations/", import.meta.url));
  assert.ok(migrations.includes(migrationName));
  assert.ok(migrations.includes("202609150002_restrict_forecast_health_privileges.sql"));
  assert.ok(migrations.indexOf(migrationName) > migrations.indexOf("202609150002_restrict_forecast_health_privileges.sql"));
});

test("observations have daily identity, provenance, and normalized value constraints", () => {
  assert.match(sql, /create table public\.weather_observations/);
  assert.match(sql, /provider text not null default 'open-meteo'/);
  assert.match(sql, /collected_at timestamptz not null/);
  assert.match(sql, /observation_date date not null/);
  assert.match(sql, /unique \(location_id, provider, observation_date\)/);
  assert.match(sql, /temperature_min between -150 and 100/);
  assert.match(sql, /temperature_min <= temperature_max/);
  assert.match(sql, /precipitation_sum is null or precipitation_sum >= 0/);
  assert.match(sql, /wind_speed_max is null or wind_speed_max >= 0/);
  assert.match(sql, /weather_code is null or weather_code between 0 and 99/);
  assert.match(sql, /num_nonnulls\([\s\S]*weather_code[\s\S]*\) > 0/);
});

test("observation ownership and immutability are database boundaries", () => {
  assert.match(sql, /references public\.locations \(id\) on delete cascade/);
  assert.match(sql, /before update on public\.weather_observations/);
  assert.match(sql, /alter table public\.weather_observations enable row level security/);
  assert.match(sql, /locations\.user_id = \(select auth\.uid\(\)\)/);
  assert.match(sql, /grant select on public\.weather_observations to authenticated/);
  assert.doesNotMatch(sql, /grant (insert|update|delete)[^;]*weather_observations/i);
  assert.doesNotMatch(sql, /to anon/);
  assert.doesNotMatch(sql, /before (update or delete|delete or update|delete) on public\.weather_observations/);
});
