import { readdirSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { join } from "node:path";

const tests = readdirSync("tests", { withFileTypes: true })
  .filter((entry) => entry.isFile() && entry.name.endsWith(".test.js"))
  .map((entry) => join("tests", entry.name));

const result = spawnSync(process.execPath, ["--test", ...tests], {
  stdio: "inherit",
});
process.exit(result.status ?? 1);
