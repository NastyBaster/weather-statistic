import assert from "node:assert/strict";
import test from "node:test";

import { authErrorMessage, isNetworkError } from "../js/auth-error.js";

test("maps common Supabase authentication errors to Ukrainian", () => {
  assert.equal(authErrorMessage(new Error("Invalid login credentials")), "Неправильний email або пароль.");
  assert.match(authErrorMessage(new Error("Email not confirmed")), /Inbox і Spam/);
  assert.match(authErrorMessage(new Error("User already registered")), /уже зареєстрований/);
});

test("recognizes browser and WebView network errors", () => {
  for (const message of ["Failed to fetch", "Load failed", "Network request failed", "The Internet connection appears to be offline"]) {
    assert.equal(isNetworkError(new Error(message)), true);
    assert.match(authErrorMessage(new Error(message)), /Telegram WebView/);
  }
  assert.equal(isNetworkError(new Error("Invalid login credentials")), false);
});
