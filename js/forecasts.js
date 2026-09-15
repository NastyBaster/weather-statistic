import { getSupabaseClient } from "./supabase-client.js";

const FIELDS = "id,location_id,forecast_run_id,collected_at,collection_date,target_date,temperature_min,temperature_max,precipitation_sum,precipitation_probability,wind_speed_max,weather_code";

export class ForecastError extends Error {
  constructor(message, code = "FORECAST_ERROR") {
    super(message);
    this.name = "ForecastError";
    this.code = code;
  }
}

export function normalizeForecast(row) {
  return {
    id: row.id,
    locationId: row.location_id,
    forecastRunId: row.forecast_run_id,
    collectedAt: row.collected_at,
    collectionDate: row.collection_date,
    targetDate: row.target_date,
    temperatureMin: row.temperature_min == null ? null : Number(row.temperature_min),
    temperatureMax: row.temperature_max == null ? null : Number(row.temperature_max),
    precipitationSum: row.precipitation_sum == null ? null : Number(row.precipitation_sum),
    precipitationProbability: row.precipitation_probability == null ? null : Number(row.precipitation_probability),
    windSpeedMax: row.wind_speed_max == null ? null : Number(row.wind_speed_max),
    weatherCode: row.weather_code == null ? null : Number(row.weather_code),
  };
}

export function createForecastsRepository(getClient = getSupabaseClient) {
  return {
    async getUserForecasts(locationIds) {
      if (!locationIds.length) return [];
      const client = await getClient();
      const { data: userData, error: userError } = await client.auth.getUser();
      if (userError || !userData.user) throw new ForecastError("Увійдіть, щоб переглядати прогнози.", "AUTH_REQUIRED");
      const { data, error } = await client
        .from("forecast_snapshots")
        .select(FIELDS)
        .in("location_id", locationIds)
        .order("target_date", { ascending: true })
        .order("collected_at", { ascending: false });
      if (error) throw new ForecastError("Не вдалося завантажити реальні прогнози.", "FETCH_FAILED");
      return (data ?? []).map(normalizeForecast);
    },
  };
}

const repository = createForecastsRepository();
export const getUserForecasts = (...args) => repository.getUserForecasts(...args);
