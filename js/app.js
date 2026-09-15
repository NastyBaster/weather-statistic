import { initializeConnectionStatus } from "./connection-status.js";
import { initializeDashboardAuth } from "./dashboard-auth.js";
import { getUserLocations } from "./locations.js";
import { getUserForecasts } from "./forecasts.js";
import { initializeLocationsUI } from "./locations-ui.js";

const demoCityData = {
  kyiv: { title: "Київ · 7 серпня", actual: 24, accuracy: 64, forecasts: [30, 29, 29, 27, 26, 25, 25] },
  lviv: { title: "Львів · 7 серпня", actual: 21, accuracy: 72, forecasts: [25, 24, 24, 23, 22, 22, 21] },
};

const tableBody = document.querySelector("#forecast-table-body");
const chart = document.querySelector("#forecast-chart");
const citySelect = document.querySelector("#city-select");
const sortButton = document.querySelector("[data-sort='forecast']");
const dashboardState = document.querySelector("[data-dashboard-state]");
const modeLabel = document.querySelector("[data-dashboard-mode]");
let sortDescending = true;
let realLocations = [];
let realForecasts = [];
let currentSession = null;
let loadVersion = 0;

function signed(value) {
  if (value === 0) return "0";
  return `${value > 0 ? "+" : "−"}${Math.abs(value)}`;
}

function formatDate(value) {
  return new Date(`${value}T12:00:00Z`).toLocaleDateString("uk-UA", { day: "numeric", month: "long" });
}

function setText(selector, value) {
  const node = document.querySelector(selector);
  if (node) node.textContent = value;
}

function renderChart(values, labels, actual = null) {
  if (!values.length) { chart.replaceChildren(); return; }
  const finite = values.filter((value) => Number.isFinite(value));
  const min = Math.min(...finite, ...(actual == null ? [] : [actual]));
  const max = Math.max(...finite, ...(actual == null ? [] : [actual]));
  const scale = (value) => 55 + ((value - min) / Math.max(max - min, 1)) * 105;
  if (actual != null) chart.style.setProperty("--actual-line", `${34 + scale(actual)}px`);
  chart.replaceChildren(...values.map((value, index) => {
    const column = document.createElement("div");
    column.className = "chart__column";
    column.style.setProperty("--height", `${scale(value)}px`);
    column.innerHTML = `<span class="chart__value">${value}°</span><span class="chart__label">${labels[index]}</span>`;
    return column;
  }));
}

function renderRows(rows, actual = null) {
  const ordered = [...rows].sort((a, b) => sortDescending ? b.value - a.value : a.value - b.value);
  tableBody.replaceChildren(...ordered.map((item) => {
    const row = document.createElement("tr");
    const valueText = Number.isFinite(item.value) ? `${item.value}°C` : "—";
    const actualText = actual == null ? "—" : `${actual}°C`;
    const difference = actual == null || !Number.isFinite(item.value) ? "—" : `${signed(actual - item.value)}°`;
    row.innerHTML = `<td>${item.date}</td><td>${item.days ? `${item.days} дн.` : "—"}</td><td><strong>${valueText}</strong></td><td>${actualText}</td><td><span class="difference-pill">${difference}</span></td>`;
    return row;
  }));
}

function renderDemo() {
  citySelect.replaceChildren(
    new Option("Київ, Україна", "kyiv"),
    new Option("Львів, Україна", "lviv"),
  );
  const city = demoCityData[citySelect.value] ?? demoCityData.kyiv;
  const rows = city.forecasts.map((value, index) => ({ date: `${index + 1} серпня`, days: 7 - index, value }));
  const first = rows[0].value;
  modeLabel.textContent = "Демонстраційні дані";
  setText("[data-data-note]", "Дані на екрані демонстраційні");
  setText(".stat-card--actual p", "Було насправді");
  setText(".stat-card--actual .stat-card__note", "фактичний максимум");
  setText(".stat-card--difference p", "Помилка прогнозу");
  setText(".stat-card--difference .stat-card__note", "прогноз був завищений");
  setText(".stat-card--score p", "Точність за 7 днів");
  setText(".stat-card--score .stat-card__note", "за останні 30 днів");
  dashboardState.hidden = true;
  setText("#dashboard-title", city.title);
  setText("[data-stat='forecast']", first);
  setText("[data-stat='actual']", city.actual);
  setText("[data-stat='difference']", signed(city.actual - first));
  setText("[data-stat='accuracy']", city.accuracy);
  setText("[data-actual-label]", `${city.actual}°C`);
  renderRows(rows, city.actual);
  renderChart(rows.map(({ value }) => value), rows.map(({ days }) => `−${days} дн.`), city.actual);
}

