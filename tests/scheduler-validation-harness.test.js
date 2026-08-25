import assert from "node:assert/strict";
import { immutableEqual, offlineReport, selectEnqueueScalar } from "../scripts/validate-scheduler-development.mjs";

const report = await offlineReport();
assert.equal(report.fixtures, 15);
assert.equal(report.failed, 0);
assert.equal(report.retries, 0);
assert.equal(report.httpRequests, 0);
assert.equal(immutableEqual([{ label: "x", status: 401, category: "unauthorized", reachedEndpoint: true }], [{ label: "x", status: 401, category: "unauthorized", reachedEndpoint: true }]), true);
assert.throws(() => selectEnqueueScalar([]), /enqueue_result_missing/);
assert.throws(() => selectEnqueueScalar([{ kind: "enqueue_scalar", rows: 1 }, { kind: "enqueue_scalar", rows: 1 }]), /enqueue_result_ambiguous/);
console.log("scheduler validation harness: 15 fixtures, 0 failed, 0 skipped, 0 not-run");
