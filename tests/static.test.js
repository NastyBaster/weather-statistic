import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("../", import.meta.url);

test("entry page references existing local assets", async () => {
  const html = await readFile(new URL("index.html", root), "utf8");
  const references = [...html.matchAll(/(?:href|src)="((?:css|js)\/[^"?]+)"/g)].map((match) => match[1]);
  assert.deepEqual(references.sort(), ["css/styles.css", "js/app.js"]);
  await Promise.all(references.map((path) => readFile(new URL(path, root), "utf8")));
});

test("stylesheet entry point references existing CSS modules", async () => {
  const stylesheet = await readFile(new URL("css/styles.css", root), "utf8");
  const imports = [...stylesheet.matchAll(/@import url\("([^"]+)"\)/g)].map((match) => match[1]);

  assert.deepEqual(imports, [
    "variables.css",
    "base.css",
    "layout.css",
    "components.css",
    "pages/dashboard.css",
    "responsive.css",
  ]);
  await Promise.all(imports.map((path) => readFile(new URL(`css/${path}`, root), "utf8")));
});

test("entry page has Ukrainian language and one main landmark", async () => {
  const html = await readFile(new URL("index.html", root), "utf8");
  assert.match(html, /<html lang="uk">/);
  assert.equal((html.match(/<main>/g) ?? []).length, 1);
  assert.match(html, /<meta name="viewport"/);
});
