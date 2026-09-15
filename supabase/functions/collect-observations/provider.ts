import { ProviderError } from "../collect-forecasts/types.ts";

export const OPEN_METEO_ARCHIVE_ENDPOINT =
  "https://archive-api.open-meteo.com/v1/archive";
export const DAILY_VARIABLES = [
  "temperature_2m_min",
  "temperature_2m_max",
  "precipitation_sum",
  "wind_speed_10m_max",
  "weather_code",
];

export type Observation = {
  observationDate: string;
  temperatureMin: number | null;
  temperatureMax: number | null;
  precipitationSum: number | null;
  windSpeedMax: number | null;
  weatherCode: number | null;
};

function fail(code: string): never {
  throw new ProviderError(code as never, false);
}

export function buildArchiveUrl(
  latitude: number,
  longitude: number,
  timezone: string,
  observationDate: string,
): URL {
  if (!Number.isFinite(latitude) || latitude < -90 || latitude > 90) {
    return fail("invalid_location");
  }
  if (!Number.isFinite(longitude) || longitude < -180 || longitude > 180) {
    return fail("invalid_location");
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(observationDate)) {
    return fail("invalid_date");
  }
  try {
    new Intl.DateTimeFormat("en", { timeZone: timezone }).format();
  } catch {
    return fail("invalid_timezone");
  }
  const url = new URL(OPEN_METEO_ARCHIVE_ENDPOINT);
  url.search = new URLSearchParams({
    latitude: String(latitude),
    longitude: String(longitude),
    timezone,
    start_date: observationDate,
    end_date: observationDate,
    daily: DAILY_VARIABLES.join(","),
    temperature_unit: "celsius",
    precipitation_unit: "mm",
    wind_speed_unit: "kmh",
  }).toString();
  return url;
}

function number(value: unknown): number | null {
  if (value === null) return null;
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return fail("response_contract");
  }
  return value;
}

export function normalizeObservation(
  value: unknown,
  expectedDate: string,
): Observation {
  if (!value || typeof value !== "object") return fail("response_contract");
  const root = value as Record<string, unknown>;
  const daily = root.daily as Record<string, unknown> | undefined;
  const units = root.daily_units as Record<string, unknown> | undefined;
  if (
    !daily || !units || !Array.isArray(daily.time) || daily.time.length !== 1
  ) {
    return fail("response_contract");
  }
  if (daily.time[0] !== expectedDate) return fail("response_contract");
  const requiredUnits: Record<string, string> = {
    time: "iso8601",
    temperature_2m_min: "°c",
    temperature_2m_max: "°c",
    precipitation_sum: "mm",
    wind_speed_10m_max: "km/h",
    weather_code: "wmo code",
  };
  for (const [key, expected] of Object.entries(requiredUnits)) {
    if (
      typeof units[key] !== "string" || units[key].toLowerCase() !== expected
    ) {
      return fail("response_contract");
    }
  }
  for (const field of DAILY_VARIABLES) {
    if (!Array.isArray(daily[field]) || daily[field].length !== 1) {
      return fail("response_contract");
    }
  }
  const values = Object.fromEntries(
    DAILY_VARIABLES.map((field) => [field, daily[field] as unknown[]]),
  );
  const observation = {
    observationDate: expectedDate,
    temperatureMin: number(values.temperature_2m_min[0]),
    temperatureMax: number(values.temperature_2m_max[0]),
    precipitationSum: number(values.precipitation_sum[0]),
    windSpeedMax: number(values.wind_speed_10m_max[0]),
    weatherCode: number(values.weather_code[0]),
  };
  if (
    observation.temperatureMin !== null &&
    (observation.temperatureMin < -150 || observation.temperatureMin > 100)
  ) return fail("response_contract");
  if (
    observation.temperatureMax !== null &&
    (observation.temperatureMax < -150 || observation.temperatureMax > 100)
  ) return fail("response_contract");
  if (
    observation.temperatureMin !== null &&
    observation.temperatureMax !== null &&
    observation.temperatureMin > observation.temperatureMax
  ) return fail("response_contract");
  if (
    observation.precipitationSum !== null && observation.precipitationSum < 0
  ) return fail("response_contract");
  if (observation.windSpeedMax !== null && observation.windSpeedMax < 0) {
    return fail("response_contract");
  }
  if (
    observation.weatherCode !== null &&
    (!Number.isInteger(observation.weatherCode) ||
      observation.weatherCode < 0 || observation.weatherCode > 99)
  ) return fail("response_contract");
  if (Object.values(observation).slice(1).every((item) => item === null)) {
    return fail("response_contract");
  }
  return observation;
}

export async function fetchObservation(
  input: {
    latitude: number;
    longitude: number;
    timezone: string;
    observationDate: string;
  },
  signal: AbortSignal,
  fetcher: typeof fetch = fetch,
): Promise<Observation> {
  let response: Response;
  try {
    response = await fetcher(
      buildArchiveUrl(
        input.latitude,
        input.longitude,
        input.timezone,
        input.observationDate,
      ),
      { signal },
    );
  } catch {
    throw new ProviderError("network", true);
  }
  if (!response.ok) {
    if (response.status === 429) throw new ProviderError("rate_limited", true);
    if (response.status >= 500) throw new ProviderError("provider_5xx", true);
    throw new ProviderError("invalid_request", false);
  }
  try {
    return normalizeObservation(await response.json(), input.observationDate);
  } catch (error) {
    if (error instanceof ProviderError) throw error;
    throw new ProviderError("response_contract", false);
  }
}
