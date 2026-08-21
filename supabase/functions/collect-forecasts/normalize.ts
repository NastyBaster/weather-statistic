import { calendarDays } from "./time.ts";
import { NormalizedDailyForecast, ProviderError } from "./types.ts";

const fields = [
  "temperature_2m_min",
  "temperature_2m_max",
  "precipitation_sum",
  "precipitation_probability_max",
  "wind_speed_10m_max",
  "weather_code",
] as const;
const expectedUnits: Record<string, string[]> = {
  time: ["iso8601"],
  temperature_2m_min: ["°c"],
  temperature_2m_max: ["°c"],
  precipitation_sum: ["mm"],
  precipitation_probability_max: ["%"],
  wind_speed_10m_max: ["km/h"],
  weather_code: ["wmo code", "wmo_code"],
};
const fail = () => {
  throw new ProviderError("response_contract", false);
};

export function normalizeResponse(
  value: unknown,
  collectionDate: string,
): NormalizedDailyForecast[] {
  if (!value || typeof value !== "object") return fail();
  const root = value as Record<string, unknown>;
  const daily = root.daily as Record<string, unknown> | undefined;
  const units = root.daily_units as Record<string, unknown> | undefined;
  if (!daily || !units || !Array.isArray(daily.time)) return fail();
  for (const [key, allowed] of Object.entries(expectedUnits))
    if (
      typeof units[key] !== "string" ||
      !allowed.includes((units[key] as string).toLowerCase())
    )
      return fail();
  const length = daily.time.length;
  for (const field of fields)
    if (
      !Array.isArray(daily[field]) ||
      (daily[field] as unknown[]).length !== length
    )
      return fail();
  return daily.time.map((date, index) => {
    if (
      typeof date !== "string" ||
      !/^\d{4}-\d{2}-\d{2}$/.test(date) ||
      Number.isNaN(Date.parse(`${date}T00:00:00Z`))
    )
      return fail();
    const lead = calendarDays(collectionDate, date);
    if (!Number.isInteger(lead) || lead < 0 || lead > 16) return fail();
    const number = (field: (typeof fields)[number]): number | null => {
      const item = (daily[field] as unknown[])[index];
      if (item === null) return null;
      if (typeof item !== "number" || !Number.isFinite(item)) return fail();
      return item;
    };
    const result: NormalizedDailyForecast = {
      targetDate: date,
      temperatureMin: number("temperature_2m_min"),
      temperatureMax: number("temperature_2m_max"),
      precipitationSum: number("precipitation_sum"),
      precipitationProbability: number("precipitation_probability_max"),
      windSpeedMax: number("wind_speed_10m_max"),
      weatherCode: number("weather_code"),
    };
    if (
      result.temperatureMin !== null &&
      (result.temperatureMin < -150 || result.temperatureMin > 100)
    )
      return fail();
    if (
      result.temperatureMax !== null &&
      (result.temperatureMax < -150 || result.temperatureMax > 100)
    )
      return fail();
    if (
      result.temperatureMin !== null &&
      result.temperatureMax !== null &&
      result.temperatureMin > result.temperatureMax
    )
      return fail();
    if (result.precipitationSum !== null && result.precipitationSum < 0)
      return fail();
    if (result.windSpeedMax !== null && result.windSpeedMax < 0) return fail();
    if (
      result.precipitationProbability !== null &&
      (!Number.isInteger(result.precipitationProbability) ||
        result.precipitationProbability < 0 ||
        result.precipitationProbability > 100)
    )
      return fail();
    if (
      result.weatherCode !== null &&
      (!Number.isInteger(result.weatherCode) ||
        result.weatherCode < 0 ||
        result.weatherCode > 99)
    )
      return fail();
    if (
      Object.values(result)
        .slice(1)
        .every((item) => item === null)
    )
      return fail();
    return result;
  });
}
