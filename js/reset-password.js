import { dashboardUrl, getCurrentSession, updatePassword } from "./auth.js";
import { authErrorMessage, isNetworkError } from "./auth-error.js";
import { fieldError, focusFirstInvalid, showBanner, validatePassword } from "./auth-ui.js";
import { initializeEnvironmentBadge } from "./environment-badge.js";
import { initializePasswordVisibility } from "./password-visibility.js";

const form = document.querySelector("[data-reset-form]");
const message = document.querySelector("[data-form-message]");
const submitButton = document.querySelector("[data-submit]");

initializeEnvironmentBadge();
initializePasswordVisibility();

function showMessage(text, state = "") {
  showBanner(message, text, state, state === "error");
}

try {
  if (!(await getCurrentSession())) {
    showMessage("Посилання недійсне або прострочене. Запросіть нове на сторінці входу.", "error");
    submitButton.disabled = true;
  }
} catch (error) {
  showMessage(authErrorMessage(error, "Не вдалося перевірити посилання."), "error");
  submitButton.disabled = true;
}

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  const password = form.elements.password.value;
  const passwordError = validatePassword(password);
  const confirmationError = validatePassword(form.elements.confirmation.value);
  fieldError(form.elements.password, passwordError);
  fieldError(form.elements.confirmation, confirmationError);
  if (passwordError || confirmationError) {
    focusFirstInvalid(form);
    return;
  }
  if (password !== form.elements.confirmation.value) {
    fieldError(form.elements.confirmation, "Паролі не збігаються.");
    focusFirstInvalid(form);
    return;
  }

  submitButton.disabled = true;
  submitButton.textContent = "Зберігаємо…";
  try {
    await updatePassword(password);
    showMessage("Пароль оновлено. Переходимо до dashboard…", "success");
    globalThis.setTimeout(() => globalThis.location.replace(dashboardUrl()), 900);
  } catch (error) {
    showBanner(message, authErrorMessage(error, "Не вдалося оновити пароль."), "error", isNetworkError(error));
    submitButton.disabled = false;
    submitButton.textContent = "Зберегти пароль";
  }
});

form.querySelectorAll("input").forEach((input) => input.addEventListener("input", () => {
  if (input.getAttribute("aria-invalid") === "true") fieldError(input, validatePassword(input.value));
}));

message.querySelector("[data-retry]").addEventListener("click", () => {
  showMessage("");
  submitButton.disabled = false;
  submitButton.focus();
});
