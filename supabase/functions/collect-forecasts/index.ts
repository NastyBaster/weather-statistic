import { createClient } from "npm:@supabase/supabase-js@2";
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
export async function handler(request: Request, env = Deno.env) {
  if (request.method !== "POST") {
    return json({ error: "method_not_allowed" }, 405);
  }
  const url = env.get("SUPABASE_URL"),
    anon = env.get("SUPABASE_ANON_KEY"),
    service = env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !anon || !service) {
    return json({ error: "service_unavailable" }, 503);
  }
  const auth = createClient(url, anon, { auth: { persistSession: false } });
  const decision = await authorize(
    request,
    auth,
    parseAllowlist(env.get("FORECAST_ADMIN_USER_IDS")),
  );
  if (decision === 401) return json({ error: "unauthorized" }, 401);
  if (decision === 403) return json({ error: "forbidden" }, 403);
  try {
    return json(
      await collect(
        createClient(url, service, { auth: { persistSession: false } }),
      ),
    );
  } catch {
    return json({ error: "collection_failed" }, 500);
  }
}
if (import.meta.main) Deno.serve(handler);
