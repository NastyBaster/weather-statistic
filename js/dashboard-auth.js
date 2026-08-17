import { getCurrentSession, loginUrl, onAuthStateChange, signOut } from "./auth.js";

function redirectToLogin() {
  globalThis.location.replace(loginUrl());
}

export async function protectDashboard() {
  const loader = document.querySelector("[data-auth-loader]");
  const content = document.querySelector("[data-protected-content]");
  const email = document.querySelector("[data-user-email]");
  const signOutButton = document.querySelector("[data-sign-out]");

  try {
    const session = await getCurrentSession();
    if (!session) {
      redirectToLogin();
      return false;
    }

    email.textContent = session.user.email ?? "Користувач";
    content.hidden = false;
    loader.hidden = true;
    document.body.classList.remove("auth-pending");

    const { data } = await onAuthStateChange((event) => {
      if (event === "SIGNED_OUT") redirectToLogin();
    });
    globalThis.addEventListener("pagehide", () => data.subscription.unsubscribe(), { once: true });

    signOutButton.addEventListener("click", async () => {
      signOutButton.disabled = true;
      signOutButton.textContent = "Виходимо…";
      try {
        await signOut();
        redirectToLogin();
      } catch (error) {
        console.error("Sign out failed", error);
        signOutButton.disabled = false;
        signOutButton.textContent = "Вийти";
      }
    });
    return true;
  } catch (error) {
    console.error("Session restoration failed", error);
    loader.querySelector("span:last-child").textContent = "Не вдалося перевірити сесію";
    return false;
  }
}
