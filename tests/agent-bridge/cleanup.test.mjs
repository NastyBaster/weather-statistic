import test from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import {
  CLEANUP_REQUIRED_CATEGORY,
  REVIEW_PENDING_CATEGORY,
  buildRetainedTaskState,
  classifySingletonState,
  cleanupRetainedTask,
  inspectCleanupRecovery,
  parseWorktreeList,
  readRetainedTaskState,
  retainedWorktreePath,
  validateRetainedTaskState,
  writeRetainedTaskState,
} from "../../scripts/agent-bridge/cleanup.mjs";

const head = "a".repeat(40);
const branch = "agent/38-record-verified-docs";

function worktrees({ root = "C:/repo", taskPath = "C:/runtime/worktrees/agent-38-record-verified-docs", taskHead = head, includeTask = true, taskBranch = branch } = {}) {
  return [
    `worktree ${root}\nHEAD ${head}\nbranch refs/heads/main\n`,
    includeTask ? `worktree ${taskPath}\nHEAD ${taskHead}\nbranch refs/heads/${taskBranch}\n` : null,
  ].filter(Boolean).join("\n") + "\n";
}

function fakeOps(overrides = {}) {
  const events = [];
  const root = "C:/repo";
  const runtimeRoot = "C:/runtime";
  const state = buildRetainedTaskState({ issueNumber: 38, prNumber: 39, expectedBranch: branch, expectedHead: head });
  const taskPath = retainedWorktreePath(runtimeRoot, state);
  return {
    events,
    runtimeRoot,
    state,
    ops: {
      ownerPresent: async () => false,
      rootPath: async () => root,
      listWorktrees: async () => { events.push("list"); return worktrees({ root, taskPath }); },
      readPullRequest: async () => ({ number: 39, state: "MERGED", baseRefName: "main", headRefName: branch, headRefOid: head, repository: "NastyBaster/weather-statistic" }),
      issueClosed: async () => true,
      remoteBranchExists: async () => false,
      worktreeGitOperationInProgress: async () => false,
      isWorktreeClean: async () => { events.push("clean"); return true; },
      removeWorktree: async () => { events.push("remove-worktree"); },
      pruneWorktrees: async () => { events.push("prune"); },
      isLocalBranchAttached: async () => { events.push("attached"); return false; },
      localBranchExists: async () => { events.push("branch-exists"); return true; },
      deleteLocalBranch: async () => { events.push("delete-branch"); },
      rootIsClean: async () => { events.push("root-clean"); return true; },
      rootHead: async () => { events.push("root-head"); return head; },
      mainHead: async () => { events.push("main-head"); return head; },
      ...overrides,
    },
  };
}

test("retained task state keeps only the minimal cleanup identity", () => {
  const state = buildRetainedTaskState({ issueNumber: 38, prNumber: 39, expectedBranch: branch, expectedHead: head });
  assert.deepEqual(Object.keys(state), ["version", "issueNumber", "prNumber", "expectedBranch", "worktreeId", "expectedHead", "ownerToken", "lifecycle"]);
  assert.equal(validateRetainedTaskState(state).valid, true);
  assert.equal("issueBody" in state, false);
  assert.equal("childOutput" in state, false);
});

test("retained task state write is atomic and readable", async () => {
  const runtimeRoot = await mkdtemp(path.join(os.tmpdir(), "bridge-cleanup-state-"));
  try {
    const state = buildRetainedTaskState({ issueNumber: 38, prNumber: 39, expectedBranch: branch, expectedHead: head });
    await writeRetainedTaskState(runtimeRoot, state);
    assert.deepEqual(await readRetainedTaskState(runtimeRoot), state);
    const entries = await readFile(path.join(runtimeRoot, "retained-task.json"), "utf8");
    assert.match(entries, /"expectedBranch"/);
  } finally {
    await rm(runtimeRoot, { recursive: true, force: true });
  }
});

