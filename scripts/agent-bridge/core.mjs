import path from "node:path";
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";

export const RUNTIME_DENY = Object.freeze({ sql: false, http: false, pgNet: false, collector: false, deploy: false, secrets: false, migrations: false, cron: false, production: false });
export const defaults = Object.freeze({ dryRun: true, autoMerge: false, concurrency: 1 });
export const allowedPaths = Object.freeze(["package.json", "scripts/agent-bridge/", "tests/agent-bridge/", ".github/ISSUE_TEMPLATE/agent-task.yml", ".github/PULL_REQUEST_TEMPLATE.md", ".github/labels.yml", ".github/workflows/agent-issue-contract.yml", ".github/workflows/agent-pr-contract.yml", "docs/AGENT_BRIDGE.md", "docs/BRIDGE_RUNBOOK.md", "docs/adr/0001-bounded-autonomous-agent-bridge.md", "docs/project-status.md", "docs/roadmap.md"]);
export function sanitize(value) { return String(value ?? "").replace(/(?:gh[pousr]_|github_pat_)[A-Za-z0-9_-]+/gi, "[redacted]").replace(/[A-Za-z]:\\[^\s"']+/g, "[private-path]"); }
export function normalizeRepoPath(value) { const raw = String(value ?? "").replaceAll("\\", "/"); if (!raw || raw.startsWith("/") || /^[A-Za-z]:\//.test(raw) || raw.split("/").includes("..")) return null; return raw.replace(/^\.\//, ""); }
export function validateChangedPaths(paths, permitted = allowedPaths) { const normalized = paths.map(normalizeRepoPath); const invalid = normalized.map((p, i) => p && permitted.some((a) => a.endsWith("/") ? p.startsWith(a) : p === a) ? null : paths[i]).filter(Boolean); return { valid: invalid.length === 0, invalid }; }
export function issueAllowedPaths(issue) { const body = String(issue?.body ?? ""); const section = body.match(/### Allowed paths\s*([\s\S]*?)(?=\n### |$)/i)?.[1] ?? ""; return [...section.matchAll(/`([^`]+)`/g)].map((m) => m[1]).filter(Boolean); }
export function normalizeIssueBody(body) { return String(body ?? "").replace(/\r\n/g, "\n").trim(); }
export function issueBodyDigest(body) { return createHash("sha256").update(normalizeIssueBody(body), "utf8").digest("hex"); }
export function validationEvidenceMatches(issue) { const evidence = issue?.validationEvidence; return Boolean(evidence?.author === "github-actions[bot]" && evidence?.version === "v1" && evidence?.digest === issueBodyDigest(issue?.body)); }
export function eligible(issue) { const labels = (issue?.labels ?? []).map((l) => l.name); return labels.includes("agent:ready") && !labels.some((l) => ["agent:running", "agent:review", "agent:blocked"].includes(l)) && validationEvidenceMatches(issue); }
export function parseConfig(args = [], env = process.env) { return { ...defaults, dryRun: args.includes("--dry-run") || env.BRIDGE_DRY_RUN !== "false" }; }
export function branchFor(issue) { return `agent/${issue.number}-${String(issue.title ?? "task").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 48) || "bridge-task"}`; }
export function codexCommand(platform = process.platform) { return platform === "win32" ? "codex.cmd" : "codex"; }
export function runChild(command, args, options = {}) { return new Promise((resolve, reject) => { const child = spawn(command, args, { ...options, shell: false, stdio: ["ignore", "pipe", "pipe"] }); let out = ""; let err = ""; child.stdout.on("data", (c) => { out += c; }); child.stderr.on("data", (c) => { err += c; }); child.on("error", reject); child.on("close", (code) => resolve({ code, output: sanitize(out), error: sanitize(err) })); }); }
export function promptFor(issue, context) { return JSON.stringify({ lifecycle: "agent:running", parentClaimed: true, issue: issue.number, branch: context.branch, worktree: context.worktree, allowedPaths: context.allowedPaths, childOwns: ["edit supplied worktree", "run checks", "return summary"], parentOwns: ["commit", "push", "pull request", "merge", "labels", "cleanup"], runtimePermissions: RUNTIME_DENY, issueBodyUntrusted: true }); }
export function dryRunPlan(issue) { return { outcome: "dry-run", issue: issue?.number ?? null, allowedPaths: issue ? ["sanitized issue contract"] : [], runtimeOperations: 0, mutations: 0 }; }
