export type Health = {
  latest_scheduled_status?: string | null;
  running_age_bucket?: string | null;
  missing_scheduled_acceptance?: boolean | null;
};

export function buildAlerts(
  health: Health,
  schedulerExpected: boolean,
): string[] {
  const alerts: string[] = [];
  if (health.running_age_bucket === "15m_or_more") {
    alerts.push("scheduled_run_stale");
  }
  if (health.latest_scheduled_status === "failed") {
    alerts.push("scheduled_run_failed");
  } else if (health.latest_scheduled_status === "partial") {
    alerts.push("scheduled_run_partial");
  }
  if (schedulerExpected && health.missing_scheduled_acceptance === true) {
    alerts.push("scheduled_run_missing");
  }
  return alerts;
}

export function formatTelegramMessage(
  health: Health,
  alerts: string[],
): string {
  return [
    "Weather-statistic health alert",
    `Signals: ${alerts.join(", ")}`,
    `Latest scheduled status: ${health.latest_scheduled_status ?? "none"}`,
    `Running age: ${health.running_age_bucket ?? "unknown"}`,
  ].join("\n");
}
