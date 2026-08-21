import { CITY_CATALOG, findCatalogCity } from "./city-catalog.js";
import { createLocation, deleteLocation, getUserLocations, setLocationActive } from "./locations.js";

export function getLocationViewState({ session, loading, error, locations }) {
  if (!session) return "guest";
  if (loading && locations.length === 0) return "loading";
  if (error && locations.length === 0) return "error";
  if (locations.length === 0) return "empty";
  return "ready";
}

export function initializeLocationsUI(repository = { createLocation, deleteLocation, getUserLocations, setLocationActive }) {
  const root = document.querySelector("[data-locations]");
  const guest = root.querySelector("[data-locations-guest]");
  const personal = root.querySelector("[data-locations-personal]");
  const list = root.querySelector("[data-locations-list]");
  const stateMessage = root.querySelector("[data-locations-state]");
  const notice = root.querySelector("[data-locations-notice]");
  const form = root.querySelector("[data-location-form]");
  const select = root.querySelector("[data-city-catalog]");
  const submit = form.querySelector("button[type='submit']");
  const openButtons = root.querySelectorAll("[data-open-location-form]");
  const headingOpenButton = root.querySelector(".section-heading [data-open-location-form]");
  const cancel = root.querySelector("[data-cancel-location-form]");
  let session = null;
  let locations = [];
  let loading = false;
  let error = null;
  let requestVersion = 0;
  let returnFocus = null;

  function announce(text, type = "success") {
    notice.textContent = text;
    notice.dataset.type = type;
    notice.hidden = !text;
    if (type === "error") notice.focus();
  }

  function renderOptions() {
    const used = new Set(locations.map(({ latitude, longitude }) => `${latitude}:${longitude}`));
    const available = CITY_CATALOG.filter((city) => !used.has(`${city.latitude}:${city.longitude}`));
    select.replaceChildren(new Option("Оберіть місто", ""), ...available.map((city) => new Option(`${city.name}, UA`, city.id)));
    submit.disabled = available.length === 0;
  }

  function makeLocationItem(location) {
    const item = document.createElement("li");
    item.className = "location-item";
    const info = document.createElement("div");
    const name = document.createElement("strong");
    name.textContent = `${location.name}, ${location.countryCode}`;
    const status = document.createElement("span");
    status.className = `location-status ${location.isActive ? "location-status--active" : ""}`;
    status.textContent = location.isActive ? "Активне" : "Призупинено";
    info.append(name, status);
    const actions = document.createElement("div");
    actions.className = "location-actions";
    const toggle = document.createElement("button");
    toggle.type = "button";
    toggle.className = "button button--secondary";
    toggle.textContent = location.isActive ? "Призупинити" : "Активувати";
    toggle.addEventListener("click", () => mutate(toggle, async () => {
      const updated = await repository.setLocationActive(location.id, !location.isActive);
      locations = locations.map((entry) => entry.id === updated.id ? updated : entry);
      announce(updated.isActive ? "Місто активовано." : "Збір для міста призупинено.");
    }));
    const remove = document.createElement("button");
    remove.type = "button";
    remove.className = "button button--danger";
    remove.textContent = "Видалити";
    remove.addEventListener("click", () => {
      if (!globalThis.confirm(`Видалити місто «${location.name}»?`)) return;
      mutate(remove, async () => {
        await repository.deleteLocation(location.id);
        locations = locations.filter(({ id }) => id !== location.id);
        announce("Місто видалено.");
      });
    });
    actions.append(toggle, remove);
    item.append(info, actions);
    return item;
  }

  function render() {
    const state = getLocationViewState({ session, loading, error, locations });
    guest.hidden = state !== "guest";
    personal.hidden = state === "guest";
    headingOpenButton.hidden = state === "guest";
    personal.setAttribute("aria-busy", String(state === "loading"));
    list.replaceChildren(...locations.map(makeLocationItem));
    list.hidden = locations.length === 0;
    stateMessage.hidden = state === "ready";
    stateMessage.replaceChildren();
    const messages = { loading: "Завантажуємо ваші міста…", empty: "У вас ще немає збережених міст.", error: "Не вдалося завантажити міста." };
    if (messages[state]) stateMessage.append(document.createTextNode(messages[state]));
    if (state === "empty") stateMessage.append(makeStateButton("Додати перше місто", openForm));
    if (state === "error") stateMessage.append(makeStateButton("Спробувати ще раз", load));
    renderOptions();
  }

  function makeStateButton(label, handler) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "button button--primary";
    button.textContent = label;
    button.addEventListener("click", handler);
    return button;
  }

  async function mutate(button, operation) {
    button.disabled = true;
    announce("");
    try { await operation(); } catch (caught) { announce(caught.message || "Не вдалося виконати дію. Спробуйте ще раз.", "error"); }
    finally { render(); if (button.isConnected) button.disabled = false; }
  }

  async function load() {
    if (!session) return;
    const version = ++requestVersion;
    loading = true;
    error = null;
    render();
    try {
      const result = await repository.getUserLocations();
      if (version !== requestVersion || !session) return;
      locations = result;
    } catch (caught) {
      if (version !== requestVersion) return;
      error = caught;
    } finally {
      if (version === requestVersion) { loading = false; render(); }
    }
  }

  function openForm(event) {
    returnFocus = event?.currentTarget ?? document.activeElement;
    form.hidden = false;
    select.focus();
  }
  function closeForm() {
    form.hidden = true;
    form.reset();
    returnFocus?.focus();
  }
  openButtons.forEach((button) => button.addEventListener("click", openForm));
  cancel.addEventListener("click", closeForm);
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const city = findCatalogCity(select.value);
    if (!city) { announce("Оберіть місто зі списку.", "error"); select.focus(); return; }
    submit.disabled = true;
    announce("");
    try {
      const created = await repository.createLocation(city);
      locations = [...locations, created].sort((a, b) => a.name.localeCompare(b.name, "uk"));
      closeForm();
      announce("Місто додано.");
    } catch (caught) {
      announce(caught.message || "Не вдалося додати місто. Спробуйте ще раз.", "error");
      select.focus();
    } finally { submit.disabled = false; render(); }
  });

  render();
  return {
    setSession(nextSession) {
      if (session?.user?.id && session.user.id === nextSession?.user?.id) return;
      requestVersion += 1;
      session = nextSession;
      locations = [];
      error = null;
      loading = false;
      closeForm();
      announce("");
      render();
      if (session) load();
    },
  };
}
