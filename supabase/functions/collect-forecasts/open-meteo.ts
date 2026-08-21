import { normalizeResponse } from "./normalize.ts";
import { localDate } from "./time.ts";
import { NormalizedDailyForecast, ProviderError } from "./types.ts";

export const OPEN_METEO_ENDPOINT = "https://api.open-meteo.com/v1/forecast";
export const DAILY_VARIABLES = [
  "temperature_2m_min",
  "temperature_2m_max",
  "precipitation_sum",
  "precipitation_probability_max",
  "wind_speed_10m_max",
  "weather_code",
];

export function buildForecastUrl(
  latitude: number,
  longitude: number,
  timezone: string,
): URL {
  if (
    !Number.isFinite(latitude) ||
    latitude < -90 ||
    latitude > 90 ||
    !Number.isFinite(longitude) ||
    longitude < -180 ||
    longitude > 180
  )
    throw new ProviderError("invalid_location", false);
  try {
    new Intl.DateTimeFormat("en", { timeZone: timezone }).format();
  } catch {
    throw new ProviderError("invalid_timezone", false);
  }
  const url = new URL(OPEN_METEO_ENDPOINT);
  url.search = new URLSearchParams({
    latitude: String(latitude),
    longitude: String(longitude),
    timezone,
    forecast_days: "8",
    daily: DAILY_VARIABLES.join(","),
    temperature_unit: "celsius",
    precipitation_unit: "mm",
    wind_speed_unit: "kmh",
  }).toString();
  return url;
}

function retryAfter(response: Response): number | undefined {
  const value = response.headers.get("retry-after");
  if (!value) return undefined;
  const seconds = Number(value);
  const delay = Number.isFinite(seconds)
    ? seconds * 1000
    : Date.parse(value) - Date.now();
  return Number.isFinite(delay) ? Math.max(0, delay) : undefined;
}

export async function fetchForecast(
  input: { latitude: number; longitude: number; timezone: string },
  signal: AbortSignal,
  fetcher: typeof fetch = fetch,
  clock: () => Date = () => new Date(),
): Promise<{
  days: NormalizedDailyForecast[];
  collectedAt: string;
  collectionDate: string;
}> {
  let response: Response;
  try {
    response = await fetcher(
      buildForecastUrl(input.latitude, input.longitude, input.timezone),
      { signal },
    );
  } catch (error) {
    if (
      signal.aborted ||
      (error instanceof DOMException && error.name === "AbortError")
    )
      throw new ProviderError("timeout", true);
    throw new ProviderError("network", true);
  }
  if (!response.ok) {
    if (response.status === 429)
      throw new ProviderError("rate_limited", true, retryAfter(response));
    if (response.status >= 500)
      throw new ProviderError("provider_5xx", true, retryAfter(response));
    throw new ProviderError("invalid_request", false);
  }
  let body: unknown;
  try {
    body = await response.json();
  } catch {
    throw new ProviderError("response_contract", false);
  }
  const collectedAt = clock().toISOString();
  const collectionDate = localDate(new Date(collectedAt), input.timezone);
  return {
    days: normalizeResponse(body, collectionDate),
    collectedAt,
    collectionDate,
  };
}
