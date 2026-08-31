import { createClient } from "@supabase/supabase-js";
import { authorize, isValidSchedulerToken, parseAllowlist } from "./auth.ts";
import { collect, CollectionResult } from "./collector.ts";
import { classifyRequestShape, isBodyTooLarge } from "./request-contract.js";

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
    },
  });
export const collectionHttpStatus = (status: string) =>
  status === "failed" ? 500 : 200;
const REJECTED_HEADER_LOG_EVENT = "forecast_request_rejected";
const REJECTED_HEADER_LOG_REASON = "forbidden_request_header";
const MAX_REJECTED_HEADER_COUNT = 8;

const ALLOWED_APPLICATION_HEADERS = new Set([
  "accept",
  "accept-encoding",
  "accept-language",
  "apikey",
  "authorization",
  "connection",
  "content-length",
  "content-type",
  "host",
  "origin",
  "referer",
  "traceparent",
  "tracestate",
  "user-agent",
  "x-client-info",
  "x-forwarded-for",
  "x-forwarded-host",
  "x-forwarded-port",
  "x-forwarded-proto",
  "x-real-ip",
]);

export type RejectedHeaderSummary = {
  rejectedHeaderName: string;
  rejectedHeaderCount: number;
};

export function summarizeRejectedApplicationHeaders(
  headers: Headers,
): RejectedHeaderSummary | null {
  let rejectedHeaderName: string | null = null;
  let rejectedHeaderCount = 0;
  for (const name of headers.keys()) {
    const normalized = name.toLowerCase();
    if (
      !ALLOWED_APPLICATION_HEADERS.has(normalized) &&
      !normalized.startsWith("cf-") &&
      !normalized.startsWith("sec-fetch-")
    ) {
      if (rejectedHeaderName === null) rejectedHeaderName = normalized;
      if (rejectedHeaderCount < MAX_REJECTED_HEADER_COUNT) {
        rejectedHeaderCount += 1;
      }
    }
  }
  return rejectedHeaderName === null
    ? null
    : { rejectedHeaderName, rejectedHeaderCount };
}

export function hasDisallowedApplicationHeader(headers: Headers): boolean {
  return summarizeRejectedApplicationHeaders(headers) !== null;
}

export function hasJsonContentType(headers: Headers): boolean {
  const value = headers.get("content-type");
  if (!value) return false;
  const parts = value.split(";").map((part) => part.trim().toLowerCase());
  if (parts[0] !== "application/json") return false;
  return parts.slice(1).every((parameter) => parameter === "charset=utf-8");
}

type HandlerDependencies = {
  createClient: typeof createClient;
  collect: typeof collect;
  log: (message: string) => void;
};
type Environment = { get(name: string): string | undefined };

export function logRejectedHeaderDiagnostic(
  log: (message: string) => void,
  summary: RejectedHeaderSummary,
) {
  log(JSON.stringify({
    event: REJECTED_HEADER_LOG_EVENT,
    reason: REJECTED_HEADER_LOG_REASON,
    rejected_header_name: summary.rejectedHeaderName,
    rejected_header_count: summary.rejectedHeaderCount,
  }));
}

export async function handler(
  request: Request,
  env: Environment = Deno.env,
  dependencies: HandlerDependencies = {
    createClient,
    collect,
    log: console.log,
  },
) {
  if (request.method !== "POST") {
    return json({ error: "method_not_allowed" }, 405);
  }
  const url = env.get("SUPABASE_URL"),
    anon = env.get("SUPABASE_ANON_KEY"),
    service = env.get("SUPABASE_SERVICE_ROLE_KEY"),
    schedulerToken = env.get("FORECAST_SCHEDULER_TOKEN");
  let validUrl = false;
  try {
    validUrl = new URL(url ?? "").protocol === "https:";
  } catch {
    // Invalid configuration is deliberately collapsed to one category.
  }
  if (
    !validUrl || !anon || !service || !isValidSchedulerToken(schedulerToken)
  ) {
    return json({ error: "service_unavailable" }, 503);
  }
  const auth = dependencies.createClient(url!, anon, {
    auth: { persistSession: false },
  });
  const decision = await authorize(
    request,
    auth,
    parseAllowlist(env.get("FORECAST_ADMIN_USER_IDS")),
    schedulerToken,
  );
  if (decision === 401) return json({ error: "unauthorized" }, 401);
  if (decision === 403) return json({ error: "forbidden" }, 403);
  const contentTypeValid = hasJsonContentType(request.headers);
  const rejectedHeaderSummary = summarizeRejectedApplicationHeaders(
    request.headers,
  );
  const forbiddenHeader = rejectedHeaderSummary !== null;
  if (!contentTypeValid || forbiddenHeader) {
    if (rejectedHeaderSummary) {
      logRejectedHeaderDiagnostic(dependencies.log, rejectedHeaderSummary);
    }
    return json({
      error: "invalid_request",
      reason: contentTypeValid
        ? "forbidden_request_header"
        : "unsupported_content_type",
    }, 400);
  }
  let body: unknown;
  let bodyText: string;
  try {
    bodyText = await request.text();
  } catch {
    return json({ error: "invalid_request", reason: "invalid_json" }, 400);
  }
  if (isBodyTooLarge(bodyText)) {
    return json({ error: "invalid_request", reason: "body_too_large" }, 400);
  }
  try {
    body = JSON.parse(bodyText);
  } catch {
    return json({ error: "invalid_request", reason: "invalid_json" }, 400);
  }
  if (
    !body || Array.isArray(body) || typeof body !== "object" ||
    Object.keys(body).length !== 0
  ) {
    return json({
      error: "invalid_request",
      reason: classifyRequestShape({
        contentTypeValid: true,
        forbiddenHeader: false,
        bodyText,
      }),
    }, 400);
  }
  try {
    const result = await dependencies.collect(
      dependencies.createClient(url!, service, {
        auth: { persistSession: false },
      }),
      undefined,
      undefined,
      decision.triggerType,
    );
    if (result === "scheduled_run_active") {
      return json({ error: result }, 409);
    }
    if (result === "run_no_longer_running") {
      return json({ error: result }, 409);
    }
    return json(
      result,
      collectionHttpStatus((result as CollectionResult).status),
    );
  } catch {
    return json({ error: "collection_failed" }, 500);
  }
}
if (import.meta.main) Deno.serve((request) => handler(request));
