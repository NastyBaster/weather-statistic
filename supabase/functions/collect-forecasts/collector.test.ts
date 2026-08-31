import { assert, assertEquals, assertRejects, assertThrows } from "@std/assert";
import { authorize, isValidSchedulerToken, parseAllowlist } from "./auth.ts";
import { groupLocations, mapConcurrent, terminalStatus } from "./collector.ts";
import { normalizeResponse } from "./normalize.ts";
import {
  buildForecastUrl,
  DAILY_VARIABLES,
  fetchForecast,
  OPEN_METEO_ENDPOINT,
} from "./open-meteo.ts";
import { withRetry } from "./retry.ts";
import { localDate } from "./time.ts";
import { ProviderError } from "./types.ts";
import {
  collectionHttpStatus,
  hasDisallowedApplicationHeader,
  hasJsonContentType,
} from "./index.ts";
import { abortableSleep } from "./retry.ts";

// Test mutations intentionally exercise malformed external JSON.
// deno-lint-ignore no-explicit-any
type MalformedResponse = any;

const valid = (overrides: Record<string, unknown> = {}) => ({
  daily_units: {
    time: "iso8601",
    temperature_2m_min: "°C",
    temperature_2m_max: "°C",
    precipitation_sum: "mm",
    precipitation_probability_max: "%",
    wind_speed_10m_max: "km/h",
    weather_code: "wmo code",
  },
  daily: {
    time: ["2026-08-22"],
    temperature_2m_min: [10.5],
    temperature_2m_max: [20.2],
    precipitation_sum: [1.1],
    precipitation_probability_max: [30],
    wind_speed_10m_max: [12.4],
    weather_code: [3],
  },
  ...overrides,
});

Deno.test(
  "provider URL fixes endpoint, timezone, horizon, variables, units and exact coordinates",
  () => {
    const url = buildForecastUrl(50.4501, 30.5234, "Europe/Kyiv");
    assertEquals(url.origin + url.pathname, OPEN_METEO_ENDPOINT);
    assertEquals(url.searchParams.get("latitude"), "50.4501");
    assertEquals(url.searchParams.get("longitude"), "30.5234");
    assertEquals(url.searchParams.get("timezone"), "Europe/Kyiv");
    assertEquals(url.searchParams.get("forecast_days"), "8");
    assertEquals(url.searchParams.get("daily"), DAILY_VARIABLES.join(","));
    assertEquals(
      [
        url.searchParams.get("temperature_unit"),
        url.searchParams.get("precipitation_unit"),
        url.searchParams.get("wind_speed_unit"),
      ],
      ["celsius", "mm", "kmh"],
    );
  },
);

Deno.test("scheduler credential has exact base64url 32-byte shape", async () => {
  const valid = "A".repeat(43);
  assert(isValidSchedulerToken(valid));
  for (
    const malformed of [
      undefined,
      "A".repeat(42),
      "A".repeat(44),
      `${"A".repeat(42)}=`,
      `${"A".repeat(42)}+`,
      `${"A".repeat(42)} `,
      `${"A".repeat(42)}Ж`,
    ]
  ) assertEquals(isValidSchedulerToken(malformed), false);

  const allow = parseAllowlist("admin-id");
  const client = (id: string | null) => ({
    auth: {
      getUser: (_token: string) =>
        Promise.resolve({ data: { user: id ? { id } : null }, error: null }),
    },
  });
  assertEquals(
    await authorize(
      new Request("https://x", {
        headers: { authorization: `Bearer ${valid}` },
      }),
      client(null),
      allow,
      valid,
    ),
    { triggerType: "scheduled" },
  );
  assertEquals(
    await authorize(
      new Request("https://x", {
        headers: { authorization: `Bearer ${valid.slice(0, -1)}B` },
      }),
      client(null),
      allow,
      valid,
    ),
    401,
  );
  assertEquals(
    await authorize(
      new Request("https://x", {
        headers: { authorization: "Bearer manual-jwt" },
      }),
      client("admin-id"),
      allow,
      valid,
    ),
    { triggerType: "manual" },
  );
});

