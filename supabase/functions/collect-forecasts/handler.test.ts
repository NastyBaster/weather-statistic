import { assertEquals } from "@std/assert";
import { handler } from "./index.ts";

const schedulerToken = "A".repeat(43);
const baseEnvironment = new Map([
  ["SUPABASE_URL", "https://example.supabase.co"],
  ["SUPABASE_ANON_KEY", "test-anon-key"],
  ["SUPABASE_SERVICE_ROLE_KEY", "test-service-key"],
  ["FORECAST_SCHEDULER_TOKEN", schedulerToken],
  ["FORECAST_ADMIN_USER_IDS", "admin-id"],
]);

type Outcome =
  | "scheduled_run_active"
  | "run_no_longer_running"
  | {
    status: "succeeded" | "partial" | "failed";
    locationsTotal: number;
    locationsSucceeded: number;
    locationsFailed: number;
    snapshotsCreated: number;
    runId: string;
    startedAt: string;
    completedAt: string;
  };

function request(token: string, body = "{}", headers: HeadersInit = {}) {
  return new Request("https://example.test/collect", {
    method: "POST",
    body,
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json; charset=utf-8",
      ...headers,
    },
  });
}

function dependencies(outcome: Outcome | Error) {
  const authClient = {
    auth: {
      getUser: (token: string) => {
        const id = token === "admin-jwt"
          ? "admin-id"
          : token === "user-jwt"
          ? "other-id"
          : null;
        return Promise.resolve({
          data: { user: id ? { id } : null },
          error: id ? null : {},
        });
      },
    },
  };
  return {
    createClient: (() => authClient) as never,
    collect:
      (() =>
        outcome instanceof Error
          ? Promise.reject(outcome)
          : Promise.resolve(outcome)) as never,
  };
}

const success: Outcome = {
  status: "succeeded",
  locationsTotal: 1,
  locationsSucceeded: 1,
  locationsFailed: 0,
  snapshotsCreated: 8,
  runId: "sanitized-test-run",
  startedAt: "2026-08-23T00:00:00.000Z",
  completedAt: "2026-08-23T00:00:01.000Z",
};

Deno.test("handler authentication and scheduler configuration status matrix", async () => {
  assertEquals(
    (await handler(request("wrong"), baseEnvironment, dependencies(success)))
      .status,
    401,
  );
  assertEquals(
    (await handler(request("user-jwt"), baseEnvironment, dependencies(success)))
      .status,
    403,
  );
  assertEquals(
    (await handler(
      request("admin-jwt"),
      baseEnvironment,
      dependencies(success),
    )).status,
    200,
  );
  assertEquals(
    (await handler(
      request(schedulerToken),
      baseEnvironment,
      dependencies(success),
    )).status,
    200,
  );

  for (
    const configured of [
      undefined,
      "A".repeat(42),
      `${"A".repeat(42)}=`,
      `${"A".repeat(42)}+`,
    ]
  ) {
    const environment = new Map(baseEnvironment);
    if (configured === undefined) {
      environment.delete("FORECAST_SCHEDULER_TOKEN");
    } else environment.set("FORECAST_SCHEDULER_TOKEN", configured);
    assertEquals(
      (await handler(request("admin-jwt"), environment, dependencies(success)))
        .status,
      503,
    );
  }
});

Deno.test("handler rejects spoofing and malformed request bodies", async () => {
  for (
    const candidate of [
      request("admin-jwt", "", { "content-type": "text/plain" }),
      request("admin-jwt", "not-json"),
      request("admin-jwt", "[]"),
      request("admin-jwt", "null"),
      request("admin-jwt", '{"trigger":"retry"}'),
      request("admin-jwt", `{${" ".repeat(1025)}}`),
      request("admin-jwt", "{}", { "x-caller-time": "spoof" }),
      request("admin-jwt", "{}", { "x-scheduler-slot": "spoof" }),
      request("admin-jwt", "{}", { trigger: "scheduled" }),
    ]
  ) {
    assertEquals(
      (await handler(candidate, baseEnvironment, dependencies(success))).status,
      400,
    );
  }
});

Deno.test("handler maps collection outcomes without raw errors", async () => {
  const partial = {
    ...success,
    status: "partial" as const,
    locationsFailed: 1,
  };
  const failed = {
    ...success,
    status: "failed" as const,
    locationsSucceeded: 0,
    locationsFailed: 1,
  };
  for (
    const [outcome, expected] of [
      [success, 200],
      [partial, 200],
      [failed, 500],
      ["scheduled_run_active", 409],
      ["run_no_longer_running", 409],
    ] as const
  ) {
    assertEquals(
      (await handler(
        request(schedulerToken),
        baseEnvironment,
        dependencies(outcome),
      )).status,
      expected,
    );
  }
  const response = await handler(
    request(schedulerToken),
    baseEnvironment,
    dependencies(new Error("raw database detail")),
  );
  assertEquals(response.status, 500);
  assertEquals(await response.json(), { error: "collection_failed" });
});
