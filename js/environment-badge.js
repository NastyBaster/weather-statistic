import { appConfig } from "./config.js";

const environments = {
  development: {
    label: "Тестовий сайт · development",
    state: "development",
  },
  production: {
    label: "Основний сайт · production",
    state: "production",
  },
  local: {
    label: "Локальний сайт · local",
    state: "local",
  },
};

export function initializeEnvironmentBadge() {
  const badge = document.querySelector("[data-environment-badge]");
  if (!badge) return;

  const environment = environments[appConfig.environment] ?? {
    label: `Середовище · ${appConfig.environment}`,
    state: "unknown",
  };
  badge.textContent = environment.label;
  badge.dataset.environment = environment.state;
}
