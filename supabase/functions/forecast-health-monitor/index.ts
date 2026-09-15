import { createClient } from "@supabase/supabase-js";
import { buildAlerts, formatTelegramMessage } from "./monitor.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

function response(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function authorized(request: Request): boolean {
  const expected = Deno.env.get("FORECAST_HEALTH_MONITOR_TOKEN") ?? "";
  const supplied = request.headers.get("Authorization") ?? "";
  return Boolean(expected) && supplied === `Bearer ${expected}`;
}

async function notifyTelegram(message: string): Promise<boolean> {
  const botToken = Deno.env.get("TELEGRAM_BOT_TOKEN") ?? "";
  const chatId = Deno.env.get("TELEGRAM_CHAT_ID") ?? "";
  if (!botToken || !chatId) return false;
  const result = await fetch(
    `https://api.telegram.org/bot${botToken}/sendMessage`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: chatId, text: message }),
    },
  );
  return result.ok;
}

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }
  if (request.method !== "POST") {
    return response({ error: "method_not_allowed" }, 405);
  }
  if (!authorized(request)) return response({ error: "unauthorized" }, 401);

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL") ?? "",
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
    { auth: { autoRefreshToken: false, persistSession: false } },
  );
  const { data, error } = await supabase.rpc(
    "get_forecast_collection_health",
  );
  const health = data?.[0];
  if (error || !health) return response({ error: "health_unavailable" }, 503);

  const schedulerExpected =
    (Deno.env.get("FORECAST_SCHEDULER_EXPECTED") ?? "false") === "true";
  const alerts = buildAlerts(health, schedulerExpected);
  let notified = false;
  if (alerts.length > 0) {
    notified = await notifyTelegram(formatTelegramMessage(health, alerts));
    if (!notified) return response({ error: "notification_unavailable" }, 503);
  }
  return response({ ok: true, alerts, notified });
});
