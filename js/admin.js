import { getSupabaseClient } from "./supabase-client.js";
import { loginUrl } from "./auth.js";

const $ = (selector) => document.querySelector(selector);

function formatDate(value) {
  return value ? new Date(value).toLocaleString("uk-UA", { dateStyle: "medium", timeStyle: "short" }) : "Немає";
}

function render(health) {
  $("[data-health-status]").textContent = health.latest_scheduled_status ?? "Ще не було";
  $("[data-health-started]").textContent = `Початок: ${formatDate(health.latest_scheduled_started_at)}`;
  $("[data-health-counters]").textContent = `${health.latest_scheduled_locations_succeeded ?? 0} / ${health.latest_scheduled_locations_failed ?? 0}`;
  $("[data-health-running]").textContent = String(health.running_scheduled_count ?? 0);
  $("[data-health-age]").textContent = health.running_age_bucket === "none" ? "Активних немає" : health.running_age_bucket;
  $("[data-health-window]").textContent = health.missing_scheduled_acceptance ? "Потрібна увага" : "Є прийнятий запуск";
  $("[data-health-window-detail]").textContent = `${formatDate(health.expected_window_start)} — ${formatDate(health.expected_window_end)}`;
  $("[data-checked-at]").textContent = `Перевірено: ${formatDate(health.checked_at)}`;
  $("[data-health]").hidden = false;
}

async function loadHealth() {
  const alert = $("[data-admin-alert]");
  alert.hidden = true;
  try {
    const supabase = await getSupabaseClient();
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) {
      globalThis.location.replace(loginUrl());
      return;
    }
    const { data, error } = await supabase.functions.invoke("forecast-health", { method: "GET" });
    if (error || !data?.health) throw new Error("health_unavailable");
    render(data.health);
  } catch {
    alert.textContent = "Стан недоступний. Перевірте права адміністратора або спробуйте ще раз.";
    alert.hidden = false;
  }
}

$("[data-refresh]").addEventListener("click", loadHealth);
$("[data-sign-out]").addEventListener("click", async () => {
  const supabase = await getSupabaseClient();
  await supabase.auth.signOut();
  globalThis.location.replace(loginUrl());
});
loadHealth();
