import { getSupabaseClient } from "./supabase-client.js";

const FIELDS = "scope_type,location_id,lead_days,location_count,forecast_row_n,observation_row_n,observation_missing_n,forecast_collection_date_min,forecast_collection_date_max,target_date_min,target_date_max,observation_providers,temperature_min_forecast_present_n,temperature_min_observed_present_n,temperature_min_n,temperature_min_mae,temperature_min_bias,temperature_min_status,temperature_max_forecast_present_n,temperature_max_observed_present_n,temperature_max_n,temperature_max_mae,temperature_max_bias,temperature_max_status,wind_speed_max_forecast_present_n,wind_speed_max_observed_present_n,wind_speed_max_n,wind_speed_max_mae,wind_speed_max_bias,wind_speed_max_status,precipitation_sum_forecast_present_n,precipitation_sum_observed_present_n,precipitation_sum_n,precipitation_sum_mae,precipitation_sum_bias,precipitation_sum_status,rain_probability_present_n,rain_observed_precipitation_present_n,rain_event_n,rain_tp,rain_fp,rain_fn,rain_tn,rain_precision,rain_precision_reason,rain_recall,rain_recall_reason,rain_false_alarm_rate,rain_false_alarm_rate_reason,rain_event_status";
const DETAIL_FIELDS = "forecast_snapshot_id,location_id,forecast_run_id,collected_at,forecast_collection_date,target_date,lead_days,observation_id,observation_provider,forecast_temperature_min,observed_temperature_min,forecast_temperature_max,observed_temperature_max,forecast_precipitation_sum,observed_precipitation_sum,precipitation_probability,forecast_wind_speed_max,observed_wind_speed_max,observed_weather_code,observation_available";
const LEAD_DAYS = [1, 3, 5, 7];

export class AccuracyError extends Error {
  constructor(message, code = "ACCURACY_ERROR") {
    super(message);
    this.name = "AccuracyError";
    this.code = code;
  }
}

function numberOrNull(value) {
  return value == null ? null : Number(value);
}

function normalizeMetric(row, prefix) {
  return {
    forecastPresentN: Number(row[`${prefix}_forecast_present_n`] ?? 0),
    observedPresentN: Number(row[`${prefix}_observed_present_n`] ?? 0),
    n: Number(row[`${prefix}_n`] ?? 0),
    mae: numberOrNull(row[`${prefix}_mae`]),
    bias: numberOrNull(row[`${prefix}_bias`]),
    status: row[`${prefix}_status`],
  };
}

export function normalizeAccuracy(row) {
  return {
    scopeType: row.scope_type,
    locationId: row.location_id,
    leadDays: Number(row.lead_days),
    locationCount: Number(row.location_count ?? 0),
    coverage: {
      forecastRows: Number(row.forecast_row_n ?? 0),
      observationRows: Number(row.observation_row_n ?? 0),
      observationMissing: Number(row.observation_missing_n ?? 0),
    },
    provenance: {
      forecastCollectionDateMin: row.forecast_collection_date_min,
      forecastCollectionDateMax: row.forecast_collection_date_max,
      targetDateMin: row.target_date_min,
      targetDateMax: row.target_date_max,
      observationProviders: row.observation_providers ?? [],
    },
    temperatureMin: normalizeMetric(row, "temperature_min"),
    temperatureMax: normalizeMetric(row, "temperature_max"),
    windSpeedMax: normalizeMetric(row, "wind_speed_max"),
    precipitationSum: normalizeMetric(row, "precipitation_sum"),
    rainEvents: {
      n: Number(row.rain_event_n ?? 0),
      tp: Number(row.rain_tp ?? 0),
      fp: Number(row.rain_fp ?? 0),
      fn: Number(row.rain_fn ?? 0),
      tn: Number(row.rain_tn ?? 0),
      precision: numberOrNull(row.rain_precision),
      precisionReason: row.rain_precision_reason,
      recall: numberOrNull(row.rain_recall),
      recallReason: row.rain_recall_reason,
      falseAlarmRate: numberOrNull(row.rain_false_alarm_rate),
      falseAlarmRateReason: row.rain_false_alarm_rate_reason,
      status: row.rain_event_status,
    },
  };
}

export function normalizeAccuracyDetail(row) {
  return {
    forecastSnapshotId: row.forecast_snapshot_id,
    locationId: row.location_id,
    forecastRunId: row.forecast_run_id,
    collectedAt: row.collected_at,
    forecastCollectionDate: row.forecast_collection_date,
    targetDate: row.target_date,
    leadDays: Number(row.lead_days),
    observationId: row.observation_id,
    observationProvider: row.observation_provider,
    forecastTemperatureMin: numberOrNull(row.forecast_temperature_min),
    observedTemperatureMin: numberOrNull(row.observed_temperature_min),
    forecastTemperatureMax: numberOrNull(row.forecast_temperature_max),
    observedTemperatureMax: numberOrNull(row.observed_temperature_max),
    forecastPrecipitationSum: numberOrNull(row.forecast_precipitation_sum),
    observedPrecipitationSum: numberOrNull(row.observed_precipitation_sum),
    precipitationProbability: numberOrNull(row.precipitation_probability),
    forecastWindSpeedMax: numberOrNull(row.forecast_wind_speed_max),
    observedWindSpeedMax: numberOrNull(row.observed_wind_speed_max),
    observedWeatherCode: row.observed_weather_code == null ? null : Number(row.observed_weather_code),
    observationAvailable: row.observation_available === true,
  };
}

export function createAccuracyRepository(getClient = getSupabaseClient) {
  return {
    async getUserAccuracy(locationIds) {
      if (!locationIds.length) return [];
      const client = await getClient();
      const { data: userData, error: userError } = await client.auth.getUser();
      if (userError || !userData.user) {
        throw new AccuracyError("Увійдіть, щоб переглядати оцінку прогнозів.", "AUTH_REQUIRED");
      }
      const { data, error } = await client
        .from("forecast_accuracy")
        .select(FIELDS)
        .or(`location_id.in.(${locationIds.join(",")}),scope_type.eq.all_owned_locations`)
        .in("lead_days", LEAD_DAYS)
        .order("lead_days", { ascending: true });
      if (error) throw new AccuracyError("Не вдалося завантажити оцінку прогнозів.", "FETCH_FAILED");
      return (data ?? []).map(normalizeAccuracy);
    },
    async getUserAccuracyDetails(locationIds) {
      if (!locationIds.length) return [];
      const client = await getClient();
      const { data: userData, error: userError } = await client.auth.getUser();
      if (userError || !userData.user) {
        throw new AccuracyError("Увійдіть, щоб переглядати деталі оцінки прогнозів.", "AUTH_REQUIRED");
      }
      const { data, error } = await client
        .from("forecast_accuracy_detail")
        .select(DETAIL_FIELDS)
        .in("location_id", locationIds)
        .in("lead_days", LEAD_DAYS)
        .order("target_date", { ascending: true })
        .order("lead_days", { ascending: true });
      if (error) throw new AccuracyError("Не вдалося завантажити деталі оцінки прогнозів.", "FETCH_FAILED");
      return (data ?? []).map(normalizeAccuracyDetail);
    },
  };
}

const repository = createAccuracyRepository();
export const getUserAccuracy = (...args) => repository.getUserAccuracy(...args);
export const getUserAccuracyDetails = (...args) => repository.getUserAccuracyDetails(...args);
