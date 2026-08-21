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

export async function initializeDashboardAuth({ onSessionChange = () => {} } = {}) {
  const signOutButton = document.querySelector("[data-sign-out]");

  try {
    const session = await getCurrentSession();
    renderSession(session);
    onSessionChange(session);
    const { data } = await onAuthStateChange((_event, nextSession) => {
      renderSession(nextSession);
      onSessionChange(nextSession);
    });
    globalThis.addEventListener("pagehide", () => data.subscription.unsubscribe(), { once: true });
  } catch (error) {
    console.error("Session restoration failed", error);
    renderSession(null);
    onSessionChange(null);
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
