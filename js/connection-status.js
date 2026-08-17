import { appConfig, hasSupabaseConfig } from "./config.js";
import { getSupabaseClient } from "./supabase-client.js";

const labels = {
  checking: "Перевіряємо Supabase…",
  local: "Supabase не налаштовано локально",
  connected: `Supabase підключено · ${appConfig.environment}`,
  error: "Supabase недоступний",
};

function updateStatus(element, state, label = labels[state]) {
  element.dataset.state = state;
  element.querySelector("[data-connection-label]").textContent = label;
  element.title = label;
}

export async function initializeConnectionStatus() {
  const element = document.querySelector("#connection-status");

  if (!element) return;
  if (!hasSupabaseConfig()) {
    updateStatus(element, "local");
    return;
  }

  updateStatus(element, "checking");

  try {
    const supabase = await getSupabaseClient();
    const { data, error } = await supabase.rpc("health_check");

    if (error || data !== true) throw error ?? new Error("Unexpected health check response");
    updateStatus(element, "connected");
  } catch (error) {
    console.error("Supabase health check failed", error);
    updateStatus(element, "error");
  }
}
