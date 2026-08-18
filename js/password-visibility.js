export function initializePasswordVisibility() {
  document.querySelectorAll("[data-password-toggle]").forEach((button) => {
    const input = button.closest(".password-field").querySelector("input");
    button.addEventListener("click", () => {
      const visible = input.type === "password";
      input.type = visible ? "text" : "password";
      button.querySelector(".password-icon--show").hidden = visible;
      button.querySelector(".password-icon--hide").hidden = !visible;
      button.setAttribute("aria-pressed", String(visible));
      button.setAttribute("aria-label", visible ? "Приховати пароль" : "Показати пароль");
    });
  });
}
