import {
  dashboardUrl,
  getCurrentSession,
  requestPasswordReset,
  signIn,
  signInWithGoogle,
  signUp,
} from "./auth.js";
import { authErrorMessage, isNetworkError } from "./auth-error.js";
import { fieldError, showBanner, validateCredentials, validateEmail } from "./auth-ui.js";
import { initializeEnvironmentBadge } from "./environment-badge.js";
import { initializePasswordVisibility } from "./password-visibility.js";

const form = document.querySelector("[data-auth-form]");
const message = document.querySelector("[data-form-message]");
const submitButton = document.querySelector("[data-submit]");
const googleButton = document.querySelector("[data-google-sign-in]");
const passwordInput = form.elements.password;
const tabs = document.querySelector(".auth-tabs");
const forgotPasswordButton = document.querySelector("[data-forgot-password]");
const confirmation = document.querySelector("[data-signup-confirmation]");
let mode = "signin";

initializeEnvironmentBadge();
initializePasswordVisibility();

function showMessage(text, state = "") {
  showBanner(message, text, state, state === "error");
}

function setLoading(loading, label) {
  submitButton.disabled = loading;
  submitButton.textContent = loading ? "Зачекайте…" : label;
}

function setGoogleLoading(loading) {
  googleButton.disabled = loading;
  googleButton.querySelector("[data-google-label]").textContent = loading
    ? "Переходимо до Google…"
    : "Продовжити з Google";
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
  form.querySelectorAll("input").forEach((input) => fieldError(input, ""));
  setLoading(false, signingIn ? "Увійти" : "Зареєструватися");
}

function showSignupConfirmation(email) {
  form.hidden = true;
  tabs.hidden = true;
  forgotPasswordButton.hidden = true;
  showMessage("");
  document.querySelector("[data-auth-intro]").hidden = true;
  confirmation.querySelector("[data-signup-email]").textContent = email;
  confirmation.hidden = false;
  confirmation.focus({ preventScroll: true });
  confirmation.scrollIntoView({ behavior: "smooth", block: "center" });
}

function editSignupEmail() {
  confirmation.hidden = true;
  form.hidden = false;
  tabs.hidden = false;
  document.querySelector("[data-auth-intro]").hidden = false;
  form.elements.email.value = confirmation.querySelector("[data-signup-email]").textContent;
  form.elements.password.value = "";
  setMode("signup");
  form.elements.email.focus();
}

document.querySelectorAll("[data-mode]").forEach((tab) => {
  tab.addEventListener("click", () => setMode(tab.dataset.mode));
});

googleButton.addEventListener("click", async () => {
  setGoogleLoading(true);
  showMessage("");

  try {
    await signInWithGoogle();
  } catch (error) {
    setGoogleLoading(false);
    showMessage(authErrorMessage(error, "Не вдалося розпочати вхід через Google."), "error");
  }
});

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (!validateCredentials(form)) return;
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
    showSignupConfirmation(email);
  } catch (error) {
    showBanner(message, authErrorMessage(error), "error", isNetworkError(error));
  } finally {
    setLoading(false, mode === "signin" ? "Увійти" : "Зареєструватися");
  }
});

forgotPasswordButton.addEventListener("click", async () => {
  const email = form.elements.email.value.trim();
  const emailError = validateEmail(email);
  if (!fieldError(form.elements.email, emailError)) {
    form.elements.email.focus({ preventScroll: true });
    form.elements.email.scrollIntoView({ behavior: "smooth", block: "center" });
    return;
  }
  setLoading(true);
  try {
    await requestPasswordReset(email);
    showMessage(`Якщо акаунт ${email} існує, лист уже в дорозі. Перевірте Inbox і Spam.`, "success");
  } catch (error) {
    showMessage(authErrorMessage(error, "Не вдалося надіслати лист. Спробуйте пізніше."), "error");
  } finally {
    setLoading(false, "Увійти");
  }
});

document.querySelector("[data-change-signup-email]").addEventListener("click", editSignupEmail);

form.querySelectorAll("input").forEach((input) => input.addEventListener("input", () => {
  if (input.getAttribute("aria-invalid") === "true") {
    fieldError(input, input.name === "email" ? validateEmail(input.value) : "");
  }
}));

message.querySelector("[data-retry]").addEventListener("click", () => {
  showMessage("");
  submitButton.focus();
});

try {
  if (await getCurrentSession()) globalThis.location.replace(dashboardUrl());
} catch (error) {
  showMessage(authErrorMessage(error, "Не вдалося підключитися до авторизації."), "error");
}
