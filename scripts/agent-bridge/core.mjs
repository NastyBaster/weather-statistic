import path from "node:path";
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";

export const RUNTIME_DENY = Object.freeze({ sql: false, http: false, pgNet: false, collector: false, deploy: false, secrets: false, migrations: false, cron: false, production: false });
export const defaults = Object.freeze({ dryRun: true, autoMerge: false, concurrency: 1 });
export const allowedPaths = Object.freeze(["package.json", "scripts/agent-bridge/", "tests/agent-bridge/", ".github/ISSUE_TEMPLATE/agent-task.yml", ".github/PULL_REQUEST_TEMPLATE.md", ".github/labels.yml", ".github/workflows/agent-issue-contract.yml", ".github/workflows/agent-pr-contract.yml", "docs/AGENT_BRIDGE.md", "docs/BRIDGE_RUNBOOK.md", "docs/adr/0001-bounded-autonomous-agent-bridge.md", "docs/project-status.md", "docs/roadmap.md"]);
export const DEFAULT_COMMIT_MESSAGE = "feat: complete bounded agent task";
export const COMMIT_MESSAGE_MAX_LENGTH = 120;
export const SAFE_CHECK_REGISTRY = Object.freeze({
  "npm-check": Object.freeze({ id: "npm-check", command: "npm", args: ["run", "check"], label: "npm run check" }),
  "bridge-tests": Object.freeze({ id: "bridge-tests", command: "npm", args: ["run", "test:bridge"], label: "npm run test:bridge" }),
  "diff-check": Object.freeze({ id: "diff-check", command: "git", args: ["diff", "--check"], label: "git diff --check" }),
});
export const DEFAULT_SAFE_CHECK_IDS = Object.freeze(["bridge-tests", "npm-check", "diff-check"]);
export const MAX_SAFE_CHECK_IDS = 8;
export function sanitize(value) { return String(value ?? "").replace(/(?:gh[pousr]_|github_pat_)[A-Za-z0-9_-]+/gi, "[redacted]").replace(/[A-Za-z]:\\[^\s"']+/g, "[private-path]"); }
export function normalizeRepoPath(value) { const raw = String(value ?? "").replaceAll("\\", "/"); if (!raw || raw.startsWith("/") || /^[A-Za-z]:\//.test(raw) || raw.split("/").includes("..")) return null; return raw.replace(/^\.\//, ""); }
export function validateChangedPaths(paths, permitted = allowedPaths) { const normalized = paths.map(normalizeRepoPath); const invalid = normalized.map((p, i) => p && permitted.some((a) => a.endsWith("/") ? p.startsWith(a) : p === a) ? null : paths[i]).filter((value, index) => !normalized[index] || Boolean(value)); return { valid: invalid.length === 0, invalid }; }
export function parsePorcelainZRecords(output) {
  const tokens = String(output ?? "").split("\0");
  const records = [];
  for (let i = 0; i < tokens.length; i += 1) {
    const token = tokens[i];
    if (!token) continue;
    if (token.length < 4 || token[2] !== " ") throw new Error("malformed_porcelain_z");
    const xy = token.slice(0, 2);
    const pathName = token.slice(3);
    if (!pathName) throw new Error("malformed_porcelain_z");
    if (xy.includes("R") || xy.includes("C")) {
      const targetPath = tokens[++i];
      if (!targetPath) throw new Error("malformed_porcelain_z");
      records.push({ xy, kind: xy.includes("R") ? "rename" : "copy", fromPath: pathName, path: targetPath, paths: [pathName, targetPath] });
      continue;
    }
    records.push({ xy, kind: "path", path: pathName, paths: [pathName] });
  }
  return records;
}
export function parsePorcelainZ(output) { return parsePorcelainZRecords(output).flatMap((record) => record.paths); }
export function normalizedUniquePaths(paths) { return [...new Set(paths.map(normalizeRepoPath).filter(Boolean))].sort(); }
export function sameNormalizedPaths(left, right) {
  const a = normalizedUniquePaths(left);
  const b = normalizedUniquePaths(right);
  return a.length === b.length && a.every((value, index) => value === b[index]);
}
export function sameStringSet(left, right) {
  const a = [...new Set((Array.isArray(left) ? left : []).map((value) => String(value)))].sort();
  const b = [...new Set((Array.isArray(right) ? right : []).map((value) => String(value)))].sort();
  return a.length === b.length && a.every((value, index) => value === b[index]);
}
export function validateStatusSnapshot(output, permitted = allowedPaths) {
  const records = parsePorcelainZRecords(output);
  const changedPaths = records.flatMap((record) => record.paths);
  const pathCheck = validateChangedPaths(changedPaths, permitted);
  return { records, changedPaths, valid: records.length > 0 && pathCheck.valid, invalid: pathCheck.invalid };
}
export function issueAllowedPaths(issue) { const body = String(issue?.body ?? ""); const section = body.match(/### Allowed paths\s*([\s\S]*?)(?=\n### |$)/i)?.[1] ?? ""; return [...section.matchAll(/`([^`]+)`/g)].map((m) => m[1]).filter(Boolean); }
const requiredContractSections = ["Goal", "Context", "In scope", "Out of scope", "Acceptance criteria", "Allowed paths", "Required checks", "Security constraints", "Dependencies", "Rollback", "Runtime permission matrix"];
export function substantiveSection(body, heading, level = "###") { const match = String(body ?? "").match(new RegExp(`(?:^|\\n)${level} ${heading}[^\\n]*\\n([\\s\\S]*?)(?=\\n${level} |$)`, "i")); return String(match?.[1] ?? "").replace(/<!--[\\s\\S]*?-->/g, "").replace(/_No response_/gi, "").trim(); }
export function parseIssueContract(issue) { const body = normalizeIssueBody(issue?.body); const sections = Object.fromEntries(requiredContractSections.map((h) => [h, substantiveSection(body, h)])); const allowedPaths = issueAllowedPaths({ body }); const requiredChecks = [...(sections["Required checks"].matchAll(/`([^`]+)`/g))].map((m) => m[1]); const valid = requiredContractSections.every((h) => sections[h].length > 0) && allowedPaths.length > 0 && requiredChecks.length > 0; return { valid, sections, allowedPaths, requiredChecks, runtimePermissions: sections["Runtime permission matrix"] }; }
export function normalizeIssueBody(body) { return String(body ?? "").replace(/\r\n/g, "\n").trim(); }
export function issueBodyDigest(body) { return createHash("sha256").update(normalizeIssueBody(body), "utf8").digest("hex"); }
export function validationEvidenceMatches(issue) { const evidence = issue?.validationEvidence; return Boolean(evidence?.author === "github-actions[bot]" && evidence?.version === "v1" && evidence?.digest === issueBodyDigest(issue?.body)); }
export function eligible(issue) { const labels = (issue?.labels ?? []).map((l) => l.name); return labels.includes("agent:ready") && !labels.some((l) => ["agent:running", "agent:review", "agent:blocked"].includes(l)) && validationEvidenceMatches(issue); }
function optionValue(args, optionName) {
  const index = args.indexOf(optionName);
  if (index === -1) return null;
  const value = args[index + 1];
  if (!value || value.startsWith("--")) throw new Error(`${optionName}_requires_value`);
  return value;
}
export function parseConfig(args = [], env = process.env) {
  const selectedChecks = optionValue(args, "--checks");
  return {
    ...defaults,
    dryRun: args.includes("--dry-run") || env.BRIDGE_DRY_RUN !== "false",
    commitMessage: optionValue(args, "--commit-message") ?? DEFAULT_COMMIT_MESSAGE,
    checkIds: selectedChecks ? selectedChecks.split(",").map((value) => value.trim()).filter(Boolean) : [...DEFAULT_SAFE_CHECK_IDS],
  };
}
export function branchFor(issue) { return `agent/${issue.number}-${String(issue.title ?? "task").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 48) || "bridge-task"}`; }
export function worktreePath(rootPath, runtimeRoot, branch) { const candidate = path.resolve(runtimeRoot, "worktrees", branch.replaceAll("/", "-")); const checkout = path.resolve(rootPath); if (candidate === checkout || candidate.startsWith(checkout + path.sep)) throw new Error("worktree_must_be_outside_checkout"); return candidate; }
export const childEnvironment = (source = process.env) => Object.fromEntries(["PATH", "SystemRoot", "TEMP", "TMP", "ComSpec"].filter((key) => typeof source[key] === "string").map((key) => [key, source[key]]));
export const codexSandboxArgs = (worktree) => ["exec", "--ephemeral", "--sandbox", "workspace-write", "--cd", path.resolve(worktree)];
export function npmCheckInvocation(platform, command) { const parts = command.split(" "); return { program: platform === "win32" ? "npm.cmd" : "npm", args: parts.slice(1) }; }
export function codexCommand(platform = process.platform) { return platform === "win32" ? "codex.cmd" : "codex"; }
export function runChild(command, args, options = {}) { return new Promise((resolve, reject) => { const child = spawn(command, args, { ...options, shell: false, stdio: ["ignore", "pipe", "pipe"] }); let out = ""; let err = ""; child.stdout.on("data", (c) => { out += c; }); child.stderr.on("data", (c) => { err += c; }); child.on("error", reject); child.on("close", (code) => resolve({ code, output: sanitize(out), error: sanitize(err) })); }); }
export function promptFor(issue, context) { const contract = context.contract || parseIssueContract(issue); return JSON.stringify({ lifecycle: "agent:running", parentClaimed: true, issue: issue.number, contract: { goal: contract.sections.Goal, context: contract.sections.Context, inScope: contract.sections["In scope"], outOfScope: contract.sections["Out of scope"], acceptanceCriteria: contract.sections["Acceptance criteria"], allowedPaths: contract.allowedPaths, requiredChecks: contract.requiredChecks, securityConstraints: contract.sections["Security constraints"], dependencies: contract.sections.Dependencies, rollback: contract.sections.Rollback, runtimePermissionMatrix: contract.runtimePermissions }, branch: context.branch, worktree: context.worktree, childOwns: ["edit supplied worktree", "run approved checks", "return summary"], parentOwns: ["commit", "push", "pull request", "merge", "labels", "cleanup"], runtimePermissions: RUNTIME_DENY, issueBodyUntrusted: true }); }
export const SAFE_CHECKS = Object.freeze(["npm run test:bridge", "npm run check", "git diff --check"]);
const conventionalCommitPattern = /^(feat|fix|docs|test|refactor|chore|ci|build|perf|revert)(\([a-z0-9][a-z0-9._/-]*\))?!?: [^\s].*$/;
export function validateCommitMessage(message) {
  if (typeof message !== "string") return { valid: false, category: "commit_message_missing" };
  if (message.length === 0) return { valid: false, category: "commit_message_missing" };
  if (message !== message.trim()) return { valid: false, category: "commit_message_whitespace" };
  if (message.includes("\r") || message.includes("\n")) return { valid: false, category: "commit_message_newline" };
  if (message.includes("\0")) return { valid: false, category: "commit_message_nul" };
  if (message.length > COMMIT_MESSAGE_MAX_LENGTH) return { valid: false, category: "commit_message_too_long" };
  if (/[`$;&|<>]/.test(message)) return { valid: false, category: "commit_message_shell_metacharacter" };
  if (!conventionalCommitPattern.test(message)) return { valid: false, category: "commit_message_not_conventional" };
  return { valid: true, type: message.split(":")[0].split("(")[0] };
}
export function validateCheckSelection(checkIds) {
  const list = Array.isArray(checkIds) ? checkIds : [];
  if (list.length === 0) return { valid: false, category: "check_selection_missing", ids: [] };
  if (list.length > MAX_SAFE_CHECK_IDS) return { valid: false, category: "check_selection_too_large", ids: [] };
  const ids = [...new Set(list)];
  const unknown = ids.filter((id) => !(id in SAFE_CHECK_REGISTRY));
  if (unknown.length > 0) return { valid: false, category: "unknown_safe_check_id", ids, unknown };
  return { valid: true, ids };
}
export function checkCommandsForIds(checkIds) {
  return checkIds.map((id) => SAFE_CHECK_REGISTRY[id]).filter(Boolean).map((entry) => ({ id: entry.id, label: entry.label, command: entry.command === "npm" && process.platform === "win32" ? "npm.cmd" : entry.command, args: [...entry.args] }));
}
export function validateRequiredChecks(commands, selectedIds = DEFAULT_SAFE_CHECK_IDS) {
  const list = Array.isArray(commands) ? commands : [];
  const selection = validateCheckSelection(selectedIds);
  if (!selection.valid) return { valid: false, commands: list, category: selection.category, ids: [] };
  const resolved = checkCommandsForIds(selection.ids);
  const allowedLabels = resolved.map((entry) => entry.label);
  const valid = SAFE_CHECKS.every((command) => list.includes(command)) && list.every((command) => SAFE_CHECKS.includes(command)) && sameStringSet(list, allowedLabels);
  return { valid, commands: list, ids: selection.ids, registry: resolved, category: valid ? null : "required_checks_mismatch" };
}
export function prBody(issue, checks = SAFE_CHECKS) { const checked = SAFE_CHECKS.filter((c) => checks.includes(c)).map((c) => `- [x] \`${c}\``).join("\n"); return [`## Issue`, `\nCloses #${issue.number}`, `\n## Motivation`, `\nBounded single-task Bridge execution for one approved issue.`, `\n## Scope`, `\nOnly contract-allowed paths and one isolated task.`, `\n## Parent/child security boundary`, `\nParent owns Git/GitHub lifecycle; child edits only the supplied worktree.`, `\n## Runtime deny policy`, `\nSQL, HTTP, pg_net, collector, deploy, secrets, migrations, Cron, and production operations are denied.`, `\n## Tests`, `\n${checked}`, `\n## Manual post-merge configuration`, `\nHuman-managed labels, protection, and merge boundary.`, `\n## Explicit non-goals`, `\nNo batch, watch, process scanning, leases, auto-merge, installer, or runtime automation.`].join("\n"); }
export function dryRunPlan(issue) { return { outcome: "dry-run", issue: issue?.number ?? null, allowedPaths: issue ? ["sanitized issue contract"] : [], runtimeOperations: 0, mutations: 0 }; }
