import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import test from "node:test";

const migrationName = "202608210001_create_forecast_contract.sql";
const migrationPath = new URL(`../supabase/migrations/${migrationName}`, import.meta.url);
const sql = await readFile(migrationPath, "utf8");

test("forecast schema is introduced by one new migration", async () => {
  const migrations = await readdir(new URL("../supabase/migrations/", import.meta.url));
  assert.ok(migrations.includes(migrationName));
  assert.deepEqual(migrations.filter((name) => name < migrationName).sort(), [
    "202608170001_create_profiles_and_locations.sql",
    "202608170002_create_profile_on_signup.sql",
  ]);
});

test("previously applied migrations retain their reviewed contents", async () => {
  const expectedHashes = new Map([
    ["202608170001_create_profiles_and_locations.sql", "8febb35a7843cb86bdaf8801ce59a208cf40db5189d43dd259604a64be9dfa9b"],
    ["202608170002_create_profile_on_signup.sql", "d683bda9b6dc29c25811e59893f5e7dbf3c882746e6bcb5eda03ab0a139ccf4a"],
  ]);

  for (const [name, expectedHash] of expectedHashes) {
    const contents = await readFile(new URL(`../supabase/migrations/${name}`, import.meta.url));
    assert.equal(createHash("sha256").update(contents).digest("hex"), expectedHash);
  }
});

test("migration defines run status, counters, and completion invariants", () => {
  assert.match(sql, /create table public\.forecast_runs/);
  assert.match(sql, /status in \('running', 'succeeded', 'partial', 'failed'\)/);
  assert.match(sql, /locations_total >= 0[\s\S]*locations_succeeded >= 0[\s\S]*locations_failed >= 0/);
  assert.match(sql, /locations_succeeded \+ locations_failed <= locations_total/);
  assert.match(sql, /status = 'running' and completed_at is null/);
  assert.match(sql, /status = 'partial'[\s\S]*locations_succeeded > 0[\s\S]*locations_failed > 0/);
  assert.match(sql, /status = 'failed'[\s\S]*locations_succeeded = 0/);
});

test("snapshots have protected dates, values, foreign keys, and identity", () => {
  assert.match(sql, /create table public\.forecast_snapshots/);
  assert.match(sql, /references public\.forecast_runs \(id\) on delete restrict/);
  assert.match(sql, /references public\.locations \(id\) on delete cascade/);
  assert.match(sql, /generated always as \(target_date - collection_date\) stored/);
  assert.match(sql, /unique \(location_id, collection_date, target_date\)/);
  assert.match(sql, /target_date >= collection_date/);
  assert.match(sql, /lead_days between 0 and 16/);
  assert.match(sql, /temperature_min between -150 and 100/);
  assert.match(sql, /temperature_min <= temperature_max/);
  assert.match(sql, /precipitation_sum >= 0/);
  assert.match(sql, /precipitation_probability between 0 and 100/);
  assert.match(sql, /wind_speed_max >= 0/);
});

test("RLS exposes only owned snapshot reads and no browser writes or run reads", () => {
  assert.match(sql, /alter table public\.forecast_runs enable row level security/);
  assert.match(sql, /alter table public\.forecast_snapshots enable row level security/);
  assert.match(sql, /locations\.user_id = \(select auth\.uid\(\)\)/);
  assert.match(sql, /grant select on public\.forecast_snapshots to authenticated/);
  assert.doesNotMatch(sql, /grant (insert|update|delete)[^;]*forecast_snapshots/i);
  assert.doesNotMatch(sql, /grant select[^;]*forecast_runs/i);
  assert.doesNotMatch(sql, /to anon/);
});

test("database update guard preserves cascade deletion semantics", () => {
  assert.match(sql, /before update on public\.forecast_snapshots/);
  assert.doesNotMatch(sql, /before (update or delete|delete or update|delete) on public\.forecast_snapshots/);
});
