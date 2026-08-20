export function validateEmail(value) {
  const email = value.trim();
  if (!email) return "Введіть email.";
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return "Введіть коректний email, наприклад name@example.com.";
  return "";
}

export function validatePassword(value) {
  if (!value) return "Введіть пароль.";
  if (value.length < 8) return "Пароль має містити щонайменше 8 символів.";
  return "";
}

export function fieldError(input, text) {
  const error = document.querySelector(`#${input.getAttribute("aria-describedby")}`);
  input.setAttribute("aria-invalid", String(Boolean(text)));
  error.textContent = text;
  input.closest("[data-field]")?.classList.toggle("field--invalid", Boolean(text));
  return !text;
}

export function focusFirstInvalid(form) {
  const first = form.querySelector('[aria-invalid="true"]');
  if (!first) return;
  first.focus({ preventScroll: true });
  first.scrollIntoView({ behavior: "smooth", block: "center" });
}

export function validateCredentials(form) {
  const emailValid = fieldError(form.elements.email, validateEmail(form.elements.email.value));
  const passwordValid = fieldError(form.elements.password, validatePassword(form.elements.password.value));
  if (!emailValid || !passwordValid) focusFirstInvalid(form);
  return emailValid && passwordValid;
}

export function showBanner(element, text, state = "", retry = false) {
  element.dataset.state = state;
  element.hidden = !text;
  element.querySelector("[data-message-text]").textContent = text;
  element.querySelector("[data-retry]").hidden = !retry;
  if (text) element.scrollIntoView({ behavior: "smooth", block: "nearest" });
}
