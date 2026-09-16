import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { createAccuracyRepository, normalizeAccuracy } from "../js/accuracy.js";

const migrationName = "202609150004_create_accuracy_read_model.sql";
const migrationPath = new URL(`../supabase/migrations/${migrationName}`, import.meta.url);
const sql = await readFile(migrationPath, "utf8");

const row = {
  location_id: "location-1",
  lead_days: 3,
  forecast_collection_date_min: "2026-08-01",
  forecast_collection_date_max: "2026-08-30",
  target_date_min: "2026-08-04",
  target_date_max: "2026-09-02",
  observation_providers: ["open-meteo"],
  temperature_min_n: 12,
  temperature_min_mae: 1.25,
  temperature_min_bias: -0.5,
  temperature_min_status: "provisional",
  temperature_max_n: 30,
  temperature_max_mae: 1.5,
  temperature_max_bias: 0.2,
  temperature_max_status: "reliable",
  wind_speed_max_n: 0,
  wind_speed_max_mae: null,
  wind_speed_max_bias: null,
  wind_speed_max_status: "insufficient",
  precipitation_sum_n: 12,
  precipitation_sum_mae: 2,
  precipitation_sum_bias: 0.75,
  precipitation_sum_status: "provisional",
  rain_event_n: 12,
  rain_tp: 4,
  rain_fp: 2,
  rain_fn: 1,
  rain_tn: 5,
  rain_precision: 2 / 3,
  rain_precision_reason: null,
  rain_recall: 0.8,
  rain_recall_reason: null,
  rain_false_alarm_rate: 0.2857142857,
  rain_false_alarm_rate_reason: null,
  rain_event_status: "provisional",
};

test("accuracy read model is a new RLS-scoped security-invoker view", () => {
  assert.match(sql, /create view public\.forecast_accuracy[\s\S]*security_invoker = true/i);
  assert.match(sql, /snapshots\.lead_days in \(1, 3, 5, 7\)/i);
  assert.match(sql, /observations\.observation_date = snapshots\.target_date/i);
  assert.match(sql, /locations\.user_id = \(select auth\.uid\(\)\)/i);
  assert.match(sql, /array_agg\(distinct observation_provider order by observation_provider\)/i);
  assert.match(sql, /min\(collection_date\) as forecast_collection_date_min/i);
  assert.match(sql, /rain_precision_reason/);
  assert.match(sql, /rain_recall_reason/);
  assert.match(sql, /rain_false_alarm_rate_reason/);
  assert.match(sql, /grant select on public\.forecast_accuracy to authenticated/i);
  assert.doesNotMatch(sql, /grant select on public\.forecast_accuracy to anon/i);
});

test("accuracy read model keeps event counts, numeric metrics, and per-metric status", () => {
  for (const field of [
    "temperature_min_mae",
    "temperature_min_bias",
    "precipitation_sum_mae",
    "rain_tp",
    "rain_fp",
    "rain_fn",
    "rain_tn",
    "rain_precision",
    "rain_recall",
    "rain_false_alarm_rate",
    "rain_event_status",
  ]) assert.match(sql, new RegExp(field));
  assert.match(sql, /precipitation_probability >= 50/);
  assert.match(sql, /observed_precipitation_sum >= 1/);
  assert.match(sql, /when rain_actual_events < 5 or rain_actual_non_events < 5 then 'insufficient'/i);
});

test("accuracy read model exposes stable reasons for undefined rain ratios", () => {
  assert.match(sql, /'no_predicted_events' else null end as rain_precision_reason/i);
  assert.match(sql, /'no_actual_events' else null end as rain_recall_reason/i);
  assert.match(sql, /'no_actual_non_events' else null end as rain_false_alarm_rate_reason/i);
});

test("normalizes the read model without turning null metrics into zero", () => {
  assert.deepEqual(normalizeAccuracy(row), {
    locationId: "location-1",
    leadDays: 3,
    provenance: {
      forecastCollectionDateMin: "2026-08-01",
      forecastCollectionDateMax: "2026-08-30",
      targetDateMin: "2026-08-04",
      targetDateMax: "2026-09-02",
      observationProviders: ["open-meteo"],
    },
    temperatureMin: { n: 12, mae: 1.25, bias: -0.5, status: "provisional" },
    temperatureMax: { n: 30, mae: 1.5, bias: 0.2, status: "reliable" },
    windSpeedMax: { n: 0, mae: null, bias: null, status: "insufficient" },
    precipitationSum: { n: 12, mae: 2, bias: 0.75, status: "provisional" },
    rainEvents: {
      n: 12,
      tp: 4,
      fp: 2,
      fn: 1,
      tn: 5,
      precision: 2 / 3,
      precisionReason: null,
      recall: 0.8,
      recallReason: null,
      falseAlarmRate: 0.2857142857,
      falseAlarmRateReason: null,
      status: "provisional",
    },
  });
});

test("accuracy repository requires auth, scopes locations, and requests supported leads", async () => {
  const calls = [];
  const client = {
    auth: { getUser: async () => ({ data: { user: { id: "user-1" } }, error: null }) },
    from(table) {
      calls.push(["from", table]);
      const query = {
        select(fields) { calls.push(["select", fields]); return query; },
        in(field, values) { calls.push(["in", field, values]); return query; },
        order(field, options) { calls.push(["order", field, options]); return query; },
        then(resolve) { return Promise.resolve({ data: [row], error: null }).then(resolve); },
      };
      return query;
    },
  };
  const repository = createAccuracyRepository(async () => client);
  const result = await repository.getUserAccuracy(["location-1"]);
  assert.equal(result[0].leadDays, 3);
  assert.deepEqual(calls[0], ["from", "forecast_accuracy"]);
  assert.match(calls[1][1], /forecast_collection_date_min/);
  assert.match(calls[1][1], /forecast_collection_date_max/);
  assert.match(calls[1][1], /target_date_min/);
  assert.match(calls[1][1], /target_date_max/);
  assert.match(calls[1][1], /observation_providers/);
  assert.deepEqual(calls[2], ["in", "location_id", ["location-1"]]);
  assert.deepEqual(calls[3], ["in", "lead_days", [1, 3, 5, 7]]);
});
