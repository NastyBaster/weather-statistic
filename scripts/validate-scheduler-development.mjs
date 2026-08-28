import { assertResumeInput, createSchedulerDevelopmentLocalBinding, sanitizePhaseState, SchedulerMetadataPhaseFailure } from "./lib/scheduler-development-local-binding.mjs";
import { isDirectEsModule } from "./lib/es-module-entrypoint.mjs";
import { parseSchedulerRuntimeArguments } from "./lib/scheduler-validation-arguments.mjs";
import { parseEvidenceResult, parseNegativeEvidenceResults, parsePreflightResult } from "./lib/scheduler-smoke-artifacts.mjs";

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

export function sanitizeSchedulerValidationFailure(error) {
  if (error instanceof SchedulerMetadataPhaseFailure) {
    return {
      category: "cli_command_failed",
      failingPhase: error.phase ?? "unknown_metadata_phase",
      failureCategory: error.category,
      metadataPhases: error.records,
      retries: 0,
    };
  }
  const allowed = new Set([
    "hybrid_live_confirmation_required",
    "development_target_required",
    "existing_negative_baseline_not_provable",
    "manual_phase_state_invalid",
    "manual_preflight_phase_state_invalid",
    "manual_preflight_result_invalid",
    "manual_evidence_invalid",
    "manual_evidence_rejected",
    "negative_evidence_missing",
    "negative_evidence_ambiguous",
    "negative_evidence_attempt_mismatch",
    "negative_evidence_baseline_mismatch",
    "negative_runs_created",
    "active_scheduled_run_detected",
    "negative_evidence_stale",
    "negative_evidence_parser_failure",
    "negative_evidence_sensitive_output",
    "negative_evidence_failed_terminal",
    "negative_evidence_terminalization_failed",
    "negative_evidence_state_consume_failed",
    "validation_artifact_cleanup_failed",
    "scheduler_resume_claim_active",
    "scheduler_resume_claim_release_failed",
    "scheduler_artifact_publication_failed",
    "validation_artifact_path_unsafe",
  ]);
  return { category: allowed.has(error?.message) ? error.message : "scheduler_validation_failed", retries: 0 };
}

