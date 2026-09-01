import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import {
  RUNTIME_DENY,
  DEFAULT_COMMIT_MESSAGE,
  COMMIT_MESSAGE_MAX_LENGTH,
  DEFAULT_SAFE_CHECK_IDS,
  MAX_SAFE_CHECK_IDS,
  SAFE_CHECK_REGISTRY,
  branchFor,
  checkCommandsForIds,
  dryRunPlan,
  eligible,
  issueBodyDigest,
  normalizeRepoPath,
  parseConfig,
  parseIssueContract,
  parsePorcelainZ,
  parsePorcelainZRecords,
  promptFor,
  prBody,
  sameNormalizedPaths,
  sanitize,
  validateChangedPaths,
  validateCheckSelection,
  validateCommitMessage,
  validateRequiredChecks,
  validateStatusSnapshot,
  worktreePath,
  childEnvironment,
  codexSandboxArgs,
  npmCheckInvocation,
} from "../../scripts/agent-bridge/core.mjs";

test("runtime permissions deny by default", () => {
  assert.equal(Object.values(RUNTIME_DENY).every((value) => value === false), true);
});

test("path policy rejects traversal and permits scoped paths", () => {
  assert.equal(normalizeRepoPath("../x"), null);
  assert.equal(validateChangedPaths(["docs/AGENT_BRIDGE.md"]).valid, true);
  assert.equal(validateChangedPaths(["supabase/x.ts"]).valid, false);
  assert.equal(validateChangedPaths(["C:\\temp\\x.md"]).valid, false);
});

test("eligibility requires bot validation marker and deterministic branch", () => {
  const body = "contract";
  const issue = {
    number: 7,
    title: "Bridge bootstrap",
    body,
    labels: [{ name: "agent:ready" }],
    validationEvidence: { author: "github-actions[bot]", version: "v1", digest: issueBodyDigest(body) },
  };
  assert.equal(eligible(issue), true);
  assert.equal(eligible({ ...issue, validationEvidence: { ...issue.validationEvidence, author: "human" } }), false);
  assert.match(branchFor(issue), /^agent\/7-/);
});

test("child prompt is scoped and sanitized", () => {
  const prompt = promptFor({ number: 7 }, { branch: "agent/7-task", worktree: "isolated", allowedPaths: ["docs/"] });
  assert.match(prompt, /parentClaimed/);
  assert.equal(prompt.includes("production"), true);
  assert.equal(sanitize("ghp_secret C:\\private\\x"), "[redacted] [private-path]");
});

test("PR body and failures stay categorical", () => {
  const body = prBody({ number: 7 });
  assert.ok(body.includes("- [x] `npm run test:bridge`"));
  assert.ok(body.includes("- [x] `npm run check`"));
  assert.ok(body.includes("- [x] `git diff --check`"));
  assert.equal(sanitize("fatal token ghp_ABC"), "fatal token [redacted]");
});

test("worktree paths stay outside canonical checkout", () => {
  assert.match(worktreePath("C:/repo", "C:/runtime", "agent/7-task"), /worktrees/);
  assert.throws(() => worktreePath("C:/repo", "C:/repo/.agent-bridge", "agent/7-task"), /worktree_must_be_outside_checkout/);
});

test("child environment strips credentials and enforces sandbox", () => {
  const env = childEnvironment({ PATH: "p", SystemRoot: "s", GH_TOKEN: "secret", SUPABASE_KEY: "secret", DATABASE_URL: "secret", JWT: "secret" });
  assert.deepEqual(env, { PATH: "p", SystemRoot: "s" });
  const fixture = path.join("isolated", "worktree");
  const args = codexSandboxArgs(fixture);
  assert.ok(args.includes("--sandbox"));
  assert.ok(args.includes("workspace-write"));
  assert.ok(args.includes("--cd"));
  assert.ok(args.includes(path.resolve(fixture)));
});

