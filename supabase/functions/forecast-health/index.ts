import { createClient } from "@supabase/supabase-js";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, content-type",
};

function response(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function adminIds() {
  return new Set(
    (Deno.env.get("FORECAST_ADMIN_USER_IDS") ?? "")
      .split(",")
      .map((value) => value.trim())
      .filter(Boolean),
  );
}

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }
  if (request.method !== "GET") {
    return response({ error: "method_not_allowed" }, 405);
  }

  const authorization = request.headers.get("Authorization") ?? "";
  const token = authorization.startsWith("Bearer ")
    ? authorization.slice(7).trim()
    : "";
  if (!token) return response({ error: "unauthorized" }, 401);

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL") ?? "",
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
    { auth: { autoRefreshToken: false, persistSession: false } },
  );
  const { data: userData, error: userError } = await supabase.auth.getUser(
    token,
  );
  if (userError || !userData.user || !adminIds().has(userData.user.id)) {
    return response(
      { error: userError ? "unauthorized" : "forbidden" },
      userError ? 401 : 403,
    );
  }

  const { data, error } = await supabase.rpc("get_forecast_collection_health");
  if (error || !data?.[0]) {
    return response({ error: "health_unavailable" }, 503);
  }
  return response({ health: data[0] });
});
