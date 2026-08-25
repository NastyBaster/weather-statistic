const safe = (value) => value;

export function requireLiveActivation(args, expectedDevelopment, expectedProduction) {
  if (!args.includes("--live-development") || !args.includes("--confirm-development-smoke")) throw new Error("live_confirmation_required");
  if (!expectedDevelopment || !expectedProduction || expectedDevelopment === expectedProduction) throw new Error("development_target_required");
}

export async function verifyDevelopment(adapter, expectedDevelopment, expectedProduction) {
  const metadata = await adapter.metadata();
  const matches = metadata.projects.filter((project) => project.name === expectedDevelopment);
  if (matches.length !== 1 || matches[0].ref !== metadata.linkedRef || metadata.projects.some((project) => project.name === expectedProduction && project.ref === metadata.linkedRef)) throw new Error("target_verification_failed");
  if (metadata.migrations.local !== 6 || metadata.migrations.remote !== 6 || metadata.migrations.pending !== 0 || metadata.migrations.unknown !== 0) throw new Error("migration_state_mismatch");
  if (!metadata.pgNet || !metadata.httpPost || !metadata.functionPresent || !metadata.edgeSecretPresent || !metadata.vaultSecretPresent || metadata.runningScheduled || metadata.cronConfigured) throw new Error("development_preflight_failed");
  return safe({ target: "verified", migrations: "6/6/0/0" });
}

export async function runNegativePhase(fetchImpl, endpoint, save) {
  const cases = [["get_no_auth", "GET", undefined], ["post_no_auth", "POST", "{}"], ["post_wrong_bearer", "POST", "{}"], ["post_unexpected_body", "POST", '{"unexpected":true}']];
  const results = [];
  for (const [label, method, body] of cases) {
    const headers = label === "post_wrong_bearer" ? { authorization: "Bearer invalid-machine-auth-test" } : {};
    const response = await fetchImpl(endpoint, { method, headers, body, redirect: "error" });
    const payload = await response.json();
    results.push(Object.freeze({ label, status: response.status, category: payload.error, reachedEndpoint: true }));
    await save(results.map((result) => ({ ...result })));
  }
  return results;
}

export function parseEnqueue(resultSets) {
  const values = resultSets.filter((set) => set.kind === "enqueue_scalar" && set.rows === 1);
  if (values.length !== 1) throw new Error(values.length ? "enqueue_result_ambiguous" : "enqueue_result_missing");
  return values[0].value;
}

export async function poll(adapter, requestId) {
  for (let attempt = 0; attempt < 1; attempt++) {
    const result = await adapter.poll(requestId);
    if (result) return safe(result);
  }
  return { observed: "timeout" };
}
