import {
  dashboardUrl,
  getCurrentSession,
  requestPasswordReset,
  signIn,
  signUp,
} from "./auth.js";
import { authErrorMessage } from "./auth-error.js";
import { initializeEnvironmentBadge } from "./environment-badge.js";
import { initializePasswordVisibility } from "./password-visibility.js";

const form = document.querySelector("[data-auth-form]");
const message = document.querySelector("[data-form-message]");
const submitButton = document.querySelector("[data-submit]");
const passwordInput = form.elements.password;
let mode = "signin";

initializeEnvironmentBadge();
initializePasswordVisibility();

function showMessage(text, state = "") {
  message.textContent = text;
  message.dataset.state = state;
}

function setLoading(loading, label) {
  submitButton.disabled = loading;
  submitButton.textContent = loading ? "Зачекайте…" : label;
}

function setMode(nextMode) {
  mode = nextMode;
  const signingIn = mode === "signin";
  document.querySelector("#auth-title").textContent = signingIn ? "З поверненням" : "Створіть акаунт";
  document.querySelector("[data-auth-intro]").textContent = signingIn
    ? "Увійдіть, щоб побачити свій dashboard."
    : "Збережіть власні локації та історію перевірок.";
  passwordInput.autocomplete = signingIn ? "current-password" : "new-password";
  document.querySelector("[data-forgot-password]").hidden = !signingIn;
  document.querySelectorAll("[data-mode]").forEach((tab) => {
    const active = tab.dataset.mode === mode;
    tab.classList.toggle("auth-tab--active", active);
    tab.setAttribute("aria-selected", String(active));
  });
  showMessage("");
  setLoading(false, signingIn ? "Увійти" : "Зареєструватися");
}

document.querySelectorAll("[data-mode]").forEach((tab) => {
  tab.addEventListener("click", () => setMode(tab.dataset.mode));
});

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (!form.reportValidity()) return;
  const email = form.elements.email.value.trim();
  const password = passwordInput.value;
  setLoading(true);
  showMessage("");

  try {
    if (mode === "signin") {
      await signIn(email, password);
      globalThis.location.replace(dashboardUrl());
      return;
    }

    const { session } = await signUp(email, password);
    if (session) {
      globalThis.location.replace(dashboardUrl());
      return;
    }
    form.reset();
    showMessage("Перевірте пошту та підтвердьте реєстрацію.", "success");
  } catch (error) {
    showMessage(authErrorMessage(error), "error");
  } finally {
    setLoading(false, mode === "signin" ? "Увійти" : "Зареєструватися");
  }
});

document.querySelector("[data-forgot-password]").addEventListener("click", async () => {
  const email = form.elements.email.value.trim();
  if (!email || !form.elements.email.checkValidity()) {
    showMessage("Введіть коректний email для відновлення пароля.", "error");
    form.elements.email.focus();
    return;
  }
  setLoading(true);
  try {
    await requestPasswordReset(email);
    showMessage("Якщо акаунт існує, ми надіслали посилання для зміни пароля.", "success");
  } catch (error) {
    showMessage(authErrorMessage(error, "Не вдалося надіслати лист. Спробуйте пізніше."), "error");
  } finally {
    setLoading(false, "Увійти");
  }
});

try {
  if (await getCurrentSession()) globalThis.location.replace(dashboardUrl());
} catch (error) {
  showMessage(authErrorMessage(error, "Не вдалося підключитися до авторизації."), "error");
}
