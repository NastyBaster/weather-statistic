import { getCurrentSession, loginUrl, onAuthStateChange, signOut } from "./auth.js";

function renderSession(session) {
  const email = document.querySelector("[data-user-email]");
  const signInLink = document.querySelector("[data-sign-in]");
  const signOutButton = document.querySelector("[data-sign-out]");
  const signedIn = Boolean(session);

  email.textContent = session?.user.email ?? "";
  email.hidden = !signedIn;
  signOutButton.hidden = !signedIn;
  signInLink.hidden = signedIn;
}

export async function initializeDashboardAuth() {
  const signOutButton = document.querySelector("[data-sign-out]");

  try {
    renderSession(await getCurrentSession());
    const { data } = await onAuthStateChange((_event, session) => renderSession(session));
    globalThis.addEventListener("pagehide", () => data.subscription.unsubscribe(), { once: true });
  } catch (error) {
    console.error("Session restoration failed", error);
    renderSession(null);
  }

  signOutButton.addEventListener("click", async () => {
    signOutButton.disabled = true;
    signOutButton.textContent = "Виходимо…";
    try {
      await signOut();
      globalThis.location.replace(loginUrl());
      return;
    } catch (error) {
      console.error("Sign out failed", error);
      signOutButton.disabled = false;
      signOutButton.textContent = "Вийти";
    }
  });
}
