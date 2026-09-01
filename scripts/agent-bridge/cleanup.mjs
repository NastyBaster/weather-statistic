import os from "node:os";
import path from "node:path";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";

export const RETAINED_TASK_STATE_VERSION = 1;
export const RETAINED_TASK_STATE_FILE = "retained-task.json";
export const REVIEW_PENDING_CATEGORY = "previous_task_review_pending";
export const CLEANUP_REQUIRED_CATEGORY = "previous_task_cleanup_required";
export const RECOVERY_CATEGORIES = Object.freeze([
  "clean_unpushed_task",
  "dirty_task_requires_owner_review",
  "pushed_pr_review_pending",
  "merged_task_cleanup_ready",
  "task_identity_mismatch",
  "unexpected_worktree",
]);

function defaultRuntimeRoot() {
  return path.join(process.env.LOCALAPPDATA || os.tmpdir(), "ForecastRealityCheck", "agent-bridge", "weather-statistic");
}

function statePath(runtimeRoot) {
  return path.join(runtimeRoot || defaultRuntimeRoot(), RETAINED_TASK_STATE_FILE);
}

export function retainedWorktreeId(branch) {
  return String(branch ?? "").replaceAll("/", "-");
}

export function retainedWorktreePath(runtimeRoot, state) {
  return path.join(runtimeRoot || defaultRuntimeRoot(), "worktrees", String(state?.worktreeId || ""));
}

export function buildRetainedTaskState({ issueNumber, prNumber, expectedBranch, expectedHead, lifecycle = "review", ownerToken = null } = {}) {
  return {
    version: RETAINED_TASK_STATE_VERSION,
    issueNumber,
    prNumber,
    expectedBranch,
    worktreeId: retainedWorktreeId(expectedBranch),
    expectedHead,
    ownerToken: ownerToken ?? null,
    lifecycle,
  };
}

export function validateRetainedTaskState(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return { valid: false, category: "malformed_retained_task_state" };
  const { version, issueNumber, prNumber, expectedBranch, worktreeId, expectedHead, ownerToken = null, lifecycle } = value;
  if (version !== RETAINED_TASK_STATE_VERSION) return { valid: false, category: "malformed_retained_task_state" };
  if (!Number.isSafeInteger(issueNumber) || issueNumber < 1) return { valid: false, category: "malformed_retained_task_state" };
  if (!Number.isSafeInteger(prNumber) || prNumber < 1) return { valid: false, category: "malformed_retained_task_state" };
  if (typeof expectedBranch !== "string" || !/^agent\/\d+-[a-z0-9-]+$/.test(expectedBranch)) return { valid: false, category: "malformed_retained_task_state" };
  if (worktreeId !== retainedWorktreeId(expectedBranch)) return { valid: false, category: "malformed_retained_task_state" };
  if (typeof expectedHead !== "string" || !/^[0-9a-f]{40,64}$/i.test(expectedHead)) return { valid: false, category: "malformed_retained_task_state" };
  if (ownerToken !== null && typeof ownerToken !== "string") return { valid: false, category: "malformed_retained_task_state" };
  if (lifecycle !== "review") return { valid: false, category: "malformed_retained_task_state" };
  return {
    valid: true,
    state: {
      version,
      issueNumber,
      prNumber,
      expectedBranch,
      worktreeId,
      expectedHead,
      ownerToken,
      lifecycle,
    },
  };
}

export async function readRetainedTaskState(runtimeRoot, io = { readFile }) {
  try {
    const raw = await io.readFile(statePath(runtimeRoot), "utf8");
    const parsed = JSON.parse(raw);
    const validated = validateRetainedTaskState(parsed);
    if (!validated.valid) throw new Error(validated.category);
    return validated.state;
  } catch (error) {
    if (error?.code === "ENOENT") return null;
    if (error instanceof SyntaxError) throw new Error("malformed_retained_task_state");
    throw error;
  }
}

export async function writeRetainedTaskState(runtimeRoot, value, io = { mkdir, writeFile, rename }) {
  const validated = validateRetainedTaskState(value);
  if (!validated.valid) throw new Error(validated.category);
  const target = statePath(runtimeRoot);
  const dir = path.dirname(target);
  const temp = path.join(dir, `${RETAINED_TASK_STATE_FILE}.${process.pid}.${Date.now()}.tmp`);
  await io.mkdir(dir, { recursive: true });
  await io.writeFile(temp, JSON.stringify(validated.state), { encoding: "utf8", flag: "wx", mode: 0o600 });
  await io.rename(temp, target);
}

