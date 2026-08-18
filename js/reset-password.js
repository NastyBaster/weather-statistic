import { dashboardUrl, getCurrentSession, updatePassword } from "./auth.js";
import { authErrorMessage } from "./auth-error.js";
import { initializeEnvironmentBadge } from "./environment-badge.js";
import { initializePasswordVisibility } from "./password-visibility.js";

const form = document.querySelector("[data-reset-form]");
const message = document.querySelector("[data-form-message]");
const submitButton = document.querySelector("[data-submit]");

initializeEnvironmentBadge();
initializePasswordVisibility();

function showMessage(text, state = "") {
  message.textContent = text;
  message.dataset.state = state;
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
  if (!form.reportValidity()) return;
  const password = form.elements.password.value;
  if (password !== form.elements.confirmation.value) {
    showMessage("Паролі не збігаються.", "error");
    return;
  }

  submitButton.disabled = true;
  submitButton.textContent = "Зберігаємо…";
  try {
    await updatePassword(password);
    showMessage("Пароль оновлено. Переходимо до dashboard…", "success");
    globalThis.setTimeout(() => globalThis.location.replace(dashboardUrl()), 900);
  } catch (error) {
    showMessage(authErrorMessage(error, "Не вдалося оновити пароль."), "error");
    submitButton.disabled = false;
    submitButton.textContent = "Зберегти пароль";
  }
});
