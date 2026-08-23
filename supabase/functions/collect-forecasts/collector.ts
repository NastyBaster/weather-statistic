import { fetchForecast } from "./open-meteo.ts";
import { withRetry } from "./retry.ts";
import { Location, LocationGroup, ProviderError } from "./types.ts";

// deno-lint-ignore no-explicit-any -- narrowed PostgREST's fluent client boundary.
type Db = { from(table: string): any; rpc(name: string, args: unknown): any };
type GroupOutcome = {
  succeeded: number;
  failed: number;
  snapshots: number;
  code?: string;
};

export function groupLocations(locations: Location[]): LocationGroup[] {
  const groups = new Map<string, LocationGroup>();
  for (const location of locations) {
    const key = JSON.stringify([
      location.latitude,
      location.longitude,
      location.timezone,
    ]);
    const group = groups.get(key) ?? {
      key,
      latitude: location.latitude,
      longitude: location.longitude,
      timezone: location.timezone,
      locations: [],
    };
    group.locations.push(location);
    groups.set(key, group);
  }
  return [...groups.values()];
}
export async function mapConcurrent<T, R>(
  values: T[],
  limit: number,
  worker: (value: T) => Promise<R>,
): Promise<R[]> {
  if (!Number.isInteger(limit) || limit < 1) {
    throw new Error("invalid concurrency");
  }
  const results = new Array<R>(values.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, values.length) }, async () => {
      while (true) {
        const index = next++;
        if (index >= values.length) return;
        results[index] = await worker(values[index]);
      }
    }),
  );
  return results;
}
export function terminalStatus(
  success: number,
  failed: number,
): "succeeded" | "partial" | "failed" {
  return success === 0 && failed > 0
    ? "failed"
    : failed > 0
    ? "partial"
    : "succeeded";
}

export async function collect(
  db: Db,
  now: () => Date = () => new Date(),
  provider = fetchForecast,
  triggerType: "manual" | "scheduled" = "manual",
) {
  const deadline = new AbortController();
  const deadlineTimer = setTimeout(() => deadline.abort(), 120_000);
  const startedAt = now().toISOString();
  const { data, error: locationError } = await db
    .from("locations")
    .select("id,latitude,longitude,timezone")
    .eq("is_active", true)
    .abortSignal(deadline.signal);
  if (locationError) {
    clearTimeout(deadlineTimer);
    throw new Error("active locations could not be read");
  }
  const locations = (data ?? []) as Location[];
  const claim = triggerType === "scheduled"
    ? await db.rpc("claim_scheduled_forecast_run", {
      requested_locations_total: locations.length,
    }).abortSignal(deadline.signal)
    : await db.from("forecast_runs").insert({
      trigger_type: "manual",
      status: "running",
      started_at: startedAt,
      locations_total: locations.length,
    }).select("id").single().abortSignal(deadline.signal);
  const run = triggerType === "scheduled" ? claim.data?.[0] : claim.data;
  const runError = claim.error;
  if (triggerType === "scheduled" && run?.result === "scheduled_run_active") {
    clearTimeout(deadlineTimer);
    return "scheduled_run_active" as const;
  }
  if (runError || !run) {
    clearTimeout(deadlineTimer);
    throw new Error("forecast run could not be created");
  }
  const runId = triggerType === "scheduled" ? run.run_id : run.id;
  let succeeded = 0,
    failed = 0,
    snapshots = 0;
  const errors: string[] = [];
  try {
    const outcomes = await mapConcurrent<LocationGroup, GroupOutcome>(
      groupLocations(locations),
      4,
      async (group) => {
        try {
          if (deadline.signal.aborted) {
            throw new ProviderError("timeout", false);
          }
          const response = await withRetry(
            (signal) =>
              provider(
                {
                  latitude: group.latitude,
                  longitude: group.longitude,
                  timezone: group.timezone,
                },
                signal,
              ),
            { signal: deadline.signal },
          );
          const rows = group.locations.flatMap((location) =>
            response.days.map((day) => ({
              forecast_run_id: runId,
              location_id: location.id,
              collected_at: response.collectedAt,
              collection_date: response.collectionDate,
              target_date: day.targetDate,
              temperature_min: day.temperatureMin,
              temperature_max: day.temperatureMax,
              precipitation_sum: day.precipitationSum,
              precipitation_probability: day.precipitationProbability,
              wind_speed_max: day.windSpeedMax,
              weather_code: day.weatherCode,
            }))
          );
          const { data, error } = await db.rpc(
            "insert_forecast_snapshot_batch",
            {
              requested_run_id: runId,
              requested_rows: rows,
            },
          ).abortSignal(deadline.signal);
          if (error) throw new Error("snapshot insert failed");
          return {
            succeeded: group.locations.length,
            failed: 0,
            snapshots: data?.[0]?.inserted_count ?? 0,
          };
        } catch (error) {
          return {
            succeeded: 0,
            failed: group.locations.length,
            snapshots: 0,
            code: error instanceof ProviderError ? error.code : "storage",
          };
        }
      },
    );
    for (const result of outcomes) {
      succeeded += result.succeeded;
      failed += result.failed;
      snapshots += result.snapshots;
      if (result.code) errors.push(result.code);
    }
  } catch {
    failed = locations.length;
    succeeded = 0;
    errors.push("collector");
  }
  const status = terminalStatus(succeeded, failed),
    completedAt = now().toISOString();
  const message = failed
    ? `${failed} of ${locations.length} locations failed: ${
      [...new Set(errors)].join(", ")
    }`.slice(
      0,
      1000,
    )
    : null;
  const { data: completedRuns, error: completionError } = await db
    .from("forecast_runs")
    .update({
      status,
      completed_at: completedAt,
      locations_succeeded: succeeded,
      locations_failed: failed,
      snapshots_created: snapshots,
      error_message: message,
    })
    .eq("id", runId)
    .eq("status", "running")
    .select("id")
    .abortSignal(deadline.signal);
  clearTimeout(deadlineTimer);
  if (completionError || completedRuns?.length !== 1) {
    throw new Error("forecast run terminal update failed");
  }
  return {
    runId,
    status,
    locationsTotal: locations.length,
    locationsSucceeded: succeeded,
    locationsFailed: failed,
    snapshotsCreated: snapshots,
    startedAt,
    completedAt,
    ...(failed
      ? {
        message: `${failed} location${
          failed === 1 ? "" : "s"
        } could not be collected`,
      }
      : {}),
  };
}
