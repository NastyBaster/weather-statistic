import { assertEquals } from "@std/assert";
import { collectObservations } from "./collector.ts";

function database() {
  const inserts: unknown[] = [];
  const query = {
    select: () => query,
    eq: () => query,
    upsert: (row: unknown) => {
      inserts.push(row);
      return query;
    },
    then: (resolve: (value: unknown) => unknown) =>
      Promise.resolve({ data: [{ id: "observation-1" }], error: null }).then(
        resolve,
      ),
  };
  return {
    inserts,
    from: (table: string) => {
      if (table === "locations") {
        return {
          select: () => query,
        };
      }
      return query;
    },
  };
}

Deno.test("collects the previous local day and inserts an immutable observation", async () => {
  const db = database();
  const result = await collectObservations(
    db,
    (input) =>
      Promise.resolve({
        observationDate: input.observationDate,
        temperatureMin: 10,
        temperatureMax: 20,
        precipitationSum: 0,
        windSpeedMax: 12,
        weatherCode: 1,
      }),
    new Date("2026-09-16T01:00:00Z"),
  );
  assertEquals(result.status, "succeeded");
  assertEquals(result.observationDate, "2026-09-15");
  assertEquals(result.observationsInserted, 1);
  assertEquals(db.inserts.length, 1);
});
