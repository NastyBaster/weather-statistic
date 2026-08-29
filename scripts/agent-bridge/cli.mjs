import os from "node:os";
import path from "node:path";
import { mkdir, readFile, rm } from "node:fs/promises";
import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { parseConfig, dryRunPlan, eligible, issueAllowedPaths, branchFor, validateChangedPaths, promptFor, sanitize } from "./core.mjs";
import { acquireOwnership, ownerPresent } from "./ownership.mjs";
import { runDoctor, createRealDoctorAdapter } from "./doctor.mjs";

export function runtimeRoot() { return path.join(process.env.LOCALAPPDATA || os.tmpdir(), "ForecastRealityCheck", "agent-bridge", "weather-statistic"); }
const root = process.cwd();
const command = process.argv[2];
const config = parseConfig(process.argv.slice(3));

function run(program, args, cwd = root, input = "") {
  return new Promise((resolve, reject) => {
    const child = spawn(program, args, { cwd, shell: false, stdio: ["pipe", "pipe", "pipe"] });
    let stdout = ""; let stderr = "";
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.on("error", reject);
    child.on("close", (code) => code === 0 ? resolve({ code, stdout, stderr }) : reject(new Error(program + " failed: " + code + ": " + sanitize(stderr).slice(-500))));
    child.stdin.end(input);
  });
}
async function jsonRun(program, args, cwd = root) { return JSON.parse((await run(program, args, cwd)).stdout); }
async function gh(args) { return (await run("gh", args)).stdout; }
async function git(args, cwd = root) { return (await run("git", args, cwd)).stdout; }
async function codexInvocation() {
  if (process.platform !== "win32") return { command: "codex", args: [] };
  const where = (await run("where.exe", ["codex.cmd"])).stdout.split(/\r?\n/).find(Boolean);
  if (!where) throw new Error("codex_unavailable");
  const entry = path.join(path.dirname(where), "node_modules", "@openai", "codex", "bin", "codex.js");
  return { command: process.execPath, args: [entry] };
}
function safeBranch(issue) { return branchFor(issue).replace(/[^A-Za-z0-9/_-]/g, "-"); }
function markerFor(issue) {
  const comments = issue.comments || [];
  const digest = issue.bodyDigest;
  return comments.some((comment) => comment.author?.login === "github-actions[bot]" && comment.body === "<!-- agent-contract:v1:" + digest + " -->");
}
async function loadReadyIssue() {
  const listed = await jsonRun("gh", ["issue", "list", "--state", "open", "--label", "agent:ready", "--limit", "20", "--json", "number"]);
  for (const entry of listed) {
    const issue = await jsonRun("gh", ["issue", "view", String(entry.number), "--json", "number,title,body,labels,comments,assignees"]);
    const body = String(issue.body || "").replace(/\r\n/g, "\n").trim();
    const digest = (await import("node:crypto")).createHash("sha256").update(body, "utf8").digest("hex");
    issue.bodyDigest = digest;
    if (eligible({ ...issue, validationEvidence: { author: "github-actions[bot]", version: "v1", digest }, labels: issue.labels }) && markerFor(issue)) return issue;
  }
  return null;
}
async function claim(number) { await gh(["issue", "edit", String(number), "--remove-label", "agent:ready", "--add-label", "agent:running", "--add-assignee", "@me"]); }
async function block(number, message) { await gh(["issue", "edit", String(number), "--remove-label", "agent:running", "--add-label", "agent:blocked"]); await gh(["issue", "comment", String(number), "--body", "Bridge blocked: " + sanitize(message)]); }
async function handoff(number, runId, branch, pr) { await gh(["issue", "edit", String(number), "--remove-label", "agent:running", "--add-label", "agent:review"]); await gh(["issue", "comment", String(number), "--body", "Bridge handoff: run " + runId + "; branch " + branch + "; PR #" + pr + "; sanitized audit stored locally."]); }
async function runChild(prompt, cwd) { const invocation = await codexInvocation(); return run(invocation.command, [...invocation.args, "exec", "--ephemeral", prompt], cwd); }
async function once() {
  const runId = "run-" + new Date().toISOString().replace(/[-:.TZ]/g, "") + "-" + randomBytes(4).toString("hex");
  if (config.dryRun) { console.log(JSON.stringify({ command: "once", runId, ...dryRunPlan(null) })); return; }
  const ownership = await acquireOwnership(runtimeRoot(), { mode: "once", runId, dryRun: false });
  let issue; let worktree; let branch;
  try {
    issue = await loadReadyIssue();
    if (!issue) throw new Error("no_eligible_agent_ready_issue");
    await claim(issue.number);
    branch = safeBranch(issue);
    worktree = path.join(root, ".agent-bridge", "worktrees", branch.replaceAll("/", "-"));
    await mkdir(path.dirname(worktree), { recursive: true });
    await git(["worktree", "add", "-b", branch, worktree, "origin/main"]);
    const allowedPaths = issueAllowedPaths(issue);
    const prompt = promptFor(issue, { branch, worktree, allowedPaths });
    const child = await runChild(prompt, worktree);
    if (!child.stdout.trim()) throw new Error("child_returned_no_summary");
    const status = await git(["status", "--short", "--untracked-files=all"], worktree);
    const changed = status.split(/\r?\n/).filter(Boolean).map((line) => line.slice(3).trim()).filter(Boolean);
    const pathCheck = validateChangedPaths(changed, allowedPaths);
    if (!pathCheck.valid || !changed.length) throw new Error("invalid_or_empty_child_changes:" + pathCheck.invalid.join(","));
    await git(["diff", "--check"], worktree);
    await git(["add", "--", ...changed], worktree);
    await git(["diff", "--cached", "--check"], worktree);
    await git(["commit", "-m", "feat: complete bounded agent task"], worktree);
    await git(["push", "-u", "origin", branch], worktree);
    const prBody = "## Issue\n\nCloses #" + issue.number + "\n\n## Summary\n\n" + sanitize(child.stdout).slice(-1000) + "\n\n## Changes\n\n- Child changed only contract-allowed paths.\n\n## Checks\n\n- [x] git diff --check\n\n## Migrations and configuration\n\nNone.\n\n## Screenshots\n\nNot applicable.\n\n## Risks and limitations\n\nBounded child execution; runtime deny policy preserved.\n\n## Rollback\n\nClose PR and preserve branch/worktree for review.\n\n## Handoff\n\nAgent Bridge parent handoff; human merge boundary.";
    const pr = await jsonRun("gh", ["pr", "create", "--base", "main", "--head", branch, "--title", issue.title, "--body", prBody], worktree);
    await handoff(issue.number, runId, branch, pr.number);
    console.log(JSON.stringify({ command: "once", runId, outcome: "handoff", issue: issue.number, branch, pullRequest: pr.number, changedPaths: changed }));
  } catch (error) {
    const message = sanitize(error?.message || error);
    if (issue?.number) await block(issue.number, message);
    console.log(JSON.stringify({ command: "once", runId, outcome: "blocked", issue: issue?.number || null, branch: branch || null, error: message }));
    process.exitCode = 1;
  } finally {
    await ownership.release();
  }
}
if (command === "doctor") {
  const result = await runDoctor(createRealDoctorAdapter(), runtimeRoot());
  console.log(JSON.stringify({ command: "doctor", pass: result.pass, failures: result.failures, checks: result.checks }));
  process.exitCode = result.pass ? 0 : 1;
} else if (command === "once") {
  await once();
} else {
  console.error("Usage: bridge <doctor|once> [--dry-run]");
  process.exitCode = 2;
}
