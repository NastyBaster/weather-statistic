import assert from "node:assert/strict";
import test from "node:test";
import { createForecastsRepository, normalizeForecast } from "../js/forecasts.js";

const row = {
  id: "snapshot-1",
  location_id: "location-1",
  forecast_run_id: "run-1",
  collected_at: "2026-09-15T04:20:00Z",
  collection_date: "2026-09-15",
  target_date: "2026-09-16",
  temperature_min: 12,
  temperature_max: 24,
  precipitation_sum: null,
  precipitation_probability: 35,
  wind_speed_max: 18,
  weather_code: 2,
};

test("normalizes a real forecast snapshot without adding actual-weather data", () => {
  assert.deepEqual(normalizeForecast(row), {
    id: "snapshot-1",
    locationId: "location-1",
    forecastRunId: "run-1",
    collectedAt: "2026-09-15T04:20:00Z",
    collectionDate: "2026-09-15",
    targetDate: "2026-09-16",
    temperatureMin: 12,
    temperatureMax: 24,
    precipitationSum: null,
    precipitationProbability: 35,
    windSpeedMax: 18,
    weatherCode: 2,
  });
});

test("forecast repository scopes the query to the authenticated user's locations", async () => {
  const calls = [];
  const client = {
    auth: { getUser: async () => ({ data: { user: { id: "user-1" } }, error: null }) },
    from: (table) => {
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
  const repository = createForecastsRepository(async () => client);
  const result = await repository.getUserForecasts(["location-1"]);
  assert.equal(result[0].locationId, "location-1");
  assert.deepEqual(calls[2], ["in", "location_id", ["location-1"]]);
});