export async function clearRetainedTaskState(runtimeRoot, io = { rm }) {
  await io.rm(statePath(runtimeRoot), { force: false });
}

export function parseWorktreeList(output) {
  const text = String(output ?? "");
  if (!text.endsWith("\n")) throw new Error("malformed_worktree_list");
  return text.split("\n\n").filter(Boolean).map((record) => {
    const lines = record.split("\n");
    const parsed = { worktree: null, head: null, branch: null, detached: false };
    for (const line of lines) {
      if (!line) continue;
      if (line.startsWith("worktree ")) {
        if (parsed.worktree) throw new Error("malformed_worktree_list");
        parsed.worktree = line.slice("worktree ".length);
      } else if (line.startsWith("HEAD ")) {
        if (parsed.head) throw new Error("malformed_worktree_list");
        parsed.head = line.slice("HEAD ".length);
      } else if (line.startsWith("branch ")) {
        if (parsed.branch !== null) throw new Error("malformed_worktree_list");
        parsed.branch = line.slice("branch ".length);
      } else if (line === "detached" || line === "bare" || line === "locked" || line.startsWith("locked ") || line === "prunable" || line.startsWith("prunable ")) {
        if (line === "detached") parsed.detached = true;
      } else throw new Error("malformed_worktree_list");
    }
    if (!parsed.worktree || !parsed.head) throw new Error("malformed_worktree_list");
    return parsed;
  });
}

function normalizedWorktreeRoot(runtimeRoot) {
  return path.resolve(runtimeRoot || defaultRuntimeRoot(), "worktrees");
}

export function worktreePathIsInsideRuntimeRoot(runtimeRoot, worktree) {
  const root = normalizedWorktreeRoot(runtimeRoot);
  const candidate = path.resolve(String(worktree || ""));
  return candidate.startsWith(root + path.sep);
}

function cleanCategory(error, fallback = "cleanup_failed") {
  const category = String(error?.message || error || fallback);
  return category.replace(/[^\w:-]+/g, "_").replace(/^_+|_+$/g, "") || fallback;
}

function fail(category, extra = {}) {
  return { cleanup: "blocked", category, ...extra };
}

export async function inspectCleanupRecovery(runtimeRoot, ops) {
  const state = await readRetainedTaskState(runtimeRoot, ops.io);
  const worktrees = parseWorktreeList(await ops.listWorktrees());
  if (!state) return worktrees.length === 1 ? { category: "clean_unpushed_task" } : { category: "unexpected_worktree" };
  const worktreePath = retainedWorktreePath(runtimeRoot, state);
  const registered = worktrees.find((entry) => path.resolve(entry.worktree) === path.resolve(worktreePath));
  const pr = await ops.readPullRequest(state.prNumber);
  if (!pr || pr.number !== state.prNumber || pr.headRefName !== state.expectedBranch || pr.baseRefName !== "main") return { category: "task_identity_mismatch" };
  if (pr.state === "OPEN") return { category: "pushed_pr_review_pending" };
  if (pr.state === "MERGED") return { category: "merged_task_cleanup_ready" };
  if (!registered) return { category: "task_identity_mismatch" };
  return (await ops.isWorktreeClean(worktreePath)) ? { category: "clean_unpushed_task" } : { category: "dirty_task_requires_owner_review" };
}

export async function classifySingletonState({ runtimeRoot, rootPath, ownerPresent, listWorktrees, readPullRequest }, io = { readFile }) {
  if (ownerPresent) return { blocked: true, category: "bridge_ownership_active" };
  const state = await readRetainedTaskState(runtimeRoot, io);
  const worktrees = parseWorktreeList(await listWorktrees());
  const rootResolved = path.resolve(rootPath);
  const rootEntries = worktrees.filter((entry) => path.resolve(entry.worktree) === rootResolved);
  if (rootEntries.length !== 1) return { blocked: true, category: "unexpected_existing_worktree" };
  if (!state) return worktrees.length === 1 ? { blocked: false, category: null } : { blocked: true, category: "unexpected_existing_worktree" };
  const taskWorktree = retainedWorktreePath(runtimeRoot, state);
  const registered = worktrees.find((entry) => path.resolve(entry.worktree) === path.resolve(taskWorktree));
  if (!registered) return { blocked: true, category: "unexpected_existing_worktree" };
  if (worktrees.length !== 2) return { blocked: true, category: "unexpected_existing_worktree" };
  const pr = await readPullRequest(state.prNumber);
  if (!pr || pr.number !== state.prNumber || pr.headRefName !== state.expectedBranch || pr.baseRefName !== "main") return { blocked: true, category: "unexpected_existing_worktree" };
  if (pr.state === "OPEN") return { blocked: true, category: REVIEW_PENDING_CATEGORY };
  if (pr.state === "MERGED") return { blocked: true, category: CLEANUP_REQUIRED_CATEGORY };
  return { blocked: true, category: "unexpected_existing_worktree" };
}