Deno.test("request surface rejects only caller-controlled spoofing headers", () => {
  for (
    const value of [
      "application/json",
      "Application/JSON",
      "application/json; charset=UTF-8",
    ]
  ) {
    assert(hasJsonContentType(new Headers({ "content-type": value })));
  }
  for (
    const value of [
      "text/json",
      "application/json; charset=utf-16",
      "application/json; profile=x",
    ]
  ) {
    assertEquals(
      hasJsonContentType(new Headers({ "content-type": value })),
      false,
    );
  }
  assertEquals(
    hasDisallowedApplicationHeader(
      new Headers({
        "accept": "*/*",
        "accept-encoding": "gzip, deflate",
        "accept-language": "*",
        "authorization": "Bearer test",
        "connection": "keep-alive",
        "content-length": "2",
        "content-type": "application/json",
        "host": "example.test",
        "sec-fetch-mode": "cors",
        "user-agent": "node",
        "x-forwarded-for": "127.0.0.1",
        "apikey": "public",
        "x-runtime-transport": "node-fetch",
        "x-forwarded-request-id": "opaque",
      }),
    ),
    false,
  );
  for (
    const name of [
      "x-trigger-type",
      "x-caller-time",
      "x-scheduler-slot",
      "x-identity",
      "trigger",
      "scheduler-slot",
      "x-forecast-trigger",
      "x-scheduler-trigger",
      "x-forecast-identity",
    ]
  ) {
    assert(hasDisallowedApplicationHeader(new Headers({ [name]: "spoof" })));
  }
});

Deno.test("overall abort interrupts retry backoff", async () => {
  const controller = new AbortController();
  let attempts = 0;
  let enteredSleep = false;
  await assertRejects(
    () =>
      withRetry(
        () => {
          attempts++;
          throw new ProviderError("network", true);
        },
        {
          signal: controller.signal,
          random: () => 0,
          sleep: (_milliseconds, signal) => {
            enteredSleep = true;
            controller.abort();
            return abortableSleep(1_000, signal);
          },
        },
      ),
    ProviderError,
  );
  assert(enteredSleep);
  assertEquals(attempts, 1);
});

Deno.test("retry does not start an attempt without remaining budget", async () => {
  let attempts = 0;
  await assertRejects(
    () =>
      withRetry(
        () => {
          attempts++;
          return Promise.resolve("unexpected");
        },
        { remainingMs: () => 0 },
      ),
    ProviderError,
  );
  assertEquals(attempts, 0);
});

Deno.test("normalizes valid and nullable responses without rounding", () => {
  assertEquals(
    normalizeResponse(valid(), "2026-08-21")[0].temperatureMin,
    10.5,
  );
  const body = valid();
  for (const key of Object.keys(body.daily)) {
    if (key !== "time") (body.daily as Record<string, unknown[]>)[key] = [null];
  }
  (body.daily.temperature_2m_min as unknown[]) = [1.25];
  assertEquals(normalizeResponse(body, "2026-08-21")[0].precipitationSum, null);
});

for (
  const [name, mutate] of [
    ["missing daily", (body: MalformedResponse) => delete body.daily],
    [
      "array mismatch",
      (body: MalformedResponse) => body.daily.weather_code.push(2),
    ],
    [
      "invalid date",
      (body: MalformedResponse) => (body.daily.time[0] = "22-08-2026"),
    ],
    [
      "invalid number",
      (body: MalformedResponse) => (body.daily.temperature_2m_min[0] = NaN),
    ],
    [
      "probability below zero",
      (
        body: MalformedResponse,
      ) => (body.daily.precipitation_probability_max[0] = -1),
    ],
    [
      "probability above 100",
      (
        body: MalformedResponse,
      ) => (body.daily.precipitation_probability_max[0] = 101),
    ],
    [
      "non-integer probability",
      (
        body: MalformedResponse,
      ) => (body.daily.precipitation_probability_max[0] = 1.5),
    ],
    [
      "negative precipitation",
      (body: MalformedResponse) => (body.daily.precipitation_sum[0] = -1),
    ],
    [
      "negative wind",
      (body: MalformedResponse) => (body.daily.wind_speed_10m_max[0] = -1),
    ],
    [
      "min above max",
      (body: MalformedResponse) => (body.daily.temperature_2m_min[0] = 30),
    ],
    [
      "all null",
      (body: MalformedResponse) =>
        Object.keys(body.daily)
          .filter((k) => k !== "time")
          .forEach((k) => (body.daily[k][0] = null)),
    ],
    [
      "invalid units",
      (
        body: MalformedResponse,
      ) => (body.daily_units.wind_speed_10m_max = "mph"),
    ],
  ] as const
) {
  Deno.test(`normalization rejects ${name}`, () => {
    const body = valid();
    mutate(body);
    assertThrows(
      () => normalizeResponse(body, "2026-08-21"),
      ProviderError,
    );
  });
}

