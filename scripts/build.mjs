import { cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const output = resolve(root, "dist");
const requireConfig = process.argv.includes("--require-config");
const environment = process.env.APP_ENVIRONMENT || "local";
const supabaseUrl = process.env.SUPABASE_URL || "";
const supabasePublishableKey = process.env.SUPABASE_PUBLISHABLE_KEY || "";

function validateConfig() {
  if (!requireConfig && !supabaseUrl && !supabasePublishableKey) return;
  if (!supabaseUrl || !supabasePublishableKey) {
    throw new Error("SUPABASE_URL and SUPABASE_PUBLISHABLE_KEY must both be configured");
  }

  const url = new URL(supabaseUrl);
  if (url.protocol !== "https:" || !url.hostname.endsWith(".supabase.co")) {
    throw new Error("SUPABASE_URL must be an HTTPS *.supabase.co URL");
  }
}

validateConfig();
await rm(output, { recursive: true, force: true });
await mkdir(output, { recursive: true });

for (const path of ["index.html", "css", "js"]) {
  await cp(resolve(root, path), resolve(output, path), { recursive: true });
}

const config = {
  environment,
  supabaseUrl,
  supabasePublishableKey,
};
await writeFile(
  resolve(output, "runtime-config.js"),
  `globalThis.__APP_CONFIG__ = Object.freeze(${JSON.stringify(config, null, 2)});\n`,
);

const html = await readFile(resolve(output, "index.html"), "utf8");
if (!html.includes('src="runtime-config.js"')) {
  throw new Error("index.html must load runtime-config.js before the application module");
}

console.log(`Built ${environment} site in dist/`);
