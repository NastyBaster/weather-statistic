import { assertEquals } from "@std/assert";
import {
  handler,
  logRejectedHeaderDiagnostic,
  MAX_REJECTED_HEADER_DIAGNOSTIC_LENGTH,
  REDACTED_INVALID_HEADER_NAME,
  REDACTED_OVERSIZED_HEADER_NAME,
  REDACTED_SENSITIVE_HEADER_NAME,
  sanitizeRejectedHeaderNameForDiagnostic,
} from "./index.ts";
import {
  classifyRequestShape,
  INVALID_REQUEST_REASONS,
  isBodyTooLarge,
} from "./request-contract.js";
import { buildEnqueueSql } from "../../../scripts/lib/scheduler-smoke-artifacts.mjs";

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

function nodeFetchHeaders(token: string): HeadersInit {
  return {
    accept: "*/*",
    "accept-encoding": "gzip, deflate",
    "accept-language": "*",
    authorization: `Bearer ${token}`,
    connection: "keep-alive",
    "content-length": "2",
    "content-type": "application/json",
    host: "example.test",
    "sec-fetch-mode": "cors",
    "user-agent": "node",
  };
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
    log: (() => {}) as never,
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
  let collected = 0;
  const diagnostics: string[] = [];
  const strictDependencies = {
    ...dependencies(success),
    collect: (() => {
      collected += 1;
      return Promise.resolve(success);
    }) as never,
    log: ((message: string) => diagnostics.push(message)) as never,
  };
  const spoofingHeaders = [
    "x-caller-time",
    "x-scheduler-slot",
    "trigger",
    "x-trigger-type",
    "x-identity",
    "scheduler-slot",
    "x-forecast-trigger",
    "x-scheduler-trigger",
    "x-forecast-identity",
    "x-run-trigger",
    "x-correlation-id",
    "x-runtime-transport",
  ] as const;
  const cases = [
    [
      request("admin-jwt", "", { "content-type": "text/plain" }),
      "unsupported_content_type",
      "",
    ],
    [request("admin-jwt", "not-json"), "invalid_json", "not-json"],
    [request("admin-jwt", "[]"), "body_must_be_object", "[]"],
    [request("admin-jwt", '"text"'), "body_must_be_object", '"text"'],
    [request("admin-jwt", "null"), "body_must_be_object", "null"],
    [
      request("admin-jwt", '{"trigger":"retry"}'),
      "body_must_be_empty",
      '{"trigger":"retry"}',
    ],
    [
      request("admin-jwt", `{${" ".repeat(1025)}}`),
      "body_too_large",
      `{${" ".repeat(1025)}}`,
    ],
  ] as const;
  for (const [candidate, reason, submitted] of cases) {
    const response = await handler(
      candidate,
      baseEnvironment,
      strictDependencies,
    );
    assertEquals(response.status, 400);
    const payload = await response.json();
    assertEquals(payload, { error: "invalid_request", reason });
    assertEquals(Object.keys(payload).sort(), ["error", "reason"]);
    assertEquals(INVALID_REQUEST_REASONS.includes(payload.reason), true);
    assertEquals(payload.reason.includes(":"), false);
    if (submitted) {
      assertEquals(JSON.stringify(payload).includes(submitted), false);
    }
    assertEquals(JSON.stringify(payload).includes("spoof"), false);
    assertEquals(JSON.stringify(payload).includes("admin-jwt"), false);
  }
  for (const headerName of spoofingHeaders) {
    const response = await handler(
      request("admin-jwt", "{}", { [headerName]: "spoof" }),
      baseEnvironment,
      strictDependencies,
    );
    assertEquals(response.status, 400);
    assertEquals(await response.json(), {
      error: "invalid_request",
      reason: "forbidden_request_header",
    });
  }
  assertEquals(collected, 0);
  assertEquals(diagnostics.length, spoofingHeaders.length);
  for (const entry of diagnostics) {
    const payload = JSON.parse(entry);
    assertEquals(payload.event, "forecast_request_rejected");
    assertEquals(payload.reason, "forbidden_request_header");
    assertEquals(typeof payload.rejected_header_name, "string");
    assertEquals(typeof payload.rejected_header_count, "number");
    assertEquals(entry.includes("spoof"), false);
    assertEquals(entry.includes("admin-jwt"), false);
    assertEquals(
      /[A-Za-z0-9_-]{43}\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/.test(entry),
      false,
    );
  }
});

