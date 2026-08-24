import { assertEquals } from "@std/assert";
import { collect } from "./collector.ts";
import { ProviderError } from "./types.ts";
import { Clock } from "./deadline.ts";

class Query {
  constructor(
    private readonly result: unknown,
    private readonly onAwait: () => void = () => {},
  ) {}
  select() {
    return this;
  }
  eq() {
    return this;
  }
  insert() {
    return this;
  }
  single() {
    return this;
  }
  abortSignal() {
    return this;
  }
  then(
    resolve: (value: unknown) => unknown,
    reject: (error: unknown) => unknown,
  ) {
    this.onAwait();
    return Promise.resolve(this.result).then(resolve, reject);
  }
}

class FakeClock implements Clock {
  value = 0;
  nextTimer = 1;
  timers = new Map<number, { at: number; callback: () => void }>();
  now = () => this.value;
  setTimer = (callback: () => void, milliseconds: number) => {
    const id = this.nextTimer++;
    this.timers.set(id, { at: this.value + milliseconds, callback });
    return id as unknown as ReturnType<typeof setTimeout>;
  };
  clearTimer = (timer: ReturnType<typeof setTimeout>) => {
    this.timers.delete(timer as unknown as number);
  };
  advance(milliseconds: number) {
    this.value += milliseconds;
    for (const [id, timer] of [...this.timers]) {
      if (timer.at <= this.value) {
        this.timers.delete(id);
        timer.callback();
      }
    }
  }
}

function database(
  locations: Array<Record<string, unknown>>,
  claimResult: Record<string, unknown> = {
    result: "claimed",
    run_id: "scheduled-run",
  },
  finalizeResult: Record<string, unknown> = {
    result: "finalized",
    completed_at: "2026-08-23T00:00:02.000Z",
  },
  hooks: Partial<Record<string, () => void>> = {},
) {
  const calls: Array<{ name: string; args: unknown }> = [];
  let manualRuns = 0;
  return {
    calls,
    get manualRuns() {
      return manualRuns;
    },
    from(table: string) {
      if (table === "locations") {
        return new Query({ data: locations, error: null }, hooks.locations);
      }
      if (table === "forecast_runs") {
        manualRuns++;
        return new Query(
          { data: { id: `manual-run-${manualRuns}` }, error: null },
          hooks.manual,
        );
      }
      throw new Error("unexpected table");
    },
    rpc(name: string, args: unknown) {
      calls.push({ name, args });
      if (name === "claim_scheduled_forecast_run") {
        return new Query({ data: [claimResult], error: null }, hooks.claim);
      }
      if (name === "insert_forecast_snapshot_batch") {
        return new Query(
          { data: [{ inserted_count: 2 }], error: null },
          hooks.snapshot,
        );
      }
      if (name === "finalize_forecast_run") {
        return new Query(
          { data: [finalizeResult], error: null },
          hooks.finalize,
        );
      }
      throw new Error("unexpected rpc");
    },
  };
}

const locations = [
  { id: "location-a", latitude: 1, longitude: 2, timezone: "UTC" },
  { id: "location-b", latitude: 3, longitude: 4, timezone: "UTC" },
];
const forecast = {
  collectedAt: "2026-08-23T00:00:01.000Z",
  collectionDate: "2026-08-23",
  days: [{
    targetDate: "2026-08-23",
    temperatureMin: 1,
    temperatureMax: 2,
    precipitationSum: 0,
    precipitationProbability: 0,
    windSpeedMax: 3,
    weatherCode: 0,
  }],
};

Deno.test("scheduled overlap creates no provider or snapshot work", async () => {
  const db = database(locations, {
    result: "scheduled_run_active",
    run_id: null,
  });
  let providerCalls = 0;
  const result = await collect(
    db as never,
    undefined,
    () => {
      providerCalls++;
      return Promise.resolve(forecast);
    },
    "scheduled",
  );
  assertEquals(result, "scheduled_run_active");
  assertEquals(providerCalls, 0);
  assertEquals(db.calls.map((call) => call.name), [
    "claim_scheduled_forecast_run",
  ]);
});