Deno.test(
  "local dates honor UTC boundary, Kyiv, negative offset, and DST",
  () => {
    assertEquals(
      localDate(new Date("2026-08-21T23:30:00Z"), "UTC"),
      "2026-08-21",
    );
    assertEquals(
      localDate(new Date("2026-08-21T23:30:00Z"), "Europe/Kyiv"),
      "2026-08-22",
    );
    assertEquals(
      localDate(new Date("2026-08-21T02:00:00Z"), "America/New_York"),
      "2026-08-20",
    );
    assertEquals(
      localDate(new Date("2026-03-08T07:30:00Z"), "America/New_York"),
      "2026-03-08",
    );
    assertThrows(() => localDate(new Date(), "Not/AZone"), RangeError);
  },
);

Deno.test(
  "provider classifies HTTP failures and never exposes response body",
  async () => {
    for (
      const [status, code, retryable] of [
        [429, "rate_limited", true],
        [503, "provider_5xx", true],
        [400, "invalid_request", false],
      ] as const
    ) {
      const error = await fetchForecast(
        { latitude: 1, longitude: 2, timezone: "UTC" },
        new AbortController().signal,
        () =>
          Promise.resolve(
            new Response('{"reason":"secret"}', {
              status,
              headers: { "retry-after": "99" },
            }),
          ),
      ).catch((e) => e);
      assertEquals(error.code, code);
      assertEquals(error.retryable, retryable);
      assert(!error.message.includes("secret"));
    }
  },
);

Deno.test(
  "provider accepts mocked response and records validation instant",
  async () => {
    const result = await fetchForecast(
      { latitude: 1, longitude: 2, timezone: "Europe/Kyiv" },
      new AbortController().signal,
      () => Promise.resolve(Response.json(valid())),
      () => new Date("2026-08-21T23:30:00Z"),
    );
    assertEquals(result.collectionDate, "2026-08-22");
    assertEquals(result.collectedAt, "2026-08-21T23:30:00.000Z");
  },
);

Deno.test(
  "retry retries retryable errors, caps attempts and makes jitter deterministic",
  async () => {
    let calls = 0;
    const delays: number[] = [];
    await withRetry(
      () => {
        if (++calls < 3) {
          throw new ProviderError(
            calls === 1 ? "network" : "provider_5xx",
            true,
          );
        }
        return Promise.resolve("ok");
      },
      {
        sleep: (ms) => {
          delays.push(ms);
          return Promise.resolve();
        },
        random: () => 0,
        timeoutMs: 100,
      },
    );
    assertEquals(calls, 3);
    assertEquals(delays, [125, 250]);
    calls = 0;
    await assertRejects(
      () =>
        withRetry(
          () => {
            calls++;
            throw new ProviderError("rate_limited", true, 99_000);
          },
          { attempts: 3, maxDelayMs: 500, sleep: () => Promise.resolve() },
        ),
      ProviderError,
    );
    assertEquals(calls, 3);
  },
);

Deno.test("retry does not retry 4xx or contract mismatch", async () => {
  for (const code of ["invalid_request", "response_contract"] as const) {
    let calls = 0;
    await assertRejects(
      () =>
        withRetry(() => {
          calls++;
          throw new ProviderError(code, false);
        }),
      ProviderError,
    );
    assertEquals(calls, 1);
  }
});