function renderRealEmpty(message) {
  modeLabel.textContent = "Реальні дані";
  setText("[data-data-note]", "Дані завантажені з вашої колекції прогнозів");
  setText(".stat-card--actual p", "Фактична погода");
  setText(".stat-card--actual .stat-card__note", "спостереження — наступний етап");
  setText(".stat-card--difference p", "Помилка прогнозу");
  setText(".stat-card--difference .stat-card__note", "потрібні фактичні спостереження");
  setText(".stat-card--score p", "Точність");
  setText(".stat-card--score .stat-card__note", "після накопичення даних");
  dashboardState.textContent = message;
  dashboardState.hidden = false;
  tableBody.replaceChildren();
  chart.replaceChildren();
  ["forecast", "actual", "difference", "accuracy"].forEach((key) => setText(`[data-stat='${key}']`, "—"));
  setText("[data-actual-label]", "Фактичні дані з’являться на наступному етапі");
}

function renderReal() {
  if (!realLocations.length) return renderRealEmpty("Додайте активне місто, щоб почати збирати реальні прогнози.");
  const selected = realLocations.find(({ id }) => id === citySelect.value) ?? realLocations[0];
  citySelect.value = selected.id;
  const rows = realForecasts.filter(({ locationId }) => locationId === selected.id);
  if (!rows.length) return renderRealEmpty("Для цієї локації ще немає зібраних прогнозів.");
  dashboardState.hidden = true;
  modeLabel.textContent = "Реальні дані · прогноз";
  setText("[data-data-note]", "Дані завантажені з вашої колекції прогнозів");
  setText(".stat-card--actual p", "Фактична погода");
  setText(".stat-card--actual .stat-card__note", "спостереження — наступний етап");
  setText(".stat-card--difference p", "Помилка прогнозу");
  setText(".stat-card--difference .stat-card__note", "потрібні фактичні спостереження");
  setText(".stat-card--score p", "Точність");
  setText(".stat-card--score .stat-card__note", "після накопичення даних");
  const latestCollection = rows.reduce((latest, row) => !latest || row.collectedAt > latest.collectedAt ? row : latest, null);
  const latestRows = rows.filter(({ collectedAt }) => collectedAt === latestCollection.collectedAt);
  const values = latestRows.map(({ temperatureMax }) => temperatureMax).filter(Number.isFinite);
  const labels = latestRows.map(({ targetDate }) => formatDate(targetDate));
  const first = values[0];
  setText("#dashboard-title", `${selected.name} · прогноз`);
  setText("[data-stat='forecast']", Number.isFinite(first) ? first : "—");
  setText("[data-stat='actual']", "—");
  setText("[data-stat='difference']", "—");
  setText("[data-stat='accuracy']", "—");
  setText("[data-actual-label]", "Фактична погода — наступний етап");
  renderRows(latestRows.map(({ targetDate, temperatureMax }) => ({ date: formatDate(targetDate), value: temperatureMax, days: null })));
  renderChart(values, labels);
}

async function loadRealData() {
  const version = ++loadVersion;
  if (!currentSession) return renderDemo();
  dashboardState.textContent = "Завантажуємо реальні прогнози…";
  dashboardState.hidden = false;
  try {
    realLocations = (await getUserLocations()).filter(({ isActive }) => isActive);
    if (version !== loadVersion || !currentSession) return;
    citySelect.replaceChildren(...realLocations.map(({ id, name }) => new Option(name, id)));
    realForecasts = await getUserForecasts(realLocations.map(({ id }) => id));
    if (version !== loadVersion || !currentSession) return;
    renderReal();
  } catch {
    renderRealEmpty("Не вдалося завантажити реальні прогнози. Спробуйте ще раз.");
  }
}

citySelect.addEventListener("change", () => currentSession ? renderReal() : renderDemo());
sortButton.addEventListener("click", () => {
  sortDescending = !sortDescending;
  sortButton.closest("th").setAttribute("aria-sort", sortDescending ? "descending" : "ascending");
  currentSession ? renderReal() : renderDemo();
});

initializeConnectionStatus();
const locationsUI = initializeLocationsUI();
initializeDashboardAuth({
  onSessionChange: (session) => {
    currentSession = session;
    locationsUI.setSession(session);
    loadRealData();
  },
});
