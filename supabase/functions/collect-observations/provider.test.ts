import { assertEquals, assertThrows } from "@std/assert";
import { buildArchiveUrl, normalizeObservation } from "./provider.ts";

const body = {
  daily_units: {
    time: "iso8601",
    temperature_2m_min: "°C",
    temperature_2m_max: "°C",
    precipitation_sum: "mm",
    wind_speed_10m_max: "km/h",
    weather_code: "WMO code",
  },
  daily: {
    time: ["2026-09-15"],
    temperature_2m_min: [10],
    temperature_2m_max: [22],
    precipitation_sum: [1.2],
    wind_speed_10m_max: [18],
    weather_code: [2],
  },
};

Deno.test("builds a bounded archive request", () => {
  const url = buildArchiveUrl(49.84, 24.03, "Europe/Kyiv", "2026-09-15");
  assertEquals(url.origin, "https://archive-api.open-meteo.com");
  assertEquals(url.searchParams.get("start_date"), "2026-09-15");
  assertEquals(url.searchParams.get("end_date"), "2026-09-15");
  assertEquals(
    url.searchParams.get("daily"),
    "temperature_2m_min,temperature_2m_max,precipitation_sum,wind_speed_10m_max,weather_code",
  );
});

Deno.test("normalizes the one-day archive response", () => {
  assertEquals(normalizeObservation(body, "2026-09-15"), {
    observationDate: "2026-09-15",
    temperatureMin: 10,
    temperatureMax: 22,
    precipitationSum: 1.2,
    windSpeedMax: 18,
    weatherCode: 2,
  });
});

Deno.test("rejects a response for a different day", () => {
  assertThrows(() => normalizeObservation(body, "2026-09-16"));
});