test("npm checks use fixed executable arrays on both platforms", () => {
  const win = npmCheckInvocation("win32", "npm run check");
  assert.equal(win.program, "npm.cmd");
  assert.deepEqual(win.args, ["run", "check"]);
  const posix = npmCheckInvocation("linux", "npm run check");
  assert.equal(posix.program, "npm");
  assert.deepEqual(posix.args, ["run", "check"]);
});

test("porcelain-z parsing preserves spaces unicode and rename paths", () => {
  const encoded = " M docs/space name-ю.md\0R  docs/old name.md\0docs/new name.md\0?? scripts/[draft].mjs\0";
  assert.deepEqual(parsePorcelainZ(encoded), ["docs/space name-ю.md", "docs/old name.md", "docs/new name.md", "scripts/[draft].mjs"]);
  assert.deepEqual(parsePorcelainZRecords(encoded), [
    { xy: " M", kind: "path", path: "docs/space name-ю.md", paths: ["docs/space name-ю.md"] },
    { xy: "R ", kind: "rename", fromPath: "docs/old name.md", path: "docs/new name.md", paths: ["docs/old name.md", "docs/new name.md"] },
    { xy: "??", kind: "path", path: "scripts/[draft].mjs", paths: ["scripts/[draft].mjs"] },
  ]);
});

test("dry-run plan performs no mutations", () => {
  assert.deepEqual(dryRunPlan({ number: 7 }), { outcome: "dry-run", issue: 7, allowedPaths: ["sanitized issue contract"], runtimeOperations: 0, mutations: 0 });
});

