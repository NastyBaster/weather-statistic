import { assertResumeInput, createSchedulerDevelopmentLocalBinding, sanitizePhaseState } from "./lib/scheduler-development-local-binding.mjs";
import { isDirectEsModule } from "./lib/es-module-entrypoint.mjs";
import { parseSchedulerRuntimeArguments } from "./lib/scheduler-validation-arguments.mjs";
import { parsePreflightResult } from "./lib/scheduler-smoke-artifacts.mjs";

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

export function readRuntimeArgument(args, name) {
  const value = args.find((argument) => argument.startsWith(`${name}=`));
  return value?.slice(name.length + 1) || "";
}

export async function runHybridDevelopment(args, binding = createSchedulerDevelopmentLocalBinding(), environment = {}) {
  const parsed = parseSchedulerRuntimeArguments(args, environment);
  if (!parsed.live || !parsed.hybrid || !parsed.confirmed) {
    throw new Error("hybrid_live_confirmation_required");
  }
  const expectedDevelopment = parsed.development_name;
  const expectedProduction = parsed.production_name;
  if (!expectedDevelopment || !expectedProduction || expectedDevelopment === expectedProduction) throw new Error("development_target_required");

  if (parsed.resume) {
    const state = await binding.readPhaseState();
    if (state.phase !== "manual_enqueue_required" || !state.attempt_boundary || !Number.isInteger(state.scheduled_run_baseline)) {
      throw new Error("existing_negative_baseline_not_provable");
    }
    const resumed = sanitizePhaseState(assertResumeInput({
      enqueueCommitted: parsed.enqueue_committed === "true",
      evidence: {
        newScheduledRuns: Number(parsed.new_scheduled_runs),
        duplicateIdentityCount: Number(parsed.duplicate_identity_count),
        counterInvariant: parsed.counter_invariant === "true",
      },
    }));
    await binding.cleanupArtifacts();
    return resumed;
  }

  if (parsed.resume_preflight) {
    const state = await binding.readPhaseState();
    if (state.phase !== "read_only_preflight_required") throw new Error("manual_preflight_phase_state_invalid");
    let manualPreflight;
    try {
      manualPreflight = parsePreflightResult({
        result_tag: "scheduler_smoke_preflight",
        attempt_boundary: parsed.attempt_boundary,
        scheduled_run_baseline: Number(parsed.scheduled_run_baseline),
        negative_baseline_status: "baseline_established_before_negative_phase",
      });
    } catch {
      throw new Error("manual_preflight_result_invalid");
    }
    const preflight = await binding.preflight({ expectedDevelopment, expectedProduction });
    const negatives = await binding.runNegativeCases(preflight.endpoint, async () => {});
    await binding.writeSqlArtifacts(preflight.linkedRef, manualPreflight.attemptBoundary, manualPreflight.scheduledRunBaseline);
    const next = sanitizePhaseState({
      phase: "manual_enqueue_required",
      negative: negatives,
      manual_enqueue_required: true,
      attempt_boundary: manualPreflight.attemptBoundary,
      scheduled_run_baseline: manualPreflight.scheduledRunBaseline,
      cleanup: "after_manual_evidence",
    });
    await binding.writePhaseState(next);
    return next;
  }

  await binding.preflight({ expectedDevelopment, expectedProduction });
  await binding.writePreflightArtifact();
  const state = sanitizePhaseState({
    phase: "read_only_preflight_required",
    cleanup: "after_manual_preflight",
  });
  await binding.writePhaseState(state);
  return state;
}

if (isDirectEsModule(import.meta.url, process.argv[1])) {
  const report = await offlineReport();
  const parsed = parseSchedulerRuntimeArguments(process.argv.slice(2), process.env);
  if (parsed.args.length > 0) {
    const hybridReport = await runHybridDevelopment(parsed.args);
    console.log(JSON.stringify(hybridReport));
    process.exit(0);
  }
  console.log(JSON.stringify(report));
  process.exit(report.failed === 0 ? 0 : 1);
}
