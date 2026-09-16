import { getSupabaseClient } from "./supabase-client.js";

const FIELDS = "location_id,lead_days,forecast_collection_date_min,forecast_collection_date_max,target_date_min,target_date_max,observation_providers,temperature_min_n,temperature_min_mae,temperature_min_bias,temperature_min_status,temperature_max_n,temperature_max_mae,temperature_max_bias,temperature_max_status,wind_speed_max_n,wind_speed_max_mae,wind_speed_max_bias,wind_speed_max_status,precipitation_sum_n,precipitation_sum_mae,precipitation_sum_bias,precipitation_sum_status,rain_event_n,rain_tp,rain_fp,rain_fn,rain_tn,rain_precision,rain_precision_reason,rain_recall,rain_recall_reason,rain_false_alarm_rate,rain_false_alarm_rate_reason,rain_event_status";
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
    n: Number(row[`${prefix}_n`] ?? 0),
    mae: numberOrNull(row[`${prefix}_mae`]),
    bias: numberOrNull(row[`${prefix}_bias`]),
    status: row[`${prefix}_status`],
  };
}

export function normalizeAccuracy(row) {
  return {
    locationId: row.location_id,
    leadDays: Number(row.lead_days),
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
        .in("location_id", locationIds)
        .in("lead_days", LEAD_DAYS)
        .order("lead_days", { ascending: true });
      if (error) throw new AccuracyError("Не вдалося завантажити оцінку прогнозів.", "FETCH_FAILED");
      return (data ?? []).map(normalizeAccuracy);
    },
  };
}

const repository = createAccuracyRepository();
export const getUserAccuracy = (...args) => repository.getUserAccuracy(...args);
