import assert from "node:assert/strict";
import { npmForwardedRuntimeArguments, parseSchedulerRuntimeArguments } from "../scripts/lib/scheduler-validation-arguments.mjs";
import { offlineReport, runHybridDevelopment } from "../scripts/validate-scheduler-development.mjs";

const canonical = [
  "--live-development", "--hybrid-sql-editor", "--confirm-development-smoke",
  "--development-name=Synthetic Development", "--production-name=Synthetic Production",
];
const parsed = parseSchedulerRuntimeArguments(canonical);
assert.deepEqual(npmForwardedRuntimeArguments(canonical), canonical);
assert.equal(parsed.live && parsed.hybrid && parsed.confirmed, true);
assert.equal(parsed.development_name, "Synthetic Development");
assert.equal(parsed.production_name, "Synthetic Production");
const npmEnvironment = {
  npm_config_live_development: "true",
  npm_config_hybrid_sql_editor: "true",
  npm_config_confirm_development_smoke: "true",
  npm_config_development_name: "Synthetic Development",
  npm_config_production_name: "Synthetic Production",
};
assert.deepEqual(npmForwardedRuntimeArguments([], npmEnvironment), canonical);
assert.equal(parseSchedulerRuntimeArguments([], npmEnvironment).live, true);
assert.equal(parseSchedulerRuntimeArguments([], { NPM_CONFIG_LIVE_DEVELOPMENT: "true" }).live, true);
assert.deepEqual(parseSchedulerRuntimeArguments([]).args, []);
assert.equal(parseSchedulerRuntimeArguments(canonical.filter((item) => item !== "--hybrid-sql-editor")).hybrid, false);
assert.throws(() => parseSchedulerRuntimeArguments(["--unknown"]), /runtime_argument_unknown/);
assert.throws(() => parseSchedulerRuntimeArguments([...canonical, "--live-development"]), /runtime_argument_duplicate/);
assert.throws(() => parseSchedulerRuntimeArguments(["--development-name="]), /runtime_argument_malformed/);
assert.throws(() => parseSchedulerRuntimeArguments(["--development-name=bad\nvalue"]), /runtime_argument_malformed/);
const offline = await offlineReport();
assert.equal(offline.httpRequests, 0);
await assert.rejects(runHybridDevelopment(["--live-development"], {}), /hybrid_live_confirmation_required/);
await assert.rejects(runHybridDevelopment(["--live-development", "--hybrid-sql-editor", "--confirm-development-smoke"], {}), /development_target_required/);
console.log("scheduler argument forwarding: 15 fixtures, 0 failed, 0 skipped, 0 not-run");
