import { assertEquals } from "@std/assert";
import { buildAlerts } from "./monitor.ts";

Deno.test("does not alert for missing schedule while scheduler is disabled", () => {
  assertEquals(
    buildAlerts({ missing_scheduled_acceptance: true }, false),
    [],
  );
});

Deno.test("reports stale, partial, and missing scheduled signals", () => {
  assertEquals(
    buildAlerts({
      running_age_bucket: "15m_or_more",
      latest_scheduled_status: "partial",
      missing_scheduled_acceptance: true,
    }, true),
    ["scheduled_run_stale", "scheduled_run_partial", "scheduled_run_missing"],
  );
});
