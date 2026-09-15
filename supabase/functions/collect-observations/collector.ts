import { fetchObservation } from "./provider.ts";
import { ProviderError } from "../collect-forecasts/types.ts";
import { withRetry } from "../collect-forecasts/retry.ts";

// deno-lint-ignore no-explicit-any -- narrowed Supabase's fluent client boundary.
type Db = { from(table: string): any };
type Location = {
  id: string;
  latitude: number;
  longitude: number;
  timezone: string;
};
export type ObservationResult = {
  status: "succeeded" | "partial" | "failed";
  observationDate: string;
  locationsTotal: number;
  locationsSucceeded: number;
  locationsFailed: number;
  observationsAttempted: number;
  observationsInserted: number;
  errorCategories?: string[];
};

function previousLocalDate(timezone: string, now = new Date()): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now).reduce<Record<string, string>>((result, part) => {
    if (part.type !== "literal") result[part.type] = part.value;
    return result;
  }, {});
  const utc = new Date(
    Date.UTC(
      Number(parts.year),
      Number(parts.month) - 1,
      Number(parts.day) - 1,
    ),
  );
  return utc.toISOString().slice(0, 10);
}

export async function collectObservations(
  db: Db,
  provider = fetchObservation,
  now = new Date(),
): Promise<ObservationResult> {
  const { data, error } = await db.from("locations").select(
    "id,latitude,longitude,timezone",
  ).eq("is_active", true);
  if (error) throw new Error("locations_unavailable");
  const locations = (data ?? []) as Location[];
  if (locations.length === 0) {
    return {
      status: "succeeded",
      observationDate: "",
      locationsTotal: 0,
      locationsSucceeded: 0,
      locationsFailed: 0,
      observationsAttempted: 0,
      observationsInserted: 0,
    };
  }
  let succeeded = 0;
  let failed = 0;
  let attempted = 0;
  let inserted = 0;
  const categories = new Set<string>();
  for (const location of locations) {
    const observationDate = previousLocalDate(location.timezone, now);
    try {
      const observation = await withRetry(
        (signal) => provider({ ...location, observationDate }, signal),
      );
      attempted++;
      const { data: insertedRows, error: insertError } = await db.from(
        "weather_observations",
      )
        .upsert({
          location_id: location.id,
          provider: "open-meteo",
          collected_at: now.toISOString(),
          observation_date: observation.observationDate,
          temperature_min: observation.temperatureMin,
          temperature_max: observation.temperatureMax,
          precipitation_sum: observation.precipitationSum,
          wind_speed_max: observation.windSpeedMax,
          weather_code: observation.weatherCode,
        }, {
          onConflict: "location_id,provider,observation_date",
          ignoreDuplicates: true,
        }).select("id");
      if (insertError) throw new Error("storage");
      inserted += insertedRows?.length ?? 0;
      succeeded++;
    } catch (error) {
      failed++;
      categories.add(error instanceof ProviderError ? error.code : "storage");
    }
  }
  return {
    status: failed === 0 ? "succeeded" : succeeded === 0 ? "failed" : "partial",
    observationDate: previousLocalDate(locations[0].timezone, now),
    locationsTotal: locations.length,
    locationsSucceeded: succeeded,
    locationsFailed: failed,
    observationsAttempted: attempted,
    observationsInserted: inserted,
    ...(categories.size ? { errorCategories: [...categories].sort() } : {}),
  };
}