test("malformed retained task state fails closed", async () => {
  const runtimeRoot = await mkdtemp(path.join(os.tmpdir(), "bridge-cleanup-malformed-"));
  try {
    await rm(path.join(runtimeRoot, "retained-task.json"), { force: true });
    await assert.rejects(
      readRetainedTaskState(runtimeRoot, { readFile: async () => "{bad" }),
      /malformed_retained_task_state/,
    );
  } finally {
    await rm(runtimeRoot, { recursive: true, force: true });
  }
});

test("singleton preflight distinguishes clean root, review pending, merged cleanup required, active owner, and unexpected worktrees", async () => {
  const state = buildRetainedTaskState({ issueNumber: 38, prNumber: 39, expectedBranch: branch, expectedHead: head });
  const root = "C:/repo";
  const runtimeRoot = "C:/runtime";
  const listRootOnly = async () => `worktree ${root}\nHEAD ${head}\nbranch refs/heads/main\n\n`;
  const listWithTask = async () => worktrees({ root, taskPath: retainedWorktreePath(runtimeRoot, state) });
  assert.deepEqual(await classifySingletonState({ runtimeRoot, rootPath: root, ownerPresent: false, listWorktrees: listRootOnly, readPullRequest: async () => null }), { blocked: false, category: null });
  const io = { readFile: async () => JSON.stringify(state) };
  assert.deepEqual(await classifySingletonState({ runtimeRoot, rootPath: root, ownerPresent: false, listWorktrees: listWithTask, readPullRequest: async () => ({ number: 39, state: "OPEN", baseRefName: "main", headRefName: branch }) }, io), { blocked: true, category: REVIEW_PENDING_CATEGORY });
  assert.deepEqual(await classifySingletonState({ runtimeRoot, rootPath: root, ownerPresent: false, listWorktrees: listWithTask, readPullRequest: async () => ({ number: 39, state: "MERGED", baseRefName: "main", headRefName: branch }) }, io), { blocked: true, category: CLEANUP_REQUIRED_CATEGORY });
  assert.deepEqual(await classifySingletonState({ runtimeRoot, rootPath: root, ownerPresent: true, listWorktrees: listRootOnly, readPullRequest: async () => null }), { blocked: true, category: "bridge_ownership_active" });
  assert.deepEqual(await classifySingletonState({ runtimeRoot, rootPath: root, ownerPresent: false, listWorktrees: async () => `${await listWithTask()}\nworktree C:/other\nHEAD ${head}\ndetached\n\n`, readPullRequest: async () => ({ number: 39, state: "OPEN", baseRefName: "main", headRefName: branch }) }, io), { blocked: true, category: "unexpected_existing_worktree" });
});

test("recovery inspection returns only sanitized categories", async () => {
  const { runtimeRoot, state } = fakeOps();
  const io = { readFile: async () => JSON.stringify(state) };
  const baseOps = {
    io,
    listWorktrees: async () => worktrees({ taskPath: retainedWorktreePath(runtimeRoot, state) }),
    readPullRequest: async () => ({ number: 39, state: "OPEN", headRefName: branch, baseRefName: "main" }),
    isWorktreeClean: async () => true,
  };
  assert.deepEqual(await inspectCleanupRecovery(runtimeRoot, baseOps), { category: "pushed_pr_review_pending" });
  assert.deepEqual(await inspectCleanupRecovery(runtimeRoot, { ...baseOps, readPullRequest: async () => ({ number: 39, state: "MERGED", headRefName: branch, baseRefName: "main" }) }), { category: "merged_task_cleanup_ready" });
  assert.deepEqual(await inspectCleanupRecovery(runtimeRoot, { ...baseOps, readPullRequest: async () => ({ number: 39, state: "CLOSED", headRefName: branch, baseRefName: "main" }), isWorktreeClean: async () => false }), { category: "dirty_task_requires_owner_review" });
  assert.deepEqual(await inspectCleanupRecovery(runtimeRoot, { ...baseOps, readPullRequest: async () => ({ number: 39, state: "CLOSED", headRefName: branch, baseRefName: "main" }), isWorktreeClean: async () => true }), { category: "clean_unpushed_task" });
  assert.deepEqual(await inspectCleanupRecovery(runtimeRoot, { ...baseOps, readPullRequest: async () => ({ number: 39, state: "OPEN", headRefName: "agent/38-other", baseRefName: "main" }) }), { category: "task_identity_mismatch" });
});