export async function cleanupRetainedTask(runtimeRoot, ops, options = {}) {
  const issueNumber = options.issueNumber ?? null;
  try {
    if (await ops.ownerPresent()) return fail("bridge_ownership_active");
    const state = await readRetainedTaskState(runtimeRoot, ops.io);
    if (!state) return { cleanup: "idempotent", category: "no_retained_task" };
    if (issueNumber !== null && issueNumber !== state.issueNumber) return fail("task_identity_mismatch");
    const worktreePath = retainedWorktreePath(runtimeRoot, state);
    const list = parseWorktreeList(await ops.listWorktrees());
    const rootPath = path.resolve(await ops.rootPath());
    const registeredRoot = list.find((entry) => path.resolve(entry.worktree) === rootPath);
    if (!registeredRoot) return fail("task_identity_mismatch");
    if (!worktreePathIsInsideRuntimeRoot(runtimeRoot, worktreePath)) return fail("task_identity_mismatch");
    if (path.resolve(worktreePath) === rootPath) return fail("task_identity_mismatch");
    const extraWorktrees = list.filter((entry) => {
      const resolved = path.resolve(entry.worktree);
      return resolved !== rootPath && resolved !== path.resolve(worktreePath);
    });
    if (extraWorktrees.length > 0) return fail("task_identity_mismatch");
    const taskWorktree = list.find((entry) => path.resolve(entry.worktree) === path.resolve(worktreePath));
    const pr = await ops.readPullRequest(state.prNumber);
    if (!pr || pr.number !== state.prNumber || pr.repository !== "NastyBaster/weather-statistic" || pr.headRefName !== state.expectedBranch || pr.baseRefName !== "main") return fail("task_identity_mismatch");
    if (pr.state === "OPEN") return fail("pushed_pr_review_pending");
    if (pr.state !== "MERGED") return fail("merge_not_verified");
    if (!(await ops.issueClosed(state.issueNumber))) return fail("issue_not_closed");
    const remoteExists = await ops.remoteBranchExists(state.expectedBranch);
    if (remoteExists) return fail("remote_branch_still_exists", { merged: true });
    const worktreeRegistered = Boolean(taskWorktree);
    if (worktreeRegistered) {
      if (taskWorktree.branch !== `refs/heads/${state.expectedBranch}`) return fail("task_identity_mismatch", { merged: true });
      if (taskWorktree.head !== state.expectedHead) return fail("task_identity_mismatch", { merged: true });
      if (await ops.worktreeGitOperationInProgress(worktreePath)) return fail("git_operation_in_progress", { merged: true });
      if (!(await ops.isWorktreeClean(worktreePath))) return fail("dirty_worktree", { merged: true });
      await ops.removeWorktree(worktreePath);
      await ops.pruneWorktrees();
    }
    if (await ops.isLocalBranchAttached(state.expectedBranch)) return fail("branch_attached", { merged: true });
    if (await ops.localBranchExists(state.expectedBranch)) await ops.deleteLocalBranch(state.expectedBranch);
    const remaining = parseWorktreeList(await ops.listWorktrees());
    if (remaining.some((entry) => path.resolve(entry.worktree) === path.resolve(worktreePath))) return fail("worktree_still_registered", { merged: true });
    if (await ops.localBranchExists(state.expectedBranch)) return fail("local_branch_still_exists", { merged: true });
    if (await ops.remoteBranchExists(state.expectedBranch)) return fail("remote_branch_still_exists", { merged: true });
    if (!(await ops.rootIsClean())) return fail("dirty_root_worktree", { merged: true });
    if ((await ops.rootHead()) !== (await ops.mainHead())) return fail("main_head_mismatch", { merged: true });
    await clearRetainedTaskState(runtimeRoot, ops.io);
    return { cleanup: "complete", category: null, issueNumber: state.issueNumber, prNumber: state.prNumber, branch: state.expectedBranch };
  } catch (error) {
    return fail(cleanCategory(error), { merged: false });
  }
}
