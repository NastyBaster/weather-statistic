import { createClient } from "@supabase/supabase-js";
import { authorize, parseAllowlist } from "./auth.ts";
import { collect } from "./collector.ts";

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
export async function handler(request: Request, env = Deno.env) {
  if (request.method !== "POST") {
    return json({ error: "method_not_allowed" }, 405);
  }
  const url = env.get("SUPABASE_URL"),
    anon = env.get("SUPABASE_ANON_KEY"),
    service = env.get("SUPABASE_SERVICE_ROLE_KEY"),
    schedulerToken = env.get("FORECAST_SCHEDULER_TOKEN");
  if (!url || !anon || !service || !schedulerToken) {
    return json({ error: "service_unavailable" }, 503);
  }
  const auth = createClient(url, anon, { auth: { persistSession: false } });
  const decision = await authorize(
    request,
    auth,
    parseAllowlist(env.get("FORECAST_ADMIN_USER_IDS")),
    schedulerToken,
  );
  if (decision === 401) return json({ error: "unauthorized" }, 401);
  if (decision === 403) return json({ error: "forbidden" }, 403);
  const forbiddenHeaders = [
    "x-forecast-trigger",
    "x-trigger-type",
    "x-scheduler-trigger",
    "x-forecast-identity",
  ];
  if (forbiddenHeaders.some((name) => request.headers.has(name))) {
    return json({ error: "invalid_request" }, 400);
  }
  let body: unknown;
  try {
    const text = await request.text();
    if (new TextEncoder().encode(text).length > 1024) throw new Error();
    body = JSON.parse(text);
  } catch {
    return json({ error: "invalid_request" }, 400);
  }
  if (
    !body || Array.isArray(body) || typeof body !== "object" ||
    Object.keys(body).length !== 0
  ) return json({ error: "invalid_request" }, 400);
  try {
    const result = await collect(
      createClient(url, service, { auth: { persistSession: false } }),
      undefined,
      undefined,
      decision.triggerType,
    );
    if (result === "scheduled_run_active") {
      return json({ error: result }, 409);
    }
    return json(result, collectionHttpStatus(result.status));
  } catch {
    return json({ error: "collection_failed" }, 500);
  }
}
if (import.meta.main) Deno.serve((request) => handler(request));
