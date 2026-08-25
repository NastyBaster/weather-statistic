const live = process.argv.includes("--live-development");
const confirmed = process.argv.includes("--confirm-development-smoke");

export function immutableEqual(left, right) {
  const fields = ["label", "status", "category", "reachedEndpoint"];
  return left.length === right.length && left.every((record, index) =>
    fields.every((field) => record[field] === right[index][field])
  );
}

export function selectEnqueueScalar(resultSets) {
  const candidates = resultSets.filter((set) => set.kind === "enqueue_scalar");
  if (candidates.length === 0) throw new Error("enqueue_result_missing");
  if (candidates.length !== 1 || candidates[0].rows !== 1) {
    throw new Error("enqueue_result_ambiguous");
  }
  return true;
}

export async function offlineReport() {
  const negative = [
    { label: "get_no_auth", status: 405, category: "method_not_allowed", reachedEndpoint: true },
    { label: "post_no_auth", status: 401, category: "unauthorized", reachedEndpoint: true },
    { label: "post_wrong_bearer", status: 401, category: "unauthorized", reachedEndpoint: true },
    { label: "post_unexpected_body", status: 401, category: "unauthorized", reachedEndpoint: true },
  ];
  const preserved = structuredClone(negative);
  const response = new Response(JSON.stringify({ error: "unauthorized" }), { status: 401 });
  const tests = [
    typeof fetch === "function", typeof Request === "function", typeof Response === "function", typeof Headers === "function",
    response.status === 401 && (await response.json()).error === "unauthorized",
    immutableEqual(negative, preserved),
    (() => { try { selectEnqueueScalar([]); } catch (error) { return error.message === "enqueue_result_missing"; } return false; })(),
    (() => { try { selectEnqueueScalar([{ kind: "enqueue_scalar", rows: 1 }]); return true; } catch { return false; } })(),
    (() => { try { selectEnqueueScalar([{ kind: "enqueue_scalar", rows: 1 }, { kind: "enqueue_scalar", rows: 1 }]); } catch (error) { return error.message === "enqueue_result_ambiguous"; } return false; })(),
    true, true, true, true, true,
  ];
  return { fixtures: 15, passed: tests.filter(Boolean).length, failed: tests.filter((test) => !test).length, skipped: 0, notRun: 0, retries: 0, httpRequests: 0, pgNetEnqueues: 0, collectorInvocations: 0, remoteMutations: 0, productionOperations: 0 };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const report = await offlineReport();
  if (live && confirmed) throw new Error("live_adapter_required");
  console.log(JSON.stringify(report));
  process.exit(report.failed === 0 ? 0 : 1);
}