test("cleanup blocks open pr, unmerged closed pr, wrong repo, wrong base, wrong branch, wrong head, unclosed issue, dirty worktree, in-progress git operation, outside runtime root, and root removal", async () => {
  for (const [overrides, expected] of [
    [{ readPullRequest: async () => ({ number: 39, state: "OPEN", baseRefName: "main", headRefName: branch, repository: "NastyBaster/weather-statistic" }) }, "pushed_pr_review_pending"],
    [{ readPullRequest: async () => ({ number: 39, state: "CLOSED", baseRefName: "main", headRefName: branch, repository: "NastyBaster/weather-statistic" }) }, "merge_not_verified"],
    [{ readPullRequest: async () => ({ number: 39, state: "MERGED", baseRefName: "main", headRefName: branch, repository: "other/repo" }) }, "task_identity_mismatch"],
    [{ readPullRequest: async () => ({ number: 39, state: "MERGED", baseRefName: "develop", headRefName: branch, repository: "NastyBaster/weather-statistic" }) }, "task_identity_mismatch"],
    [{ readPullRequest: async () => ({ number: 39, state: "MERGED", baseRefName: "main", headRefName: "agent/38-other", repository: "NastyBaster/weather-statistic" }) }, "task_identity_mismatch"],
    [{ listWorktrees: async () => worktrees({ taskBranch: branch, taskHead: "b".repeat(40), taskPath: "C:/runtime/worktrees/agent-38-record-verified-docs" }) }, "task_identity_mismatch"],
    [{ issueClosed: async () => false }, "issue_not_closed"],
    [{ isWorktreeClean: async () => false }, "dirty_worktree"],
    [{ worktreeGitOperationInProgress: async () => true }, "git_operation_in_progress"],
    [{ listWorktrees: async () => worktrees({ taskPath: "C:/elsewhere/task" }) }, "task_identity_mismatch"],
    [{ rootPath: async () => "C:/runtime/worktrees/agent-38-record-verified-docs" }, "task_identity_mismatch"],
  ]) {
    const { runtimeRoot, state, ops } = fakeOps(overrides);
    const result = await cleanupRetainedTask(runtimeRoot, { ...ops, io: { readFile: async () => JSON.stringify(state) } });
    assert.equal(result.category, expected);
  }
});

test("cleanup never removes unknown registered worktrees or unexpected branches", async () => {
  const { runtimeRoot, state, ops, events } = fakeOps({
    listWorktrees: async () => `${worktrees({ taskPath: retainedWorktreePath("C:/runtime", buildRetainedTaskState({ issueNumber: 38, prNumber: 39, expectedBranch: branch, expectedHead: head })) })}\nworktree C:/runtime/worktrees/other\nHEAD ${head}\nbranch refs/heads/agent/99-other\n\n`,
  });
  const result = await cleanupRetainedTask(runtimeRoot, { ...ops, io: { readFile: async () => JSON.stringify(state) } });
  assert.equal(result.category, "task_identity_mismatch");
  assert.equal(events.includes("remove-worktree"), false);
  assert.equal(events.includes("delete-branch"), false);
});

test("cleanup blocks when remote branch still exists and does not delete it", async () => {
  const { runtimeRoot, state, ops, events } = fakeOps({ remoteBranchExists: async () => true });
  const result = await cleanupRetainedTask(runtimeRoot, { ...ops, io: { readFile: async () => JSON.stringify(state) } });
  assert.equal(result.category, "remote_branch_still_exists");
  assert.equal(events.includes("remove-worktree"), false);
});