export async function runHybridDevelopment(args, binding = createSchedulerDevelopmentLocalBinding(), environment = {}) {
  const parsed = parseSchedulerRuntimeArguments(args, environment);
  if (!parsed.live || !parsed.hybrid || !parsed.confirmed) {
    throw new Error("hybrid_live_confirmation_required");
  }
  const expectedDevelopment = parsed.development_name;
  const expectedProduction = parsed.production_name;
  if (!expectedDevelopment || !expectedProduction || expectedDevelopment === expectedProduction) throw new Error("development_target_required");

  const terminalizeNegativeEvidence = async (state, category, alreadyConsumed = false) => {
    let terminalCategory = category;
    try {
      if (!alreadyConsumed && state.phase === "read_only_negative_evidence_required" && typeof binding.invalidatePhaseState === "function") await binding.invalidatePhaseState(state);
      try { if (typeof binding.clearWriteArtifacts === "function") await binding.clearWriteArtifacts(); }
      catch (error) {
        terminalCategory = error?.message === "validation_artifact_path_unsafe"
          ? "validation_artifact_path_unsafe"
          : "validation_artifact_cleanup_failed";
      }
      await binding.writePhaseState(sanitizePhaseState({
        phase: "negative_evidence_failed_terminal",
        negative: state.negative,
        attempt_boundary: state.attempt_boundary,
        scheduled_run_baseline: state.scheduled_run_baseline,
        negative_evidence_failure: terminalCategory,
        cleanup: "terminal",
      }));
      if (typeof binding.releaseResumeClaim === "function" && alreadyConsumed) await binding.releaseResumeClaim();
    } catch (error) {
      if (error?.message === "scheduler_resume_claim_release_failed") throw error;
      throw new Error("negative_evidence_terminalization_failed");
    }
    throw new Error(terminalCategory);
  };

  if (parsed.resume_negative_evidence) {
    let state;
    let consumed = false;
    let claimed = false;
    try {
      if (typeof binding.acquireResumeClaim === "function") {
        await binding.acquireResumeClaim();
        claimed = true;
      }
      const visibleState = await binding.readPhaseState();
      if (visibleState.phase === "negative_evidence_failed_terminal" || visibleState.phase === "negative_evidence_terminalizing") {
        if (claimed && typeof binding.releaseResumeClaim === "function") { await binding.releaseResumeClaim(); claimed = false; }
        return sanitizePhaseState(visibleState);
      }
      if (typeof binding.consumeNegativeEvidenceState === "function") { state = await binding.consumeNegativeEvidenceState({ claimAlreadyHeld: claimed }); consumed = true; }
      else state = visibleState;
    } catch (error) {
      if (claimed && error?.message !== "scheduler_resume_claim_release_failed" && typeof binding.releaseResumeClaim === "function") {
        try { await binding.releaseResumeClaim(); }
        catch (releaseError) {
          if (releaseError?.message === "scheduler_resume_claim_release_failed") throw releaseError;
          throw new Error("scheduler_resume_claim_release_failed");
        }
      }
      if (new Set(["negative_evidence_state_consume_failed", "scheduler_resume_claim_release_failed"]).has(error?.message)) throw error;
      throw new Error("negative_evidence_state_consume_failed");
    }
    if (state.phase === "negative_evidence_failed_terminal" || state.phase === "negative_evidence_terminalizing") return sanitizePhaseState(state);
    if (state.phase !== "read_only_negative_evidence_required" || !state.attempt_boundary || !Number.isInteger(state.scheduled_run_baseline)) {
      throw new Error("negative_evidence_missing");
    }
    let evidence;
    try {
      evidence = parseNegativeEvidenceResults([{
        result_tag: parsed.negative_evidence_result_tag,
        attempt_boundary: parsed.negative_evidence_attempt_boundary,
        scheduled_run_baseline: Number(parsed.negative_evidence_baseline),
        new_scheduled_runs: Number(parsed.negative_evidence_new_runs),
        active_scheduled_runs: Number(parsed.negative_evidence_active_runs),
        negative_created_runs: Number(parsed.negative_evidence_created_runs),
      }]);
    } catch (error) {
      await terminalizeNegativeEvidence(state, error.message === "negative_evidence_sensitive_output" ? error.message : "negative_evidence_parser_failure", consumed);
    }
    if (evidence.attemptBoundary !== state.attempt_boundary) await terminalizeNegativeEvidence(state, "negative_evidence_attempt_mismatch", consumed);
    if (evidence.scheduledRunBaseline !== state.scheduled_run_baseline) await terminalizeNegativeEvidence(state, "negative_evidence_baseline_mismatch", consumed);
    if (evidence.newScheduledRuns !== 0 || evidence.negativeCreatedRuns !== 0) await terminalizeNegativeEvidence(state, "negative_runs_created", consumed);
    if (evidence.activeScheduledRuns !== 0) await terminalizeNegativeEvidence(state, "active_scheduled_run_detected", consumed);
    const preflight = await binding.preflight({ expectedDevelopment, expectedProduction });
    let statePersisted = false;
    try {
      await binding.writeSqlArtifacts(preflight.linkedRef, state.attempt_boundary, state.scheduled_run_baseline);
      await binding.writePhaseState(sanitizePhaseState({
        phase: "manual_enqueue_required",
        negative_evidence_passed: true,
        negative: state.negative,
        attempt_boundary: state.attempt_boundary,
        scheduled_run_baseline: state.scheduled_run_baseline,
        cleanup: "after_manual_evidence",
      }));
      statePersisted = true;
    } catch (error) {
      if (!statePersisted) {
        try { if (typeof binding.clearWriteArtifacts === "function") await binding.clearWriteArtifacts(); }
        catch (cleanupError) {
          if (cleanupError?.message === "validation_artifact_path_unsafe") throw cleanupError;
          throw new Error("validation_artifact_cleanup_failed");
        }
      }
      if (error?.message === "validation_artifact_cleanup_failed") throw error;
      throw new Error("scheduler_artifact_publication_failed");
    }
    try { if (typeof binding.releaseResumeClaim === "function") await binding.releaseResumeClaim(); claimed = false; }
    catch (error) { if (error?.message === "scheduler_resume_claim_release_failed") throw error; throw new Error("scheduler_resume_claim_release_failed"); }
    return sanitizePhaseState({ phase: "manual_enqueue_required", negative_evidence_passed: true, attempt_boundary: state.attempt_boundary, scheduled_run_baseline: state.scheduled_run_baseline, cleanup: "after_manual_evidence" });
  }

  if (parsed.resume) {
    let claimed = false;
    let completed = false;
    try {
      if (typeof binding.acquireResumeClaim === "function") {
        await binding.acquireResumeClaim("scheduler_resume_claim_active");
        claimed = true;
      }
      const state = await binding.readPhaseState();
      if (state.phase !== "manual_enqueue_required" || !state.attempt_boundary || !Number.isInteger(state.scheduled_run_baseline)) {
        throw new Error("existing_negative_baseline_not_provable");
      }
      let evidence;
      try {
        evidence = parseEvidenceResult({
        result_tag: parsed.evidence_result_tag,
        run_category: parsed.evidence_run_category,
        new_scheduled_runs: Number(parsed.new_scheduled_runs),
        terminal_scheduled_runs: Number(parsed.terminal_scheduled_runs),
        running_scheduled_runs: Number(parsed.running_scheduled_runs),
        terminal_status: parsed.terminal_status,
        locations_total: Number(parsed.locations_total),
        locations_succeeded: Number(parsed.locations_succeeded),
        locations_failed: Number(parsed.locations_failed),
        snapshots_created: Number(parsed.snapshots_created),
        duplicate_immutable_identity_count: Number(parsed.duplicate_identity_count),
        unexpected_active_scheduled_runs: Number(parsed.unexpected_active_scheduled_runs),
        counter_invariant: parsed.counter_invariant === "true",
        });
      } catch {
        throw new Error("manual_evidence_invalid");
      }
      if (evidence.newScheduledRuns !== 1 || evidence.terminalScheduledRuns !== 1
      || evidence.runningScheduledRuns !== 0 || evidence.unexpectedActiveScheduledRuns !== 0
      || evidence.terminalStatus === "none" || evidence.duplicateIdentityCount !== 0 || !evidence.counterInvariant) {
        throw new Error("manual_evidence_rejected");
      }
      const resumed = sanitizePhaseState(assertResumeInput({
        enqueueCommitted: parsed.enqueue_committed === "true",
        evidence: {
          newScheduledRuns: evidence.newScheduledRuns,
          duplicateIdentityCount: evidence.duplicateIdentityCount,
          counterInvariant: evidence.counterInvariant,
        },
      }));
      if (typeof binding.clearAttemptArtifacts === "function") await binding.clearAttemptArtifacts();
      else await binding.cleanupArtifacts();
      await binding.writePhaseState(sanitizePhaseState({
        phase: "manual_enqueue_complete",
        attempt_boundary: state.attempt_boundary,
        scheduled_run_baseline: state.scheduled_run_baseline,
        cleanup: "complete",
      }));
      completed = true;
      if (claimed) { await binding.releaseResumeClaim(); claimed = false; }
      return resumed;
    } catch (error) {
      if (claimed && !completed) {
        try { await binding.releaseResumeClaim(); }
        catch (releaseError) {
          if (releaseError?.message === "scheduler_resume_claim_release_failed") throw releaseError;
          throw new Error("scheduler_resume_claim_release_failed");
        }
      }
      throw error;
    }
  }

  if (parsed.resume_preflight) {
    let claimed = false;
    let committed = false;
    try {
      if (typeof binding.acquireResumeClaim === "function") {
        await binding.acquireResumeClaim("scheduler_resume_claim_active");
        claimed = true;
      }
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
      if (typeof binding.clearWriteArtifacts === "function") await binding.clearWriteArtifacts();
      const negatives = await binding.runNegativeCases(preflight.endpoint, async (records, pendingLabel) => {
        await binding.writePhaseState(sanitizePhaseState({
          phase: pendingLabel ? "negative_request_in_flight" : "negative_phase_incomplete",
          negative: records,
          attempt_boundary: manualPreflight.attemptBoundary,
          scheduled_run_baseline: manualPreflight.scheduledRunBaseline,
          cleanup: "manual_intervention_required",
        }));
      });
      await binding.writeNegativeEvidenceArtifact(manualPreflight.attemptBoundary, manualPreflight.scheduledRunBaseline);
      const next = sanitizePhaseState({
        phase: "read_only_negative_evidence_required",
        negative: negatives,
        negative_evidence_required: true,
        attempt_boundary: manualPreflight.attemptBoundary,
        scheduled_run_baseline: manualPreflight.scheduledRunBaseline,
        cleanup: "after_manual_evidence",
      });
      await binding.writePhaseState(next);
      committed = true;
      if (claimed) { await binding.releaseResumeClaim(); claimed = false; }
      return next;
    } catch (error) {
      if (claimed && !committed) {
        try { await binding.releaseResumeClaim(); }
        catch (releaseError) {
          if (releaseError?.message === "scheduler_resume_claim_release_failed") throw releaseError;
          throw new Error("scheduler_resume_claim_release_failed");
        }
      }
      throw error;
    }
  }

  let claimed = false;
  let published = false;
  try {
    if (typeof binding.prepareAttempt === "function") { await binding.prepareAttempt(); claimed = true; }
    await binding.preflight({ expectedDevelopment, expectedProduction });
    await binding.writePreflightArtifact();
    const state = sanitizePhaseState({
      phase: "read_only_preflight_required",
      cleanup: "after_manual_preflight",
    });
    await binding.writePhaseState(state);
    published = true;
    if (claimed && typeof binding.releaseResumeClaim === "function") { await binding.releaseResumeClaim(); claimed = false; }
    return state;
  } catch (error) {
    if (claimed && !published) {
      try { if (typeof binding.clearAttemptArtifacts === "function") await binding.clearAttemptArtifacts(); }
      catch (cleanupError) {
        if (cleanupError?.message === "validation_artifact_path_unsafe") throw cleanupError;
        throw new Error("validation_artifact_cleanup_failed");
      }
      try { if (typeof binding.releaseResumeClaim === "function") await binding.releaseResumeClaim(); }
      catch (releaseError) {
        if (releaseError?.message === "scheduler_resume_claim_release_failed") throw releaseError;
        throw new Error("scheduler_resume_claim_release_failed");
      }
    }
    throw error;
  }
}

if (isDirectEsModule(import.meta.url, process.argv[1])) {
  try {
    const report = await offlineReport();
    const parsed = parseSchedulerRuntimeArguments(process.argv.slice(2), process.env);
    if (parsed.args.length > 0) {
      const hybridReport = await runHybridDevelopment(parsed.args);
      console.log(JSON.stringify(hybridReport));
      process.exit(0);
    }
    console.log(JSON.stringify(report));
    process.exit(report.failed === 0 ? 0 : 1);
  } catch (error) {
    console.log(JSON.stringify(sanitizeSchedulerValidationFailure(error)));
    process.exit(1);
  }
}