Deno.test("timeout is retried and maximum attempts are enforced", async () => {
  let calls = 0;
  await assertRejects(
    () =>
      withRetry(
        (signal) =>
          new Promise((_resolve, reject) => {
            calls++;
            signal.addEventListener(
              "abort",
              () => reject(new ProviderError("timeout", true)),
            );
          }),
        { attempts: 2, timeoutMs: 1, sleep: () => Promise.resolve() },
      ),
    ProviderError,
  );
  assertEquals(calls, 2);
});

Deno.test("an overall abort stops provider retries", async () => {
  const controller = new AbortController();
  controller.abort();
  let calls = 0;
  await assertRejects(
    () =>
      withRetry(() => {
        calls++;
        return Promise.resolve("unexpected");
      }, { signal: controller.signal }),
    ProviderError,
  );
  assertEquals(calls, 0);
});

Deno.test(
  "grouping is exact, timezone-sensitive and preserves fan-out IDs",
  () => {
    const groups = groupLocations([
      { id: "a", latitude: 1.0000001, longitude: 2, timezone: "UTC" },
      { id: "b", latitude: 1.0000001, longitude: 2, timezone: "UTC" },
      { id: "c", latitude: 1.0000002, longitude: 2, timezone: "UTC" },
      { id: "d", latitude: 1.0000001, longitude: 2, timezone: "Europe/Kyiv" },
    ]);
    assertEquals(groups.length, 3);
    assertEquals(
      groups[0].locations.map(({ id }) => id),
      ["a", "b"],
    );
  },
);

Deno.test("bounded mapper respects concurrency", async () => {
  let active = 0,
    peak = 0;
  await mapConcurrent([1, 2, 3, 4, 5, 6], 2, async () => {
    peak = Math.max(peak, ++active);
    await new Promise((resolve) => setTimeout(resolve, 2));
    active--;
  });
  assertEquals(peak, 2);
});

Deno.test("terminal status covers no work, complete, mixed, and failed", () => {
  assertEquals(terminalStatus(0, 0), "succeeded");
  assertEquals(terminalStatus(4, 0), "succeeded");
  assertEquals(terminalStatus(3, 1), "partial");
  assertEquals(terminalStatus(0, 4), "failed");
});

Deno.test("total failure maps to HTTP 500", () => {
  assertEquals(collectionHttpStatus("succeeded"), 200);
  assertEquals(collectionHttpStatus("partial"), 200);
  assertEquals(collectionHttpStatus("failed"), 500);
});

Deno.test(
  "authorization rejects missing/invalid/non-admin and accepts allowlisted UUID",
  async () => {
    const client = (user: { id: string } | null, error: unknown = null) => ({
      auth: {
        getUser: (_token: string) => Promise.resolve({ data: { user }, error }),
      },
    });
    const allow = parseAllowlist(" admin-id, second-id ");
    const configuredSchedulerToken = "A".repeat(43);
    assertEquals(
      await authorize(
        new Request("https://x"),
        client(null),
        allow,
        configuredSchedulerToken,
      ),
      401,
    );
    assertEquals(
      await authorize(
        new Request("https://x", { headers: { authorization: "Bearer bad" } }),
        client(null, {}),
        allow,
        configuredSchedulerToken,
      ),
      401,
    );
    assertEquals(
      await authorize(
        new Request("https://x", {
          headers: { authorization: "Bearer token" },
        }),
        client({ id: "other" }),
        allow,
        configuredSchedulerToken,
      ),
      403,
    );
    assertEquals(
      await authorize(
        new Request("https://x", {
          method: "POST",
          body: JSON.stringify({ user_id: "admin-id" }),
          headers: { authorization: "Bearer token" },
        }),
        client({ id: "admin-id" }),
        allow,
        configuredSchedulerToken,
      ),
      { triggerType: "manual" },
    );
    assertEquals(
      await authorize(
        new Request("https://x", {
          headers: { authorization: `Bearer ${configuredSchedulerToken}` },
        }),
        client(null),
        allow,
        configuredSchedulerToken,
      ),
      { triggerType: "scheduled" },
    );
  },
);