Deno.test(
  "handler accepts inert standard Node fetch transport headers for manual auth",
  async () => {
    let collected = 0;
    const response = await handler(
      new Request("https://example.test/collect", {
        method: "POST",
        body: "{}",
        headers: nodeFetchHeaders("admin-jwt"),
      }),
      baseEnvironment,
      {
        ...dependencies(success),
        collect: ((
          _db: unknown,
          _now: unknown,
          _provider: unknown,
          trigger: "manual" | "scheduled",
        ) => {
          collected += 1;
          assertEquals(trigger, "manual");
          return Promise.resolve(success);
        }) as never,
        log: (() => {
          throw new Error("unexpected rejected-header diagnostic");
        }) as never,
      },
    );
    assertEquals(response.status, 200);
    assertEquals(collected, 1);
  },
);

Deno.test("rejected request emits one bounded diagnostic record with normalized name", async () => {
  const diagnostics: string[] = [];
  let collected = 0;
  const response = await handler(
    request("admin-jwt", "{}", {
      "X-Run-Trigger": "retry",
      "X-Correlation-Id": "jwt-like-value.with.segments",
    }),
    baseEnvironment,
    {
      ...dependencies(success),
      collect: (() => {
        collected += 1;
        return Promise.resolve(success);
      }) as never,
      log: ((message: string) => diagnostics.push(message)) as never,
    },
  );
  assertEquals(response.status, 400);
  assertEquals(await response.json(), {
    error: "invalid_request",
    reason: "forbidden_request_header",
  });
  assertEquals(collected, 0);
  assertEquals(diagnostics.length, 1);
  const payload = JSON.parse(diagnostics[0]);
  assertEquals(payload.event, "forecast_request_rejected");
  assertEquals(payload.reason, "forbidden_request_header");
  assertEquals(payload.rejected_header_name, "x-correlation-id");
  assertEquals(payload.rejected_header_count, 2);
  assertEquals(
    diagnostics[0].length <= MAX_REJECTED_HEADER_DIAGNOSTIC_LENGTH,
    true,
  );
  assertEquals(diagnostics[0].includes("retry"), false);
  assertEquals(diagnostics[0].includes("jwt-like-value.with.segments"), false);
  assertEquals(diagnostics[0].includes("admin-jwt"), false);
  assertEquals(diagnostics[0].includes("{}"), false);
});

Deno.test("diagnostic sanitizer normalizes short conventional header names", () => {
  assertEquals(sanitizeRejectedHeaderNameForDiagnostic("Priority"), "priority");
  assertEquals(sanitizeRejectedHeaderNameForDiagnostic("CDN-Loop"), "cdn-loop");
  assertEquals(
    sanitizeRejectedHeaderNameForDiagnostic("X-Runtime-Transport"),
    "x-runtime-transport",
  );
});

Deno.test("diagnostic sanitizer fully redacts invalid, oversized, and token-like names", () => {
  const syntheticOpaqueSegment = "a".repeat(43);
  const longHexSegment = "deadbeef".repeat(3);
  const oversizedName = `x-${"a".repeat(70)}`;

  assertEquals(
    sanitizeRejectedHeaderNameForDiagnostic("Bad Header"),
    REDACTED_INVALID_HEADER_NAME,
  );
  assertEquals(
    sanitizeRejectedHeaderNameForDiagnostic(oversizedName),
    REDACTED_OVERSIZED_HEADER_NAME,
  );
  assertEquals(
    sanitizeRejectedHeaderNameForDiagnostic(`x-${syntheticOpaqueSegment}`),
    REDACTED_SENSITIVE_HEADER_NAME,
  );
  assertEquals(
    sanitizeRejectedHeaderNameForDiagnostic(`x-${longHexSegment}`),
    REDACTED_SENSITIVE_HEADER_NAME,
  );
});

