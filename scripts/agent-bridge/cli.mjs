import os from "node:os";
import path from "node:path";
import { access, mkdir, writeFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { pathToFileURL } from "node:url";
import { parseConfig, dryRunPlan, eligible, branchFor, promptFor, sanitize, parseIssueContract, validateRequiredChecks, prBody, worktreePath, childEnvironment, codexSandboxArgs, validateCommitMessage, validateCheckSelection, validateTaskStatusSnapshot, sameNormalizedPaths } from "./core.mjs";
import { acquireOwnership, ownerPresent } from "./ownership.mjs";
import { buildRetainedTaskState, classifySingletonState, cleanupRetainedTask, inspectCleanupRecovery, parseWorktreeList, writeRetainedTaskState } from "./cleanup.mjs";
import { runDoctor, createRealDoctorAdapter } from "./doctor.mjs";

export function runtimeRoot() { return path.join(process.env.LOCALAPPDATA || os.tmpdir(), "ForecastRealityCheck", "agent-bridge", "weather-statistic"); }
const root = process.cwd();

export function run(program, args, cwd = root, input = "", env) {
  return new Promise((resolve, reject) => {
    const child = spawn(program, args, { cwd, shell: false, env, stdio: ["pipe", "pipe", "pipe"] });
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
async function pathExists(target) { try { await access(target); return true; } catch { return false; } }
async function gitPathExists(relativePath) { return pathExists((await git(["rev-parse", "--git-path", relativePath])).trim()); }
async function ghJson(args) { return JSON.parse(await gh(args)); }
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
const failureCategories = new Set(["doctor_failed", "no_eligible_issue", "invalid_issue_contract", "child_failed", "unsafe_changed_paths", "required_checks_failed", "commit_or_push_failed", "pull_request_creation_failed", "bridge_execution_failed"]);
async function block(number, category = "bridge_execution_failed") { const safeCategory = failureCategories.has(category) ? category : "bridge_execution_failed"; await gh(["issue", "edit", String(number), "--remove-label", "agent:running", "--add-label", "agent:blocked"]); await gh(["issue", "comment", String(number), "--body", `Bridge blocked: category=${safeCategory}`]); }
async function handoff(number, runId, branch, pr) { await gh(["issue", "edit", String(number), "--remove-label", "agent:running", "--add-label", "agent:review"]); await gh(["issue", "comment", String(number), "--body", "Bridge handoff: run " + runId + "; branch " + branch + "; PR #" + pr + "; sanitized audit stored locally."]); }
async function writeAudit(runId, value) { const dir = path.join(runtimeRoot(), "runs"); await mkdir(dir, { recursive: true }); const safe = { runId, phase: value.phase || "unknown", issue: Number.isSafeInteger(value.issue) ? value.issue : null, branch: value.branch || null, childOutcome: value.childOutcome || null, changedPaths: Array.isArray(value.changedPaths) ? value.changedPaths : [], checks: Array.isArray(value.checks) ? value.checks : [], pr: Number.isSafeInteger(value.pr) ? value.pr : null, outcome: value.outcome || "blocked" }; await writeFile(path.join(dir, `${runId}.json`), JSON.stringify(safe), { flag: "wx", mode: 0o600 }); }
async function runChild(prompt, cwd) { const invocation = await codexInvocation(); return run(invocation.command, [...invocation.args, ...codexSandboxArgs(cwd), prompt], cwd, "", childEnvironment()); }
async function ensureCanonicalCheckoutClean(cwd = root) {
  if ((await git(["branch", "--show-current"], cwd)).trim() !== "main") throw new Error("main_required");
  if ((await git(["status", "--porcelain=v1", "-z", "--untracked-files=all"], cwd)).length > 0) throw new Error("dirty_worktree");
}
async function ensureNoInProgressGitOperation(cwd = root) {
  for (const marker of ["MERGE_HEAD", "CHERRY_PICK_HEAD", "REVERT_HEAD", "BISECT_LOG", "rebase-merge", "rebase-apply"]) {
    if (await gitPathExists(marker)) throw new Error("git_operation_in_progress");
  }
}
async function listWorktrees(cwd = root) {
  return parseWorktreeList(await git(["worktree", "list", "--porcelain"], cwd));
}
export async function statusSnapshot(cwd, taskAllowedPaths, gitReader = git) {
  if (!Array.isArray(taskAllowedPaths) || taskAllowedPaths.length === 0) throw new Error("missing_task_allowed_paths");
  const output = await gitReader(["status", "--porcelain=v1", "-z", "--untracked-files=all"], cwd);
  return validateTaskStatusSnapshot(output, taskAllowedPaths);
}
async function repositoryStatusSnapshot(cwd) {
  const output = await git(["status", "--porcelain=v1", "-z", "--untracked-files=all"], cwd);
  return { records: output ? output.split("\0").filter(Boolean) : [] };
}
async function ensureWorktreeClean(cwd) {
  const snapshot = await repositoryStatusSnapshot(cwd);
  if (snapshot.records.length > 0) throw new Error("unexpected_dirty_worktree");
}
async function readPullRequestStatus(prNumber) {
  const pr = await ghJson(["pr", "view", String(prNumber), "--json", "number,state,headRefName,baseRefName,headRefOid,isDraft,mergedAt"]);
  return {
    number: pr.number,
    state: pr.state,
    headRefName: pr.headRefName,
    baseRefName: pr.baseRefName,
    headRefOid: pr.headRefOid || null,
    mergedAt: pr.mergedAt || null,
    repository: "NastyBaster/weather-statistic",
  };
}
async function classifyLiveTaskPreflight() {
  return classifySingletonState({
    runtimeRoot: runtimeRoot(),
    rootPath: root,
    ownerPresent: await ownerPresent(runtimeRoot()),
    listWorktrees: async () => await git(["worktree", "list", "--porcelain"], root),
    readPullRequest: readPullRequestStatus,
  });
}
async function cleanupOperations() {
  return {
    io: undefined,
    ownerPresent: async () => ownerPresent(runtimeRoot()),
    rootPath: async () => root,
    listWorktrees: async () => await git(["worktree", "list", "--porcelain"], root),
    readPullRequest: readPullRequestStatus,
    issueClosed: async (issueNumber) => (await ghJson(["issue", "view", String(issueNumber), "--json", "state"])).state === "CLOSED",
    remoteBranchExists: async (branch) => Boolean((await git(["ls-remote", "--heads", "origin", `refs/heads/${branch}`], root)).trim()),
    worktreeGitOperationInProgress: async (worktree) => {
      for (const marker of ["MERGE_HEAD", "CHERRY_PICK_HEAD", "REVERT_HEAD", "BISECT_LOG", "rebase-merge", "rebase-apply"]) {
        if (await pathExists((await git(["rev-parse", "--git-path", marker], worktree)).trim())) return true;
      }
      return false;
    },
    isWorktreeClean: async (worktree) => (await git(["status", "--porcelain=v1", "-z", "--untracked-files=all"], worktree)).length === 0,
    removeWorktree: async (worktree) => { await git(["worktree", "remove", worktree], root); },
    pruneWorktrees: async () => { await git(["worktree", "prune"], root); },
    isLocalBranchAttached: async (branch) => (await listWorktrees(root)).some((entry) => entry.branch === `refs/heads/${branch}`),
    localBranchExists: async (branch) => {
      try {
        await git(["show-ref", "--verify", "--quiet", `refs/heads/${branch}`], root);
        return true;
      } catch {
        return false;
      }
    },
    deleteLocalBranch: async (branch) => { await git(["branch", "-d", branch], root); },
    rootIsClean: async () => (await git(["status", "--porcelain=v1", "-z", "--untracked-files=all"], root)).length === 0,
    rootHead: async () => (await git(["rev-parse", "HEAD"], root)).trim(),
    mainHead: async () => (await git(["rev-parse", "origin/main"], root)).trim(),
  };
}
function cleanupConfig(args = []) {
  const issueFlag = args.indexOf("--issue");
  if (issueFlag === -1) return { issueNumber: null };
  const raw = args[issueFlag + 1];
  const issueNumber = Number.parseInt(raw, 10);
  if (!raw || !Number.isSafeInteger(issueNumber) || issueNumber < 1) throw new Error("cleanup_issue_requires_positive_integer");
  return { issueNumber };
}
export async function once(config = parseConfig(process.argv.slice(3))) {
  const runId = "run-" + new Date().toISOString().replace(/[-:.TZ]/g, "") + "-" + randomBytes(4).toString("hex");
  if (config.dryRun) {
    const preflight = await classifyLiveTaskPreflight().catch((error) => ({ blocked: true, category: sanitize(error?.message || error) }));
    const dryRun = { command: "once", runId, ...dryRunPlan(null) };
    if (preflight.blocked) dryRun.category = preflight.category;
    console.log(JSON.stringify(dryRun));
    return;
  }
  const commitMessage = validateCommitMessage(config.commitMessage);
  if (!commitMessage.valid) { console.log(JSON.stringify({ command: "once", runId, outcome: "blocked", category: commitMessage.category, mutations: 0 })); process.exitCode = 1; return; }
  const selectedChecks = validateCheckSelection(config.checkIds);
  if (!selectedChecks.valid) { console.log(JSON.stringify({ command: "once", runId, outcome: "blocked", category: selectedChecks.category, mutations: 0 })); process.exitCode = 1; return; }
  const doctor = await runDoctor(createRealDoctorAdapter(root), runtimeRoot());
  if (!doctor.pass) { console.log(JSON.stringify({ command: "once", runId, outcome: "blocked", category: "doctor_failed", mutations: 0, failures: doctor.failures })); process.exitCode = 1; return; }
  const preflight = await classifyLiveTaskPreflight().catch((error) => ({ blocked: true, category: sanitize(error?.message || error) }));
  try {
    await ensureCanonicalCheckoutClean(root);
    await ensureNoInProgressGitOperation(root);
    if (preflight.blocked) throw new Error(preflight.category);
  } catch (error) {
    console.log(JSON.stringify({ command: "once", runId, outcome: "blocked", category: sanitize(error?.message || error), mutations: 0 }));
    process.exitCode = 1;
    return;
  }
  const ownership = await acquireOwnership(runtimeRoot(), { mode: "once", runId, dryRun: false });
  let issue; let worktree; let branch;
  try {
    issue = await loadReadyIssue();
    if (!issue) throw new Error("no_eligible_agent_ready_issue");
    const contract = parseIssueContract(issue);
    if (!contract.valid) throw new Error("invalid_issue_contract");
    const checks = validateRequiredChecks(contract.requiredChecks, selectedChecks.ids);
    if (!checks.valid) throw new Error(checks.category || "unsafe_required_checks");
    await claim(issue.number);
    branch = safeBranch(issue);
    worktree = worktreePath(root, runtimeRoot(), branch);
    await mkdir(path.dirname(worktree), { recursive: true });
    await git(["worktree", "add", "-b", branch, worktree, "origin/main"]);
    await ensureWorktreeClean(worktree);
    const prompt = promptFor(issue, { branch, worktree, allowedPaths: contract.allowedPaths, contract });
    const child = await runChild(prompt, worktree);
    if (!child.stdout.trim()) throw new Error("child_returned_no_summary");
    const postChild = await statusSnapshot(worktree, contract.allowedPaths);
    if (!postChild.valid) throw new Error(postChild.category || "unsafe_changed_paths");
    const changed = postChild.changedPaths;
    for (const check of checks.registry) {
      await run(check.command, check.args, worktree);
    }
    const postChecks = await statusSnapshot(worktree, contract.allowedPaths);
    if (!postChecks.valid) throw new Error(postChecks.category || "unsafe_changed_paths");
    if (!sameNormalizedPaths(changed, postChecks.changedPaths)) throw new Error("worktree_status_changed_after_checks");
    await git(["add", "--", ...changed], worktree);
    await git(["diff", "--cached", "--check"], worktree);
    const parentHead = (await git(["rev-parse", "HEAD"], worktree)).trim();
    await git(["commit", "-m", config.commitMessage], worktree);
    const committedHead = (await git(["rev-parse", "HEAD"], worktree)).trim();
    if (committedHead === parentHead) throw new Error("commit_head_unchanged");
    if ((await git(["rev-list", "--count", `${parentHead}..${committedHead}`], worktree)).trim() !== "1") throw new Error("commit_head_distance_invalid");
    await ensureWorktreeClean(worktree);
    await git(["push", "-u", "origin", branch], worktree);
    if ((await git(["rev-parse", "HEAD"], worktree)).trim() !== committedHead) throw new Error("pushed_head_mismatch");
    await ensureWorktreeClean(worktree);
    const body = prBody(issue, checks.commands);
    const prOutput = await gh(["pr", "create", "--base", "main", "--head", branch, "--title", issue.title, "--body", body]);
    const prNumber = Number(prOutput.match(/\/pull\/(\d+)/)?.[1]);
    if (!Number.isSafeInteger(prNumber) || prNumber < 1) throw new Error("pull_request_creation_failed");
    const pr = { number: prNumber };
    if ((await git(["rev-parse", "HEAD"], worktree)).trim() !== committedHead) throw new Error("handoff_head_mismatch");
    await ensureWorktreeClean(worktree);
    await writeRetainedTaskState(runtimeRoot(), buildRetainedTaskState({ issueNumber: issue.number, prNumber, expectedBranch: branch, expectedHead: committedHead }));
    await writeAudit(runId, { phase: "handoff", issue: issue.number, branch, childOutcome: "success", changedPaths: changed, checks: checks.ids, pr: prNumber, outcome: "handoff" });
    await handoff(issue.number, runId, branch, pr);
    console.log(JSON.stringify({ command: "once", runId, outcome: "handoff", issue: issue.number, branch, pullRequest: pr.number, changedPaths: changed }));
  } catch (error) {
    const message = sanitize(error?.message || error);
    try { await writeAudit(runId, { phase: "blocked", issue: issue?.number, branch, childOutcome: "failed", outcome: "blocked" }); } catch { /* preserve sanitized block */ }
    if (issue?.number) await block(issue.number, "bridge_execution_failed");
    console.log(JSON.stringify({ command: "once", runId, outcome: "blocked", issue: issue?.number || null, branch: branch || null, error: message }));
    process.exitCode = 1;
  } finally {
    await ownership.release();
  }
}
export async function main(argv = process.argv.slice(2)) {
  const command = argv[0];
  const config = parseConfig(argv.slice(1));
  if (command === "doctor") {
    const result = await runDoctor(createRealDoctorAdapter(), runtimeRoot());
    console.log(JSON.stringify({ command: "doctor", pass: result.pass, failures: result.failures, checks: result.checks }));
    process.exitCode = result.pass ? 0 : 1;
  } else if (command === "once") {
    await once(config);
  } else if (command === "cleanup") {
    try {
      const result = await cleanupRetainedTask(runtimeRoot(), await cleanupOperations(), cleanupConfig(argv.slice(1)));
      console.log(JSON.stringify({ command: "cleanup", ...result }));
      process.exitCode = result.cleanup === "complete" || result.cleanup === "idempotent" ? 0 : 1;
    } catch (error) {
      console.log(JSON.stringify({ command: "cleanup", cleanup: "blocked", category: sanitize(error?.message || error) }));
      process.exitCode = 1;
    }
  } else if (command === "recover") {
    try {
      const operations = await cleanupOperations();
      const result = await inspectCleanupRecovery(runtimeRoot(), {
        ...operations,
        io: undefined,
      });
      console.log(JSON.stringify({ command: "recover", ...result }));
      process.exitCode = 0;
    } catch (error) {
      console.log(JSON.stringify({ command: "recover", category: sanitize(error?.message || error) }));
      process.exitCode = 1;
    }
  } else {
    console.error("Usage: bridge <doctor|once|cleanup|recover> [--dry-run]");
    process.exitCode = 2;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
