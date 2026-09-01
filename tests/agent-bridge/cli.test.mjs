import test from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import { mkdtemp, rm } from "node:fs/promises";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const cliPath = path.join(repoRoot, "scripts", "agent-bridge", "cli.mjs");

function runCli(args, env, cwd = repoRoot) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [cliPath, ...args], {
      cwd,
      env,
      shell: false,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.on("error", reject);
    child.on("close", (code) => resolve({ code, stdout, stderr }));
  });
}

test("invalid commit message fails before ownership worktree and child mutation", async () => {
  const localAppData = await mkdtemp(path.join(os.tmpdir(), "bridge-cli-invalid-commit-"));
  try {
    const result = await runCli(["once", "--commit-message", " docs: invalid"], { ...process.env, BRIDGE_DRY_RUN: "false", LOCALAPPDATA: localAppData });
    const payload = JSON.parse(result.stdout.trim());
    assert.equal(result.code, 1);
    assert.equal(payload.category, "commit_message_whitespace");
    assert.equal(payload.mutations, 0);
    await assert.rejects(rm(path.join(localAppData, "ForecastRealityCheck"), { recursive: true, force: false }), /ENOENT/);
  } finally {
    await rm(localAppData, { recursive: true, force: true });
  }
});

test("unknown check id fails before ownership worktree and child mutation", async () => {
  const localAppData = await mkdtemp(path.join(os.tmpdir(), "bridge-cli-invalid-check-"));
  try {
    const result = await runCli(["once", "--checks", "bridge-tests,nope"], { ...process.env, BRIDGE_DRY_RUN: "false", LOCALAPPDATA: localAppData });
    const payload = JSON.parse(result.stdout.trim());
    assert.equal(result.code, 1);
    assert.equal(payload.category, "unknown_safe_check_id");
    assert.equal(payload.mutations, 0);
    await assert.rejects(rm(path.join(localAppData, "ForecastRealityCheck"), { recursive: true, force: false }), /ENOENT/);
  } finally {
    await rm(localAppData, { recursive: true, force: true });
  }
});