Deno.test("rejected request fully redacts sensitive and oversized header names in one bounded record", async () => {
  const diagnostics: string[] = [];
  const syntheticOpaqueSegment = "a".repeat(43);
  const oversizedSuffix = "b".repeat(70);
  let collected = 0;
  const response = await handler(
    request("admin-jwt", '{"fixture":"jwt.segment.value"}', {
      [`x-${syntheticOpaqueSegment}`]: "Bearer fixture-token",
      [`x-${oversizedSuffix}`]: "oversized",
      authorization: "Bearer admin-jwt",
    }),
    baseEnvironment,
    {
      ...dependencies(success),
      collect: (() => {
        collected += 1;
        return Promise.resolve(success);
      }) as never,
      log: ((message: string) => diagnostics.push(message)) as never,
    },
  );

  assertEquals(response.status, 400);
  assertEquals(await response.json(), {
    error: "invalid_request",
    reason: "forbidden_request_header",
  });
  assertEquals(collected, 0);
  assertEquals(diagnostics.length, 1);

  const serialized = diagnostics[0];
  const payload = JSON.parse(serialized);
  assertEquals(payload.event, "forecast_request_rejected");
  assertEquals(payload.reason, "forbidden_request_header");
  assertEquals(
    payload.rejected_header_name,
    REDACTED_SENSITIVE_HEADER_NAME,
  );
  assertEquals(payload.rejected_header_count, 2);
  assertEquals(
    serialized.length <= MAX_REJECTED_HEADER_DIAGNOSTIC_LENGTH,
    true,
  );
  assertEquals(serialized.includes(syntheticOpaqueSegment), false);
  assertEquals(serialized.includes(oversizedSuffix), false);
  assertEquals(serialized.includes("fixture-token"), false);
  assertEquals(serialized.includes("jwt.segment.value"), false);
  assertEquals(serialized.includes("admin-jwt"), false);
});

Deno.test("diagnostic helper caps the rejected header count", () => {
  const diagnostics: string[] = [];
  logRejectedHeaderDiagnostic(
    (message) => diagnostics.push(message),
    { rejectedHeaderName: "x-run-trigger", rejectedHeaderCount: 8 },
  );
  assertEquals(diagnostics.length, 1);
  assertEquals(JSON.parse(diagnostics[0]), {
    event: "forecast_request_rejected",
    reason: "forbidden_request_header",
    rejected_header_name: "x-run-trigger",
    rejected_header_count: 8,
  });
  assertEquals(
    diagnostics[0].length <= MAX_REJECTED_HEADER_DIAGNOSTIC_LENGTH,
    true,
  );
});

Deno.test("handler distinguishes size boundaries and UTF-8 byte length", async () => {
  const exact = `{${" ".repeat(1022)}}`;
  const oversized = `{${" ".repeat(1023)}}`;
  assertEquals(new TextEncoder().encode(exact).length, 1024);
  assertEquals(new TextEncoder().encode(oversized).length, 1025);
  assertEquals(isBodyTooLarge(exact), false);
  assertEquals(isBodyTooLarge(oversized), true);
  assertEquals(isBodyTooLarge("é".repeat(513)), true);

  const exactResponse = await handler(
    request("admin-jwt", exact),
    baseEnvironment,
    dependencies(success),
  );
  assertEquals(exactResponse.status, 200);

  const oversizedResponse = await handler(
    request("admin-jwt", oversized),
    baseEnvironment,
    dependencies(success),
  );
  assertEquals(oversizedResponse.status, 400);
  assertEquals(await oversizedResponse.json(), {
    error: "invalid_request",
    reason: "body_too_large",
  });
});

Deno.test("generated scheduler request passes the handler request-shape seam", async () => {
  const generated = buildEnqueueSql(
    "synthetic-development",
    "2026-01-01T00:00:00Z",
    0,
  );
  assertEquals((generated.match(/select net\.http_post\(/g) ?? []).length, 1);
  assertEquals(/body := '\{\}'::jsonb/.test(generated), true);
  assertEquals(/'Content-Type', 'application\/json'/.test(generated), true);
  assertEquals(/'Authorization', 'Bearer/.test(generated), true);
  assertEquals(
    classifyRequestShape({
      contentTypeValid: true,
      forbiddenHeader: false,
      bodyText: "{}",
    }),
    null,
  );
  let collected = 0;
  const response = await handler(
    new Request("https://example.test/collect", {
      method: "POST",
      body: "{}",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${schedulerToken}`,
      },
    }),
    baseEnvironment,
    {
      ...dependencies(success),
      collect: (() => {
        collected += 1;
        return Promise.resolve(success);
      }) as never,
      log: (() => {
        throw new Error("unexpected rejected-header diagnostic");
      }) as never,
    },
  );
  assertEquals(response.status, 200);
  assertEquals(collected, 1);
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