Deno.test("slow setup consumes work budget before run creation", async () => {
  const clock = new FakeClock();
  const db = database(locations, undefined, undefined, {
    locations: () => clock.advance(91),
  });
  let providerCalls = 0;
  await collect(
    db as never,
    undefined,
    () => {
      providerCalls++;
      return Promise.resolve(forecast);
    },
    "scheduled",
    { clock, overallMs: 100, terminalReserveMs: 10 },
  ).then(
    () => {
      throw new Error("expected setup timeout");
    },
    () => {},
  );
  assertEquals(providerCalls, 0);
  assertEquals(db.calls.length, 0);
  assertEquals(clock.timers.size, 0);
});

Deno.test("deadline blocks late snapshot and preserves terminalization reserve", async () => {
  const clock = new FakeClock();
  const db = database(locations.slice(0, 1), undefined, undefined, {
    finalize: () => clock.advance(9),
  });
  const result = await collect(
    db as never,
    undefined,
    () => {
      clock.advance(91);
      return Promise.resolve(forecast);
    },
    "scheduled",
    { clock, overallMs: 100, terminalReserveMs: 10 },
  );
  assertEquals(typeof result === "string" ? result : result.status, "failed");
  assertEquals(
    db.calls.some((call) => call.name === "insert_forecast_snapshot_batch"),
    false,
  );
  assertEquals(
    db.calls.filter((call) => call.name === "finalize_forecast_run").length,
    1,
  );
  assertEquals(clock.value, 100);
  assertEquals(clock.timers.size, 0);
});

Deno.test("collector sends canonical snapshot payload and finalized counters", async () => {
  const db = database(locations);
  const result = await collect(
    db as never,
    undefined,
    () => Promise.resolve(forecast),
    "scheduled",
  );
  assertEquals(
    typeof result === "string" ? result : result.status,
    "succeeded",
  );
  const batches = db.calls.filter((call) =>
    call.name === "insert_forecast_snapshot_batch"
  );
  assertEquals(batches.length, 2);
  const finalize = db.calls.find((call) =>
    call.name === "finalize_forecast_run"
  )!;
  assertEquals(finalize.args, {
    requested_run_id: "scheduled-run",
    requested_status: "succeeded",
    requested_locations_succeeded: 2,
    requested_locations_failed: 0,
    requested_snapshots_created: 4,
    requested_error_category: null,
  });
});

Deno.test("partial and total failures finalize once without automatic retry run", async () => {
  for (const failedGroups of [1, 2]) {
    const db = database(locations);
    const attempts = new Map<number, number>();
    const result = await collect(
      db as never,
      undefined,
      (request) => {
        const count = (attempts.get(request.latitude) ?? 0) + 1;
        attempts.set(request.latitude, count);
        if (request.latitude <= failedGroups * 2 - 1) {
          throw new ProviderError("network", true);
        }
        return Promise.resolve(forecast);
      },
      "scheduled",
    );
    assertEquals(
      typeof result === "string" ? result : result.status,
      failedGroups === 2 ? "failed" : "partial",
    );
    assertEquals(
      db.calls.filter((call) => call.name === "claim_scheduled_forecast_run")
        .length,
      1,
    );
    assertEquals(
      db.calls.filter((call) => call.name === "finalize_forecast_run").length,
      1,
    );
  }
});

Deno.test("zero locations, repeated manual calls, and recovered finalization are explicit", async () => {
  const empty = database([]);
  const zero = await collect(
    empty as never,
    undefined,
    () => Promise.resolve(forecast),
    "scheduled",
  );
  assertEquals(typeof zero === "string" ? zero : zero.status, "succeeded");

  const manual = database([]);
  await collect(
    manual as never,
    undefined,
    () => Promise.resolve(forecast),
    "manual",
  );
  await collect(
    manual as never,
    undefined,
    () => Promise.resolve(forecast),
    "manual",
  );
  assertEquals(manual.manualRuns, 2);

  const recovered = database([], undefined, {
    result: "run_no_longer_running",
    completed_at: null,
  });
  assertEquals(
    await collect(
      recovered as never,
      undefined,
      () => Promise.resolve(forecast),
      "scheduled",
    ),
    "run_no_longer_running",
  );
});
