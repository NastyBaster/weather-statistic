import test from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { checkCommandsForIds } from "../../scripts/agent-bridge/core.mjs";
import { statusSnapshot, run } from "../../scripts/agent-bridge/cli.mjs";

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

test("exact task allowlist reaches post-child and post-check validation call sites", async () => {
  const source = await readFile(cliPath, "utf8");
  assert.match(source, /const postChild = await statusSnapshot\(worktree, contract\.allowedPaths\);/);
  assert.match(source, /const postChecks = await statusSnapshot\(worktree, contract\.allowedPaths\);/);
});

test("missing task allowPaths fails closed in the CLI status helper", async () => {
  await assert.rejects(statusSnapshot("unused", undefined, async () => " M docs/AGENT_BRIDGE.md\0"), /missing_task_allowed_paths/);
});

test("task allowlist violation blocks before staging commit push and pr creation", async () => {
  const source = await readFile(cliPath, "utf8");
  assert.match(source, /if \(!postChild\.valid\) throw new Error\(postChild\.category \|\| "unsafe_changed_paths"\);[\s\S]*await git\(\["add", "--", \.\.\.changed\], worktree\);/);
  assert.match(source, /if \(!postChecks\.valid\) throw new Error\(postChecks\.category \|\| "unsafe_changed_paths"\);[\s\S]*await git\(\["add", "--", \.\.\.changed\], worktree\);/);
});

test("windows adapter can execute a harmless fixed npm fixture when running on Windows", async () => {
  if (process.platform !== "win32") return;
  const workdir = await mkdtemp(path.join(os.tmpdir(), "bridge-npm-fixture-"));
  try {
    await writeFile(path.join(workdir, "package.json"), JSON.stringify({ name: "bridge-npm-fixture", private: true, scripts: { "test:bridge": "node -e \"process.exit(0)\"" } }));
    const command = checkCommandsForIds(["bridge-tests"], { platform: "win32", env: { ComSpec: process.env.ComSpec || "cmd.exe" } })[0];
    const result = await run(command.command, command.args, workdir);
    assert.equal(result.code, 0);
  } finally {
    await rm(workdir, { recursive: true, force: true });
  }
});

test("windows adapter propagates fixed npm check failures", async () => {
  if (process.platform !== "win32") return;
  const workdir = await mkdtemp(path.join(os.tmpdir(), "bridge-npm-failure-"));
  try {
    await writeFile(path.join(workdir, "package.json"), JSON.stringify({ name: "bridge-npm-failure", private: true, scripts: { check: "node -e \"process.exit(3)\"" } }));
    const command = checkCommandsForIds(["npm-check"], { platform: "win32", env: { ComSpec: process.env.ComSpec || "cmd.exe" } })[0];
    await assert.rejects(run(command.command, command.args, workdir), /failed: 3/);
  } finally {
    await rm(workdir, { recursive: true, force: true });
  }
});

test("shell:false remains enforced and shell:true does not appear in the bridge implementation", async () => {
  const [cliSource, coreSource] = await Promise.all([readFile(cliPath, "utf8"), readFile(path.join(repoRoot, "scripts", "agent-bridge", "core.mjs"), "utf8")]);
  assert.match(cliSource, /shell: false/);
  assert.match(coreSource, /shell: false/);
  assert.doesNotMatch(cliSource, /shell:\s*true/);
  assert.doesNotMatch(coreSource, /shell:\s*true/);
});

test("untrusted issue text commit messages and allowed paths never reach fixed check command arguments", () => {
  const issueText = "&& calc.exe";
  const commitMessage = "docs: record verified development forecast scan";
  const allowed = "docs/AGENT_BRIDGE.md";
  const commands = checkCommandsForIds(["bridge-tests", "npm-check"], { platform: "win32", env: { ComSpec: "cmd.exe" } });
  for (const command of commands) {
    const rendered = [command.command, ...command.args].join(" ");
    assert.equal(rendered.includes(issueText), false);
    assert.equal(rendered.includes(commitMessage), false);
    assert.equal(rendered.includes(allowed), false);
  }
});
