import assert from "node:assert/strict";
import { isDirectEsModule } from "../scripts/lib/es-module-entrypoint.mjs";
import { offlineReport, runHybridDevelopment } from "../scripts/validate-scheduler-development.mjs";

assert.equal(isDirectEsModule("file:///opt/validation.mjs", "/opt/validation.mjs", { platform: "linux" }), true);
assert.equal(isDirectEsModule("file:///C:/Synthetic/validation.mjs", "C:\\Synthetic\\validation.mjs", { platform: "win32" }), true);
assert.equal(isDirectEsModule("file:///C:/Synthetic%20Folder/validation.mjs", "C:\\Synthetic Folder\\validation.mjs", { platform: "win32" }), true);
assert.equal(isDirectEsModule("file:///C:/Synthetic/validation.mjs", "c:\\Synthetic\\validation.mjs", { platform: "win32" }), true);
assert.equal(isDirectEsModule("file:///C:/Synthetic/validation.mjs", "C:\\Synthetic\\other.mjs", { platform: "win32" }), false);
assert.equal(isDirectEsModule("not-a-file-url", "C:\\Synthetic\\validation.mjs", { platform: "win32" }), false);
assert.equal(isDirectEsModule("file:///opt/validation.mjs", undefined, { platform: "linux" }), false);
const report = await offlineReport();
assert.equal(report.httpRequests, 0);
await assert.rejects(runHybridDevelopment([]), /hybrid_live_confirmation_required/);
await assert.rejects(runHybridDevelopment(["--live-development", "--hybrid-sql-editor", "--confirm-development-smoke"]), /development_target_required/);
console.log("scheduler entrypoint: 9 fixtures, 0 failed, 0 skipped, 0 not-run");
