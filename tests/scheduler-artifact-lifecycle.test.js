import assert from "node:assert/strict";
import { createSchedulerDevelopmentLocalBinding } from "../scripts/lib/scheduler-development-local-binding.mjs";

const names = ["scheduler-exactly-once-enqueue.sql", "scheduler-post-enqueue-evidence.sql", "scheduler-negative-evidence.sql", "scheduler-phase-state.json", "scheduler-negative-evidence.sql.tmp"];
function fsFixture(entries = names) {
  const files = new Set(entries), removed = [];
  return { removed,
    async mkdir() {}, async readdir(path) { return path.endsWith("scheduler-resume-claim") ? [] : [...files]; },
    async lstat(path) {
      if (path.endsWith("scheduler-resume-claim") && !files.has("scheduler-resume-claim")) { const error = new Error("missing"); error.code = "ENOENT"; throw error; }
      return { isSymbolicLink: () => path.includes("link"), isDirectory: () => path.endsWith("safe-validation") || path.endsWith("safe-validation/") || path.endsWith("scheduler-resume-claim") };
    },
    async unlink(path) { const name = path.split(/[\\/]/).pop(); files.delete(name); removed.push(name); },
    async writeFile() {}, async rename() {}, async rm(path, options) { if (options?.recursive !== false) files.clear(); }, async rmdir() { files.clear(); },
  };
}
const fs = fsFixture();
const binding = createSchedulerDevelopmentLocalBinding({ filesystem: fs, temporaryDirectory: "C:/safe-validation" });
await binding.prepareAttempt();
assert.equal(fs.removed.length, 5);
assert.equal(fs.removed.includes("scheduler-exactly-once-enqueue.sql"), true);
assert.equal(fs.removed.includes("scheduler-post-enqueue-evidence.sql"), true);
assert.equal(fs.removed.includes("scheduler-negative-evidence.sql.tmp"), true);

const stale = fsFixture(["scheduler-exactly-once-enqueue.sql", "scheduler-post-enqueue-evidence.sql"]);
const scoped = createSchedulerDevelopmentLocalBinding({ filesystem: stale, temporaryDirectory: "C:/safe-validation" });
await scoped.clearWriteArtifacts();
assert.deepEqual(stale.removed.sort(), ["scheduler-exactly-once-enqueue.sql", "scheduler-post-enqueue-evidence.sql"]);

const unsafe = fsFixture(["unexpected.sql"]);
await assert.rejects(createSchedulerDevelopmentLocalBinding({ filesystem: unsafe, temporaryDirectory: "C:/safe-validation" }).prepareAttempt(), /validation_artifact_path_unsafe/);
const symlink = fsFixture(["scheduler-negative-evidence.sql"]);
symlink.lstat = async () => ({ isSymbolicLink: () => true, isDirectory: () => false });
await assert.rejects(createSchedulerDevelopmentLocalBinding({ filesystem: symlink, temporaryDirectory: "C:/safe-validation" }).clearWriteArtifacts(), /validation_artifact_path_unsafe/);

const failed = fsFixture(["scheduler-exactly-once-enqueue.sql"]);
failed.unlink = async () => { throw new Error("cleanup"); };
await assert.rejects(createSchedulerDevelopmentLocalBinding({ filesystem: failed, temporaryDirectory: "C:/safe-validation" }).clearWriteArtifacts());
const empty = fsFixture([]);
await createSchedulerDevelopmentLocalBinding({ filesystem: empty, temporaryDirectory: "C:/safe-validation" }).cleanupArtifacts();
const missing = fsFixture([]);
missing.rmdir = async () => { const error = new Error("missing"); error.code = "ENOENT"; throw error; };
await createSchedulerDevelopmentLocalBinding({ filesystem: missing, temporaryDirectory: "C:/safe-validation" }).cleanupArtifacts();
const unexpectedDirectory = fsFixture(["nested"]);
unexpectedDirectory.lstat = async (path) => ({ isSymbolicLink: () => false, isDirectory: () => path.endsWith("safe-validation") || path.endsWith("nested") });
await assert.rejects(createSchedulerDevelopmentLocalBinding({ filesystem: unexpectedDirectory, temporaryDirectory: "C:/safe-validation" }).cleanupArtifacts(), /validation_artifact_path_unsafe/);
const access = fsFixture([]);
access.rmdir = async () => { const error = new Error("denied"); error.code = "EACCES"; throw error; };
await assert.rejects(createSchedulerDevelopmentLocalBinding({ filesystem: access, temporaryDirectory: "C:/safe-validation" }).cleanupArtifacts(), /validation_artifact_cleanup_failed/);
assert.equal(JSON.stringify(fs.removed).includes("C:/"), false);
console.log("scheduler artifact lifecycle: 13 fixtures, 0 failed, 0 skipped, 0 not-run");
