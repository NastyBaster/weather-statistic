const BOOLEAN_FLAGS = ["live-development", "hybrid-sql-editor", "confirm-development-smoke", "resume-after-manual-enqueue", "resume-after-manual-preflight", "resume-after-negative-evidence"];
const VALUE_FLAGS = ["development-name", "production-name", "enqueue-committed", "new-scheduled-runs", "duplicate-identity-count", "counter-invariant", "attempt-boundary", "scheduled-run-baseline", "evidence-result-tag", "evidence-run-category", "terminal-scheduled-runs", "running-scheduled-runs", "terminal-status", "locations-total", "locations-succeeded", "locations-failed", "snapshots-created", "unexpected-active-scheduled-runs", "negative-evidence-result-tag", "negative-evidence-attempt-boundary", "negative-evidence-baseline", "negative-evidence-new-runs", "negative-evidence-active-runs", "negative-evidence-created-runs"];

const envKey = (flag) => `npm_config_${flag.replaceAll("-", "_")}`;
const environmentValue = (environment, flag) => environment[envKey(flag)] ?? environment[envKey(flag).toUpperCase()];

export function npmForwardedRuntimeArguments(argv = [], environment = {}) {
  if (!Array.isArray(argv)) throw new Error("runtime_arguments_malformed");
  const direct = argv.filter((value) => value !== "--");
  if (direct.length > 0) return direct;

  const forwarded = [];
  for (const flag of BOOLEAN_FLAGS) {
    const value = environmentValue(environment, flag);
    if (value === "true" || value === "1") forwarded.push(`--${flag}`);
    else if (value !== undefined && value !== "false" && value !== "0" && value !== "") throw new Error("npm_forwarded_flag_malformed");
  }
  for (const flag of VALUE_FLAGS) {
    const value = environmentValue(environment, flag);
    if (value !== undefined) forwarded.push(`--${flag}=${value}`);
  }
  return forwarded;
}

export function parseSchedulerRuntimeArguments(argv = [], environment = {}) {
  const argumentsToParse = npmForwardedRuntimeArguments(argv, environment);
  const parsed = { args: argumentsToParse, live: false, hybrid: false, confirmed: false };
  const seen = new Set();
  for (const argument of argumentsToParse) {
    if (typeof argument !== "string" || !argument.startsWith("--")) throw new Error("runtime_argument_unknown");
    const [name, ...valueParts] = argument.slice(2).split("=");
    const hasValue = valueParts.length > 0;
    if (![...BOOLEAN_FLAGS, ...VALUE_FLAGS].includes(name)) throw new Error("runtime_argument_unknown");
    if (seen.has(name)) throw new Error("runtime_argument_duplicate");
    seen.add(name);
    if (BOOLEAN_FLAGS.includes(name)) {
      if (hasValue) throw new Error("runtime_argument_malformed");
      if (name === "live-development") parsed.live = true;
      if (name === "hybrid-sql-editor") parsed.hybrid = true;
      if (name === "confirm-development-smoke") parsed.confirmed = true;
      if (name === "resume-after-manual-enqueue") parsed.resume = true;
      if (name === "resume-after-manual-preflight") parsed.resume_preflight = true;
      if (name === "resume-after-negative-evidence") parsed.resume_negative_evidence = true;
      continue;
    }
    const value = valueParts.join("=");
    if (!hasValue || value.trim() === "" || /[\r\n]/.test(value)) throw new Error("runtime_argument_malformed");
    parsed[name.replaceAll("-", "_")] = value;
  }
  return parsed;
}
