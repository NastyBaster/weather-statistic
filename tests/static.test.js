import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("../", import.meta.url);

test("entry page references existing local assets", async () => {
  const html = await readFile(new URL("index.html", root), "utf8");
  const references = [
    ...html.matchAll(/(?:href|src)="((?:(?:css|js)\/[^"?]+)|runtime-config\.js)"/g),
  ].map((match) => match[1]);
  assert.deepEqual(references.sort(), ["css/styles.css", "js/app.js", "runtime-config.js"]);
  await Promise.all(references.map((path) => readFile(new URL(path, root), "utf8")));
});

test("authentication pages load configuration before their modules", async () => {
  for (const [page, module] of [
    ["login.html", "js/auth-page.js"],
    ["reset-password.html", "js/reset-password.js"],
  ]) {
    const html = await readFile(new URL(page, root), "utf8");
    assert.ok(html.indexOf('src="runtime-config.js"') < html.indexOf(`src="${module}"`));
    assert.match(html, /data-environment-badge/);
    await readFile(new URL(module, root), "utf8");
  }
});

test("dashboard stays public while authentication supports the complete email flow", async () => {
  const html = await readFile(new URL("index.html", root), "utf8");
  const auth = await readFile(new URL("js/auth.js", root), "utf8");
  const dashboardAuth = await readFile(new URL("js/dashboard-auth.js", root), "utf8");
  assert.doesNotMatch(html, /data-protected-page/);
  assert.match(html, /data-sign-in/);
  assert.match(html, /data-sign-out/);
  assert.match(auth, /auth\.getSession\(\)/);
  assert.match(auth, /auth\.signUp/);
  assert.match(auth, /emailRedirectTo: dashboardUrl\(\)/);
  assert.match(auth, /auth\.signInWithPassword/);
  assert.match(auth, /auth\.signOut/);
  assert.match(auth, /auth\.resetPasswordForEmail/);
  assert.match(auth, /auth\.updateUser/);
  assert.match(dashboardAuth, /renderSession/);
  assert.match(dashboardAuth, /location\.replace\(loginUrl\(\)\)/);
});

test("login supports Google OAuth with an explicit dashboard redirect", async () => {
  const login = await readFile(new URL("login.html", root), "utf8");
  const auth = await readFile(new URL("js/auth.js", root), "utf8");
  const authPage = await readFile(new URL("js/auth-page.js", root), "utf8");
  assert.match(login, /data-google-sign-in/);
  assert.match(login, /Продовжити з Google/);
  assert.match(auth, /auth\.signInWithOAuth/);
  assert.match(auth, /provider: "google"/);
  assert.match(auth, /redirectTo: dashboardUrl\(\)/);
  assert.match(authPage, /signInWithGoogle/);
});

test("password inputs support browser autofill and a visibility control", async () => {
  const login = await readFile(new URL("login.html", root), "utf8");
  const visibility = await readFile(new URL("js/password-visibility.js", root), "utf8");
  assert.match(login, /autocomplete="username"/);
  assert.match(login, /data-password-toggle/);
  assert.match(login, /password-icon--show/);
  assert.match(login, /password-icon--hide/);
  assert.match(visibility, /input\.type = visible \? "text" : "password"/);
  assert.match(visibility, /aria-pressed/);
});

test("authentication errors are localized for common Supabase failures", async () => {
  const errors = await readFile(new URL("js/auth-error.js", root), "utf8");
  assert.match(errors, /invalid login credentials/i);
  assert.match(errors, /email rate limit exceeded/i);
  assert.match(errors, /load failed/i);
  assert.match(errors, /Неправильний email або пароль/);
});

test("runtime configuration loads before the application module", async () => {
  const html = await readFile(new URL("index.html", root), "utf8");
  assert.ok(html.indexOf('src="runtime-config.js"') < html.indexOf('src="js/app.js"'));
});

test("initial Supabase migration enables RLS and provides a health check", async () => {
  const migration = await readFile(
    new URL("supabase/migrations/202608170001_create_profiles_and_locations.sql", root),
    "utf8",
  );
  assert.match(migration, /create table public\.profiles/);
  assert.match(migration, /create table public\.locations/);
  assert.match(migration, /alter table public\.profiles enable row level security/);
  assert.match(migration, /alter table public\.locations enable row level security/);
  assert.match(migration, /create function public\.health_check/);
});

test("a separate migration creates profiles for new authentication users", async () => {
  const migration = await readFile(
    new URL("supabase/migrations/202608170002_create_profile_on_signup.sql", root),
    "utf8",
  );
  assert.match(migration, /security definer set search_path = ''/);
  assert.match(migration, /insert into public\.profiles/);
  assert.match(migration, /after insert on auth\.users/);
  assert.match(migration, /on conflict \(id\) do nothing/);
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
    "pages/auth.css",
    "responsive.css",
  ]);
  await Promise.all(imports.map((path) => readFile(new URL(`css/${path}`, root), "utf8")));
});

test("build includes every application page", async () => {
  const build = await readFile(new URL("scripts/build.mjs", root), "utf8");
  assert.match(build, /"index\.html", "login\.html", "reset-password\.html"/);
});

test("entry page has Ukrainian language and one main landmark", async () => {
  const html = await readFile(new URL("index.html", root), "utf8");
  assert.match(html, /<html lang="uk">/);
  assert.equal((html.match(/<main>/g) ?? []).length, 1);
  assert.match(html, /<meta name="viewport"/);
});
