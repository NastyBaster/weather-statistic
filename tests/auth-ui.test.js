import assert from "node:assert/strict";
import test from "node:test";

import { validateEmail, validatePassword } from "../js/auth-ui.js";

test("email field states have localized validation messages", () => {
  assert.equal(validateEmail(""), "Введіть email.");
  assert.match(validateEmail("not-an-email"), /коректний email/);
  assert.equal(validateEmail(" user@example.com "), "");
});

test("password field states enforce the eight character minimum", () => {
  assert.equal(validatePassword(""), "Введіть пароль.");
  assert.match(validatePassword("short"), /8 символів/);
  assert.equal(validatePassword("long-enough"), "");
});

test("authentication markup exposes accessible errors and retry UI", async () => {
  const { readFile } = await import("node:fs/promises");
  for (const page of ["login.html", "reset-password.html"]) {
    const html = await readFile(new URL(`../${page}`, import.meta.url), "utf8");
    assert.match(html, /aria-invalid="false"/);
    assert.match(html, /aria-describedby=/);
    assert.match(html, /data-message-text/);
    assert.match(html, /data-retry/);
  }
});

test("signup confirmation prominently shows recipient and mailbox guidance", async () => {
  const { readFile } = await import("node:fs/promises");
  const html = await readFile(new URL("../login.html", import.meta.url), "utf8");
  const script = await readFile(new URL("../js/auth-page.js", import.meta.url), "utf8");
  assert.match(html, /data-signup-confirmation/);
  assert.match(html, /data-signup-email/);
  assert.match(html, /Inbox/);
  assert.match(html, /Spam/);
  assert.match(script, /showSignupConfirmation\(email\)/);
});