test("successful cleanup removes only the verified task worktree and exact local branch", async () => {
  const runtimeRoot = await mkdtemp(path.join(os.tmpdir(), "bridge-cleanup-success-"));
  try {
    const state = buildRetainedTaskState({ issueNumber: 38, prNumber: 39, expectedBranch: branch, expectedHead: head });
    await writeRetainedTaskState(runtimeRoot, state);
    const taskPath = retainedWorktreePath(runtimeRoot, state);
    let firstList = true;
    const events = [];
    const result = await cleanupRetainedTask(runtimeRoot, {
      ownerPresent: async () => false,
      rootPath: async () => "C:/repo",
      listWorktrees: async () => {
        events.push(firstList ? "list-before" : "list-after");
        return firstList
          ? (firstList = false, worktrees({ root: "C:/repo", taskPath }))
          : `worktree C:/repo\nHEAD ${head}\nbranch refs/heads/main\n\n`;
      },
      readPullRequest: async () => ({ number: 39, state: "MERGED", baseRefName: "main", headRefName: branch, headRefOid: head, repository: "NastyBaster/weather-statistic" }),
      issueClosed: async () => true,
      remoteBranchExists: async () => false,
      worktreeGitOperationInProgress: async () => false,
      isWorktreeClean: async () => { events.push("clean"); return true; },
      removeWorktree: async () => { events.push("remove-worktree"); },
      pruneWorktrees: async () => { events.push("prune"); },
      isLocalBranchAttached: async () => { events.push("attached"); return false; },
      localBranchExists: async () => { events.push("branch-exists"); return events.filter((value) => value === "branch-exists").length === 1; },
      deleteLocalBranch: async () => { events.push("delete-branch"); },
      rootIsClean: async () => { events.push("root-clean"); return true; },
      rootHead: async () => { events.push("root-head"); return head; },
      mainHead: async () => { events.push("main-head"); return head; },
    });
    assert.equal(result.cleanup, "complete");
    assert.deepEqual(events, ["list-before", "clean", "remove-worktree", "prune", "attached", "branch-exists", "delete-branch", "list-after", "branch-exists", "root-clean", "root-head", "main-head"]);
    assert.equal(await readRetainedTaskState(runtimeRoot), null);
  } finally {
    await rm(runtimeRoot, { recursive: true, force: true });
  }
});

test("cleanup is idempotent after successful cleanup and partial failures retain state for retry", async () => {
  const runtimeRoot = await mkdtemp(path.join(os.tmpdir(), "bridge-cleanup-idempotent-"));
  try {
    const state = buildRetainedTaskState({ issueNumber: 38, prNumber: 39, expectedBranch: branch, expectedHead: head });
    await writeRetainedTaskState(runtimeRoot, state);
    const taskPath = retainedWorktreePath(runtimeRoot, state);
    const blocking = await cleanupRetainedTask(runtimeRoot, {
      ownerPresent: async () => false,
      rootPath: async () => "C:/repo",
      listWorktrees: async () => worktrees({ root: "C:/repo", taskPath }),
      readPullRequest: async () => ({ number: 39, state: "MERGED", baseRefName: "main", headRefName: branch, headRefOid: head, repository: "NastyBaster/weather-statistic" }),
      issueClosed: async () => true,
      remoteBranchExists: async () => false,
      worktreeGitOperationInProgress: async () => false,
      isWorktreeClean: async () => true,
      removeWorktree: async () => {},
      pruneWorktrees: async () => {},
      isLocalBranchAttached: async () => false,
      localBranchExists: async () => true,
      deleteLocalBranch: async () => { throw new Error("delete_local_branch_failed"); },
      rootIsClean: async () => true,
      rootHead: async () => head,
      mainHead: async () => head,
    });
    assert.equal(blocking.cleanup, "blocked");
    assert.notEqual(await readRetainedTaskState(runtimeRoot), null);
    await rm(path.join(runtimeRoot, "retained-task.json"), { force: true });
    const idempotent = await cleanupRetainedTask(runtimeRoot, { ownerPresent: async () => false, io: undefined });
    assert.deepEqual(idempotent, { cleanup: "idempotent", category: "no_retained_task" });
  } finally {
    await rm(runtimeRoot, { recursive: true, force: true });
  }
});

