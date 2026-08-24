import { readdirSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { join } from "node:path";

const sources = [
  ...readdirSync("js", { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith(".js"))
    .map((entry) => join("js", entry.name)),
  ...readdirSync("scripts", { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith(".mjs"))
    .map((entry) => join("scripts", entry.name)),
];

for (const source of sources) {
  const result = spawnSync(process.execPath, ["--check", source], {
    stdio: "inherit",
  });
  if (result.status !== 0) process.exit(result.status ?? 1);
}
