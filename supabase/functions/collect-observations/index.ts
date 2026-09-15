import { createClient } from "@supabase/supabase-js";
import { authorizeManual } from "./auth.ts";
import { collectObservations } from "./collector.ts";

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
    },
  });

function hasJsonContentType(headers: Headers): boolean {
  const value = headers.get("content-type");
  if (!value) return false;
  const parts = value.split(";").map((part) => part.trim().toLowerCase());
  return parts[0] === "application/json" &&
    parts.slice(1).every((parameter) => parameter === "charset=utf-8");
}

type Environment = { get(name: string): string | undefined };

export async function handler(request: Request, env: Environment = Deno.env) {
  if (request.method !== "POST") {
    return json({ error: "method_not_allowed" }, 405);
  }
  const url = env.get("SUPABASE_URL");
  const anon = env.get("SUPABASE_ANON_KEY");
  const service = env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !anon || !service) {
    return json({ error: "service_unavailable" }, 503);
  }
  const auth = createClient(url, anon, { auth: { persistSession: false } });
  const decision = await authorizeManual(
    request,
    auth,
    new Set(
      (env.get("FORECAST_ADMIN_USER_IDS") ?? "").split(",").map((id) =>
        id.trim()
      ).filter(Boolean),
    ),
  );
  if (decision === 401) return json({ error: "unauthorized" }, 401);
  if (decision === 403) return json({ error: "forbidden" }, 403);
  if (!hasJsonContentType(request.headers)) {
    return json({
      error: "invalid_request",
      reason: "unsupported_content_type",
    }, 400);
  }
  let body: string;
  try {
    body = await request.text();
  } catch {
    return json({ error: "invalid_request", reason: "invalid_json" }, 400);
  }
  if (body !== "{}") {
    return json({
      error: "invalid_request",
      reason: "body_must_be_empty_object",
    }, 400);
  }
  try {
    const result = await collectObservations(
      createClient(url, service, { auth: { persistSession: false } }),
    );
    return json(result, result.status === "failed" ? 500 : 200);
  } catch {
    return json({ error: "collection_failed" }, 500);
  }
}

if (import.meta.main) Deno.serve((request) => handler(request));
