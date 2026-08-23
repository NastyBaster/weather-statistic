import { fetchForecast } from "./open-meteo.ts";
import { withRetry } from "./retry.ts";
import { Location, LocationGroup, ProviderError } from "./types.ts";
import { Clock, Deadline, systemClock } from "./deadline.ts";

// deno-lint-ignore no-explicit-any -- narrowed PostgREST's fluent client boundary.
type Db = { from(table: string): any; rpc(name: string, args: unknown): any };
type GroupOutcome = {
  succeeded: number;
  failed: number;
  snapshots: number;
  code?: string;
};
export type CollectOptions = {
  clock?: Clock;
  overallMs?: number;
  terminalReserveMs?: number;
};
export type CollectionResult = {
  runId: string;
  status: "succeeded" | "partial" | "failed";
  locationsTotal: number;
  locationsSucceeded: number;
  locationsFailed: number;
  snapshotsCreated: number;
  startedAt: string;
  completedAt: string;
  message?: string;
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
  options: CollectOptions = {},
) {
  const clock = options.clock ?? systemClock;
  const overallMs = options.overallMs ?? 120_000;
  const terminalReserveMs = options.terminalReserveMs ?? 10_000;
  if (terminalReserveMs <= 0 || terminalReserveMs >= overallMs) {
    throw new Error("invalid collector deadline configuration");
  }
  const overallDeadline = new Deadline(clock, overallMs);
  const workDeadline = new Deadline(clock, overallMs - terminalReserveMs);
  const startedAt = now().toISOString();
  try {
    const { data, error: locationError } = await db
      .from("locations")
      .select("id,latitude,longitude,timezone")
      .eq("is_active", true)
      .abortSignal(workDeadline.signal);
    if (locationError) throw new Error("active locations could not be read");
    const locations = (data ?? []) as Location[];
    if (workDeadline.expired()) throw new Error("collector setup timed out");
    const claim = triggerType === "scheduled"
      ? await db.rpc("claim_scheduled_forecast_run", {
        requested_locations_total: locations.length,
      }).abortSignal(workDeadline.signal)
      : await db.from("forecast_runs").insert({
        trigger_type: "manual",
        status: "running",
        started_at: startedAt,
        locations_total: locations.length,
      }).select("id").single().abortSignal(workDeadline.signal);
    const run = triggerType === "scheduled" ? claim.data?.[0] : claim.data;
    const runError = claim.error;
    if (
      triggerType === "scheduled" && run?.result === "scheduled_run_active"
    ) return "scheduled_run_active" as const;
    if (runError || !run) throw new Error("forecast run could not be created");
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
            if (workDeadline.expired()) {
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
              {
                signal: workDeadline.signal,
                remainingMs: () => workDeadline.remaining(),
              },
            );
            if (workDeadline.expired()) {
              throw new ProviderError("timeout", false);
            }
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
            ).abortSignal(workDeadline.signal);
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
    const status = terminalStatus(succeeded, failed);
    const errorCategory = failed ? [...new Set(errors)].sort().join(",") : null;
    const { data: finalized, error: completionError } = await db.rpc(
      "finalize_forecast_run",
      {
        requested_run_id: runId,
        requested_status: status,
        requested_locations_succeeded: succeeded,
        requested_locations_failed: failed,
        requested_snapshots_created: snapshots,
        requested_error_category: errorCategory,
      },
    ).abortSignal(overallDeadline.signal);
    if (completionError || !finalized?.[0]) {
      throw new Error("forecast run terminal update failed");
    }
    if (finalized[0].result === "run_no_longer_running") {
      return "run_no_longer_running" as const;
    }
    if (finalized[0].result !== "finalized" || !finalized[0].completed_at) {
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
      completedAt: finalized[0].completed_at,
      ...(failed
        ? {
          message: `${failed} location${
            failed === 1 ? "" : "s"
          } could not be collected`,
        }
        : {}),
    } satisfies CollectionResult;
  } finally {
    workDeadline.close();
    overallDeadline.close();
  }
}
