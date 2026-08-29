import path from "node:path";
import { access, lstat } from "node:fs/promises";
import { runChild, sanitize } from "./core.mjs";
import { ownerPresent } from "./ownership.mjs";
import { expectedLabels, evaluateDoctor } from "./doctor-core.mjs";
export const committedWorkflows = [".github/workflows/agent-issue-contract.yml", ".github/workflows/agent-pr-contract.yml"];
const command = async (args, cwd) => { try { const result = await runChild(args[0], args.slice(1), { cwd }); return { ok: result.code === 0, output: result.output }; } catch { return { ok: false, output: "" }; } };
const canonicalOrigin = (value) => { try { const raw = String(value || "").trim(); const normalized = raw.startsWith("git@github.com:") ? `https://github.com/${raw.slice("git@github.com:".length)}` : raw; const url = new URL(normalized); const repositoryPath = url.pathname.replace(/\.git$/i, "").toLowerCase(); return url.protocol === "https:" && url.hostname.toLowerCase() === "github.com" && repositoryPath === "/nastybaster/weather-statistic"; } catch { return false; } };
export function createRealDoctorAdapter(root = process.cwd()) { return {
  repository: async () => (await command(["git", "config", "--get", "remote.origin.url"], root)).output,
  branch: async () => (await command(["git", "branch", "--show-current"], root)).output.trim(),
  clean: async () => (await command(["git", "status", "--porcelain", "--untracked-files=all"], root)).output.trim() === "",
  head: async () => (await command(["git", "rev-parse", "HEAD"], root)).output.trim(),
  originHead: async () => { const r = await command(["git", "ls-remote", "origin", "refs/heads/main"], root); return r.ok ? r.output.trim().split(/\\s+/)[0] || null : null; },
  git: async () => (await command(["git", "--version"], root)).ok,
  node: () => Number.parseInt(process.versions.node.split(".")[0], 10) >= 20,
  codex: async () => (await command([process.platform === "win32" ? "where.exe" : "which", "codex"], root)).ok,
  ghAuth: async () => (await command(["gh", "auth", "status"], root)).ok,
  labels: async () => { const r = await command(["gh", "label", "list", "--repo", "NastyBaster/weather-statistic", "--limit", "100", "--json", "name"], root); try { return r.ok ? JSON.parse(r.output).map((x) => x.name) : []; } catch { return []; } },
  protection: async () => { const r = await command(["gh", "api", "repos/NastyBaster/weather-statistic/branches/main/protection"], root); if (!r.ok) return false; try { const value = JSON.parse(r.output); return Boolean(value.required_pull_request_reviews && value.allow_force_pushes?.enabled === false); } catch { return false; } },
  workflows: async () => (await Promise.all(committedWorkflows.map((f) => access(path.join(root, f)).then(() => true).catch(() => false)))).every(Boolean),
  runtimeRootSafe: async (rootPath) => { try { const s = await lstat(rootPath); return s.isDirectory() && !s.isSymbolicLink(); } catch (e) { return e.code === "ENOENT"; } },
  ownerPresent: async (rootPath) => ownerPresent(rootPath),
}; }
const probe = async (fn, fallback) => { try { return await fn(); } catch { return fallback; } };
export async function runDoctor(adapter, runtimeRoot = path.join(process.env.LOCALAPPDATA || process.env.TEMP || ".", "ForecastRealityCheck", "agent-bridge", "weather-statistic")) { const raw = await Promise.all([probe(adapter.repository, ""), probe(adapter.branch, ""), probe(adapter.head, null), probe(adapter.originHead, null), probe(adapter.clean, false), probe(adapter.git, false), probe(adapter.node, false), probe(adapter.ghAuth, false), probe(adapter.codex, false), probe(adapter.workflows, false), probe(adapter.labels, []), probe(adapter.protection, false), probe(() => adapter.runtimeRootSafe(runtimeRoot), false), probe(() => adapter.ownerPresent(runtimeRoot), false)]); const [repositoryRaw, branch, head, originHead, clean, git, node, ghAuth, codex, workflows, labels, protection, runtimeRootSafe, ownerPresentValue] = raw; const input = { repository: canonicalOrigin(repositoryRaw) ? "NastyBaster/weather-statistic" : "unknown", branch, clean, synchronized: Boolean(head && originHead && head === originHead), git, node, ghAuth, codex, workflows, labels, protection, runtimeEnabled: false, runtimeRootSafe, ownerPresent: ownerPresentValue }; const result = evaluateDoctor(input); return { ...result, checks: { repository: input.repository, branch: branch === "main", clean, synchronized: input.synchronized, git, node, ghAuth, codex, workflows, labels: expectedLabels.every((l) => labels.includes(l)), protection, runtimeRootSafe, activeOwnership: ownerPresentValue } }; }
export function sanitizedDoctorError(error) { return sanitize(error?.category || "doctor_probe_failed"); }

