import os from "node:os";
import path from "node:path";
import { parseConfig, dryRunPlan } from "./core.mjs";
import { ownerPresent } from "./ownership.mjs";
import { runDoctor } from "./doctor.mjs";
export function runtimeRoot() { return path.join(process.env.LOCALAPPDATA || os.tmpdir(), "ForecastRealityCheck", "agent-bridge", "weather-statistic"); }
const command = process.argv[2];
if (command === "doctor") { const result = runDoctor({ repository: "NastyBaster/weather-statistic", branch: "unknown", clean: false, synchronized: false, git: true, ghAuth: false, codex: false, workflows: false, labels: [], protection: false, runtimeEnabled: false, runtimeRootSafe: true }); console.log(JSON.stringify({ command: "doctor", pass: result.pass, failures: result.failures })); process.exitCode = result.pass ? 0 : 1; }
else if (command === "once") { console.log(JSON.stringify({ command: "once", config: parseConfig(process.argv.slice(3)), ownerPresent: await ownerPresent(runtimeRoot()), outcome: "dry-run-only" })); }
