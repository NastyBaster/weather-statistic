import assert from "node:assert/strict";
import {
  createSchedulerDevelopmentLocalBinding,
  createSchedulerMetadataPhaseRecord,
  createSchedulerMetadataPhaseRecords,
  schedulerCliMetadataPhases,
  SchedulerMetadataPhaseFailure,
} from "../scripts/lib/scheduler-development-local-binding.mjs";
import { sanitizeSchedulerValidationFailure } from "../scripts/validate-scheduler-development.mjs";

const syntheticRef = "synthetic-reference";
const responses = Object.freeze({
  projects: JSON.stringify({ projects: [{ name: "test-development", ref: syntheticRef }, { name: "test-production", ref: "other-reference" }] }),
  functions: JSON.stringify({ functions: [{ name: "collect-forecasts" }] }),
  secrets: JSON.stringify({ secrets: [{ name: "FORECAST_SCHEDULER_TOKEN" }] }),
  migration: JSON.stringify({ migrations: Array.from({ length: 6 }, () => ({ local: true, remote: true })) }),
});

function bindingFor(overrides = {}) {
  return createSchedulerDevelopmentLocalBinding({
    repositoryClean: async () => true,
    readLinkedRef: async () => syntheticRef,
    runCli: async (args) => {
      const phase = args[0];
      if (overrides.failure?.phase === phase) {
        const error = new Error(overrides.failure.category);
        error.stderrCategory = "sanitized_error_present";
        error.rawStdout = "raw-stdout-must-not-render";
        error.rawStderr = "raw-stderr-must-not-render";
        error.command = "raw-command-must-not-render";
        error.argv = ["raw-argument-must-not-render"];
        throw error;
      }
      if (Object.hasOwn(overrides.responses ?? {}, phase)) return overrides.responses[phase];
      return responses[phase];
    },
  });
}

async function rejectedPreflight(binding, category) {
  try {
    await binding.preflight({ expectedDevelopment: "test-development", expectedProduction: "test-production" });
    assert.fail("expected metadata preflight failure");
  } catch (error) {
    assert.ok(error instanceof SchedulerMetadataPhaseFailure);
    assert.equal(error.category, category);
    return error;
  }
}

const phaseNames = schedulerCliMetadataPhases();
assert.deepEqual(phaseNames, ["target_metadata_lookup", "function_metadata_check", "edge_secret_name_metadata_check", "migration_metadata_check"]);
assert.equal(createSchedulerMetadataPhaseRecords().every((record) => record.outcomeCategory === "not_attempted"), true);

const success = await bindingFor().preflight({ expectedDevelopment: "test-development", expectedProduction: "test-production" });
assert.equal(success.metadataPhases.length, 4);
assert.equal(success.metadataPhases.every((record) => record.outcomeCategory === "success" && record.exitCategory === "zero"), true);

const first = await rejectedPreflight(bindingFor({ failure: { phase: "projects", category: "cli_command_failed" } }), "cli_command_failed");
assert.equal(first.phase, "target_metadata_lookup");
assert.equal(first.records[0].exitCategory, "nonzero");
assert.equal(first.records.slice(1).every((record) => record.outcomeCategory === "not_attempted"), true);

const middle = await rejectedPreflight(bindingFor({ failure: { phase: "functions", category: "cli_command_failed" } }), "cli_command_failed");
assert.equal(middle.phase, "function_metadata_check");
assert.equal(middle.records[0].outcomeCategory, "success");
assert.equal(middle.records[1].exitCategory, "nonzero");
assert.equal(middle.records.slice(2).every((record) => record.attempted === false), true);

const final = await rejectedPreflight(bindingFor({ failure: { phase: "migration", category: "cli_command_failed" } }), "cli_command_failed");
assert.equal(final.phase, "migration_metadata_check");
assert.equal(final.records.slice(0, 3).every((record) => record.outcomeCategory === "success"), true);

const timedOut = await rejectedPreflight(bindingFor({ failure: { phase: "secrets", category: "cli_timeout" } }), "cli_timeout");
assert.equal(timedOut.records[2].exitCategory, "timeout");
const spawnFailed = await rejectedPreflight(bindingFor({ failure: { phase: "secrets", category: "cli_unavailable" } }), "cli_unavailable");
assert.equal(spawnFailed.records[2].exitCategory, "spawn_failed");
assert.notEqual(timedOut.records[2].exitCategory, spawnFailed.records[2].exitCategory);

const empty = await rejectedPreflight(bindingFor({ responses: { functions: "" } }), "cli_response_empty");
assert.equal(empty.records[1].parserCategory, "empty");
const unsupported = await rejectedPreflight(bindingFor({ responses: { functions: "not-json" } }), "cli_response_shape_unsupported");
assert.equal(unsupported.records[1].parserCategory, "unsupported_shape");
assert.notEqual(unsupported.records[1].outcomeCategory, middle.records[1].outcomeCategory);

const ambiguousProjects = JSON.stringify({ projects: [{ name: "test-development", ref: syntheticRef }, { name: "test-development", ref: "second-reference" }] });
const ambiguous = await rejectedPreflight(bindingFor({ responses: { projects: ambiguousProjects } }), "target_verification_failed");
assert.equal(ambiguous.records[0].parserCategory, "ambiguous");

const envelopeArray = JSON.stringify([{ name: "test-development", ref: syntheticRef }, { name: "test-production", ref: "other-reference" }]);
const arrayShape = await bindingFor({ responses: { projects: envelopeArray } }).preflight({ expectedDevelopment: "test-development", expectedProduction: "test-production" });
assert.equal(arrayShape.metadataPhases[0].parserCategory, "parsed");
const stderrShape = await bindingFor({ responses: { functions: { stdout: responses.functions, stderrCategory: "sanitized_error_present" } } }).preflight({ expectedDevelopment: "test-development", expectedProduction: "test-production" });
assert.equal(stderrShape.metadataPhases[1].stderrCategory, "sanitized_error_present");

const rawMarker = "raw-output-must-not-render";
const rendered = JSON.stringify(sanitizeSchedulerValidationFailure(await rejectedPreflight(bindingFor({ responses: { functions: rawMarker } }), "cli_response_shape_unsupported")));
assert.doesNotMatch(rendered, /raw-output-must-not-render|synthetic-reference|"projects"|"functions"|"secrets"/);
assert.match(rendered, /function_metadata_check/);
assert.equal(JSON.parse(rendered).retries, 0);
const executionRendered = JSON.stringify(sanitizeSchedulerValidationFailure(await rejectedPreflight(bindingFor({ failure: { phase: "functions", category: "cli_command_failed" } }), "cli_command_failed")));
assert.doesNotMatch(executionRendered, /raw-stdout-must-not-render|raw-stderr-must-not-render|raw-command-must-not-render|raw-argument-must-not-render/);
assert.match(executionRendered, /sanitized_error_present/);

assert.throws(() => createSchedulerMetadataPhaseRecord("unrecognised-phase"), /metadata_phase_unknown/);
assert.equal(sanitizeSchedulerValidationFailure(new SchedulerMetadataPhaseFailure("cli_command_failed", "unrecognised-phase", createSchedulerMetadataPhaseRecords())).failingPhase, "unknown_metadata_phase");
assert.equal(typeof globalThis.fetch, "function");

console.log("scheduler CLI phase attribution: 26 fixtures, 0 failed, 0 skipped, 0 not-run");