test("simulated lifecycle reaches review, blocks the next task, becomes cleanup eligible after merge, and then permits the next task", async () => {
  const runtimeRoot = await mkdtemp(path.join(os.tmpdir(), "bridge-cleanup-lifecycle-"));
  try {
    const state = buildRetainedTaskState({ issueNumber: 38, prNumber: 39, expectedBranch: branch, expectedHead: head });
    await writeRetainedTaskState(runtimeRoot, state);
    const taskPath = retainedWorktreePath(runtimeRoot, state);
    const io = { readFile: async () => JSON.stringify(state) };
    const reviewPending = await classifySingletonState({
      runtimeRoot,
      rootPath: "C:/repo",
      ownerPresent: false,
      listWorktrees: async () => worktrees({ root: "C:/repo", taskPath }),
      readPullRequest: async () => ({ number: 39, state: "OPEN", baseRefName: "main", headRefName: branch }),
    }, io);
    assert.deepEqual(reviewPending, { blocked: true, category: REVIEW_PENDING_CATEGORY });
    const cleanupReady = await inspectCleanupRecovery(runtimeRoot, {
      io,
      listWorktrees: async () => worktrees({ root: "C:/repo", taskPath }),
      readPullRequest: async () => ({ number: 39, state: "MERGED", baseRefName: "main", headRefName: branch }),
      isWorktreeClean: async () => true,
    });
    assert.deepEqual(cleanupReady, { category: "merged_task_cleanup_ready" });
    let firstList = true;
    const cleanup = await cleanupRetainedTask(runtimeRoot, {
      ownerPresent: async () => false,
      rootPath: async () => "C:/repo",
      listWorktrees: async () => firstList
        ? (firstList = false, worktrees({ root: "C:/repo", taskPath }))
        : `worktree C:/repo\nHEAD ${head}\nbranch refs/heads/main\n\n`,
      readPullRequest: async () => ({ number: 39, state: "MERGED", baseRefName: "main", headRefName: branch, headRefOid: head, repository: "NastyBaster/weather-statistic" }),
      issueClosed: async () => true,
      remoteBranchExists: async () => false,
      worktreeGitOperationInProgress: async () => false,
      isWorktreeClean: async () => true,
      removeWorktree: async () => {},
      pruneWorktrees: async () => {},
      isLocalBranchAttached: async () => false,
      localBranchExists: async () => false,
      deleteLocalBranch: async () => { throw new Error("unexpected_branch_delete"); },
      rootIsClean: async () => true,
      rootHead: async () => head,
      mainHead: async () => head,
    });
    assert.equal(cleanup.cleanup, "complete");
    const readyAgain = await classifySingletonState({
      runtimeRoot,
      rootPath: "C:/repo",
      ownerPresent: false,
      listWorktrees: async () => `worktree C:/repo\nHEAD ${head}\nbranch refs/heads/main\n\n`,
      readPullRequest: async () => null,
    });
    assert.deepEqual(readyAgain, { blocked: false, category: null });
  } finally {
    await rm(runtimeRoot, { recursive: true, force: true });
  }
});

test("cleanup source keeps no force deletion and no broad filesystem delete", async () => {
  const source = await readFile("scripts/agent-bridge/cli.mjs", "utf8");
  assert.match(source, /git\(\["worktree", "remove", worktree\]/);
  assert.doesNotMatch(source, /worktree", "remove".*"--force"/);
  assert.doesNotMatch(source, /Remove-Item|rm -rf|rmdir \/s/i);
});

test("parseWorktreeList handles clean registered task records", () => {
  assert.deepEqual(parseWorktreeList(worktrees({})), [
    { worktree: "C:/repo", head, branch: "refs/heads/main", detached: false },
    { worktree: "C:/runtime/worktrees/agent-38-record-verified-docs", head, branch: `refs/heads/${branch}`, detached: false },
  ]);
});
