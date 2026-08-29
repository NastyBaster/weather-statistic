import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { issueBodyDigest, validationEvidenceMatches } from "../../scripts/agent-bridge/core.mjs";

test("PR workflow is scoped to agent branches and bootstrap exception", async () => {
  const source = await readFile(".github/workflows/agent-pr-contract.yml", "utf8");
  assert.equal(source.includes("startsWith(github.head_ref, 'agent/')"), true);
  assert.equal(source.includes("feat/single-task-agent-bridge"), true);
});

test("issue readiness requires current bot-authored digest marker", () => {
  const body = "### Goal\ncontract";
  const evidence = { author: "github-actions[bot]", version: "v1", digest: issueBodyDigest(body) };
  assert.equal(validationEvidenceMatches({ body, validationEvidence: evidence }), true);
  assert.equal(validationEvidenceMatches({ body, validationEvidence: { ...evidence, digest: "old" } }), false);
  assert.equal(validationEvidenceMatches({ body, validationEvidence: { ...evidence, author: "human" } }), false);
});
test("issue workflow requires substantive backtick allowed paths", async () => { const source = await readFile(".github/workflows/agent-issue-contract.yml", "utf8"); assert.match(source, /Allowed paths must use backtick syntax/); assert.ok(source.includes("replace(/<!--[\\s\\S]*?-->/g")); });
test("issue readiness invalidation removes stale labels and exact checks are enforced", async () => { const source = await readFile(".github/workflows/agent-issue-contract.yml", "utf8"); assert.match(source, /removeValidate/); assert.match(source, /Required checks must be exactly the approved commands/); assert.match(source, /npm run test:bridge/); assert.match(source, /git diff --check/); });