test("child prompt carries complete contract and PR body attestations", () => {
  const issue = {
    number: 7,
    body: "### Goal\nShip\n### Context\nTest\n### In scope\n`docs/`\n### Out of scope\nRuntime\n### Acceptance criteria\nChecks\n### Allowed paths\n`docs/`\n### Required checks\n`npm run test:bridge` `npm run check` `git diff --check`\n### Security constraints\nDeny\n### Dependencies\nNone\n### Rollback\nClose\n### Runtime permission matrix\nSQL: denied",
  };
  const contract = parseIssueContract(issue);
  const parsed = JSON.parse(promptFor(issue, { branch: "agent/7-task", worktree: "isolated", contract }));
  assert.equal(contract.valid, true);
  assert.equal(parsed.contract.goal, "Ship");
  assert.deepEqual(parsed.contract.requiredChecks, ["npm run test:bridge", "npm run check", "git diff --check"]);
  const body = prBody(issue);
  assert.match(body, /Closes #7/);
  assert.ok(body.includes("- [x] `npm run test:bridge`"));
});

test("valid docs commit message is accepted and the existing default remains compatible", () => {
  assert.deepEqual(validateCommitMessage("docs: record verified development forecast scan"), { valid: true, type: "docs" });
  assert.deepEqual(validateCommitMessage(DEFAULT_COMMIT_MESSAGE), { valid: true, type: "feat" });
});

test("commit message validation rejects invalid type and empty subject", () => {
  assert.equal(validateCommitMessage("style: spacing").category, "commit_message_not_conventional");
  assert.equal(validateCommitMessage("docs: ").category, "commit_message_whitespace");
  assert.equal(validateCommitMessage("docs:").category, "commit_message_not_conventional");
});

test("commit message validation rejects newline and nul", () => {
  assert.equal(validateCommitMessage("docs: line one\nline two").category, "commit_message_newline");
  assert.equal(validateCommitMessage("docs: bad\0value").category, "commit_message_nul");
});

test("commit message validation rejects oversized and whitespace wrapped messages", () => {
  const oversized = `docs: ${"x".repeat(COMMIT_MESSAGE_MAX_LENGTH)}`;
  assert.equal(validateCommitMessage(oversized).category, "commit_message_too_long");
  assert.equal(validateCommitMessage(" docs: spaced").category, "commit_message_whitespace");
  assert.equal(validateCommitMessage("docs: spaced ").category, "commit_message_whitespace");
});

test("commit message validation rejects shell metacharacters", () => {
  assert.equal(validateCommitMessage("docs: use $(whoami)").category, "commit_message_shell_metacharacter");
  assert.equal(validateCommitMessage("docs: add `code` sample").category, "commit_message_shell_metacharacter");
});

test("safe named checks map to fixed executable arrays", () => {
  assert.deepEqual(Object.keys(SAFE_CHECK_REGISTRY), ["npm-check", "bridge-tests", "diff-check"]);
  assert.deepEqual(checkCommandsForIds(DEFAULT_SAFE_CHECK_IDS).map((entry) => ({ id: entry.id, label: entry.label, args: entry.args })), [
    { id: "bridge-tests", label: "npm run test:bridge", args: ["run", "test:bridge"] },
    { id: "npm-check", label: "npm run check", args: ["run", "check"] },
    { id: "diff-check", label: "git diff --check", args: ["diff", "--check"] },
  ]);
});

test("check selection rejects unknown ids, deduplicates duplicates, and enforces a maximum", () => {
  assert.equal(validateCheckSelection(["nope"]).category, "unknown_safe_check_id");
  assert.deepEqual(validateCheckSelection(["diff-check", "diff-check", "bridge-tests"]).ids, ["diff-check", "bridge-tests"]);
  assert.equal(validateCheckSelection(Array.from({ length: MAX_SAFE_CHECK_IDS + 1 }, (_, index) => `id-${index}`)).category, "check_selection_too_large");
});

test("required checks must match the fixed safe registry", () => {
  const valid = validateRequiredChecks(["npm run test:bridge", "npm run check", "git diff --check"], ["npm-check", "bridge-tests", "diff-check"]);
  assert.equal(valid.valid, true);
  assert.deepEqual(valid.ids, ["npm-check", "bridge-tests", "diff-check"]);
  assert.equal(validateRequiredChecks(["npm run check"], ["npm-check"]).valid, false);
});

test("parseConfig reads trusted parent-owned options and preserves defaults", () => {
  assert.equal(parseConfig([], {}).commitMessage, DEFAULT_COMMIT_MESSAGE);
  assert.deepEqual(parseConfig([], {}).checkIds, DEFAULT_SAFE_CHECK_IDS);
  assert.equal(parseConfig(["--commit-message", "docs: record verified development forecast scan"], {}).commitMessage, "docs: record verified development forecast scan");
  assert.deepEqual(parseConfig(["--checks", "npm-check,bridge-tests,diff-check"], {}).checkIds, ["npm-check", "bridge-tests", "diff-check"]);
});

test("status snapshots reject out-of-scope paths and require intended changes", () => {
  assert.equal(validateStatusSnapshot("", ["docs/"]).valid, false);
  assert.equal(validateStatusSnapshot("?? docs/new.md\0", ["docs/"]).valid, true);
  assert.equal(validateStatusSnapshot("?? ../escape.txt\0", ["docs/"]).valid, false);
  assert.equal(validateStatusSnapshot("?? C:/escape.txt\0", ["docs/"]).valid, false);
});

test("status snapshots keep lifecycle path identity stable across checks", () => {
  const child = validateStatusSnapshot(" M docs/project-status.md\0?? docs/roadmap.md\0", ["docs/"]);
  const postChecks = validateStatusSnapshot(" M docs/project-status.md\0?? docs/roadmap.md\0", ["docs/"]);
  const generated = validateStatusSnapshot(" M docs/project-status.md\0?? docs/roadmap.md\0?? docs/generated.tmp\0", ["docs/"]);
  assert.equal(sameNormalizedPaths(child.changedPaths, postChecks.changedPaths), true);
  assert.equal(sameNormalizedPaths(child.changedPaths, generated.changedPaths), false);
});
