import { initializeConnectionStatus } from "./connection-status.js";
import { initializeDashboardAuth } from "./dashboard-auth.js";
import { getUserLocations } from "./locations.js";
import { getUserForecasts } from "./forecasts.js";
import { getUserAccuracy, getUserAccuracyDetails } from "./accuracy.js";
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
const accuracyDashboard = document.querySelector("[data-accuracy-dashboard]");
const leadButtons = [...document.querySelectorAll("[data-lead-days]")];
let sortDescending = true;
let activeLeadDays = 1;
let realLocations = [];
let realForecasts = [];
let realAccuracy = [];
let currentSession = null;
let loadVersion = 0;

function signed(value) { return value === 0 ? "0" : `${value > 0 ? "+" : "−"}${Math.abs(value)}`; }
function formatDate(value) { return new Date(`${value}T12:00:00Z`).toLocaleDateString("uk-UA", { day: "numeric", month: "long" }); }
function setText(selector, value) { const node = document.querySelector(selector); if (node) node.textContent = value; }
function formatNumber(value, digits = 1) { return Number.isFinite(value) ? Number(value).toFixed(digits) : "—"; }
function formatPercent(value) { return Number.isFinite(value) ? `${Math.round(value * 100)}%` : "—"; }

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

function setAccuracyMetric(path, value) { const node = document.querySelector(`[data-metric="${path}"]`); if (node) node.textContent = value; }
function setAccuracyNote(path, value) { const node = document.querySelector(`[data-metric-note="${path}"]`); if (node) node.textContent = value; }

function waitMessage(sampleSize, threshold = 10) {
  if (sampleSize >= threshold) return "Оцінка вже має мінімальну кількість парних спостережень.";
  const remaining = threshold - sampleSize;
  return `Потрібно ще приблизно ${remaining} ${remaining === 1 ? "день" : "днів"} регулярних парних спостережень; якщо збір відбуватиметься щодня.`;
}

function statusLabel(metric) {
  if (metric.status === "reliable") return "Надійна оцінка · 30+ пар";
  if (metric.status === "provisional") return "Попередня оцінка · 10–29 пар";
  return waitMessage(metric.n);
}

function resetAccuracyView() {
  document.querySelectorAll("[data-metric]").forEach((node) => { node.textContent = node.dataset.metric.endsWith(".n") || node.dataset.metric.startsWith("rainEvents.") ? "0" : "—"; });
  document.querySelectorAll("[data-metric-status]").forEach((node) => { node.textContent = "—"; });
}

function renderAccuracy(selectedId) {
  const row = realAccuracy.find((item) => item.locationId === selectedId && item.leadDays === activeLeadDays);
  accuracyDashboard.hidden = false;
  resetAccuracyView();
  if (!row) {
    setText("[data-accuracy-provenance]", `Для горизонту ${activeLeadDays} ${activeLeadDays === 1 ? "дня" : "днів"} ще немає парних результатів. Потрібно дочекатися щонайменше 10 щоденних спостережень.`);
    return;
  }
  const metrics = { temperatureMin: row.temperatureMin, temperatureMax: row.temperatureMax, precipitationSum: row.precipitationSum, windSpeedMax: row.windSpeedMax };
  Object.entries(metrics).forEach(([name, metric]) => {
    setAccuracyMetric(`${name}.mae`, formatNumber(metric.mae));
    setAccuracyMetric(`${name}.bias`, formatNumber(metric.bias));
    setAccuracyMetric(`${name}.n`, metric.n);
  });
  setAccuracyMetric("rainEvents.precision", formatPercent(row.rainEvents.precision));
  setAccuracyMetric("rainEvents.recall", formatPercent(row.rainEvents.recall));
  ["tp", "fp", "fn", "tn"].forEach((key) => setAccuracyMetric(`rainEvents.${key}`, row.rainEvents[key]));
  setAccuracyNote("rainEvents.precision", row.rainEvents.precisionReason ? "ще немає прогнозованих подій" : "частка влучних прогнозів дощу");
  setAccuracyNote("rainEvents.recall", row.rainEvents.recallReason ? "ще немає фактичних подій" : "частка знайдених дощових подій");
  setText("[data-metric-status='temperature']", statusLabel(row.temperatureMax));
  setText("[data-metric-status='wind']", statusLabel(row.windSpeedMax));
  const rainStatus = row.rainEvents.status === "reliable" ? "Надійна оцінка подій" : waitMessage(row.rainEvents.n);
  setText("[data-accuracy-provenance]", `Open-Meteo · прогноз: ${row.provenance.targetDateMin ?? "—"} — ${row.provenance.targetDateMax ?? "—"} · ${row.coverage.observationRows} парних спостережень · ${rainStatus}`);
}

function renderDemo() {
  citySelect.replaceChildren(new Option("Київ, Україна", "kyiv"), new Option("Львів, Україна", "lviv"));
  const city = demoCityData[citySelect.value] ?? demoCityData.kyiv;
  const rows = city.forecasts.map((value, index) => ({ date: `${index + 1} серпня`, days: 7 - index, value }));
  const first = rows[0].value;
  modeLabel.textContent = "Демонстраційні дані";
  setText("[data-data-note]", "Дані на екрані демонстраційні");
  setText("#dashboard-title", city.title);
  setText("[data-stat='forecast']", first);
  setText("[data-stat='actual']", city.actual);
  setText("[data-stat='difference']", signed(city.actual - first));
  setText("[data-stat='accuracy']", city.accuracy);
  setText("[data-actual-label]", `${city.actual}°C`);
  dashboardState.hidden = true;
  accuracyDashboard.hidden = true;
  renderRows(rows, city.actual);
  renderChart(rows.map(({ value }) => value), rows.map(({ days }) => `−${days} дн.`), city.actual);
}

function renderRealEmpty(message) {
  modeLabel.textContent = "Реальні дані";
  setText("[data-data-note]", "Дані завантажені з вашої колекції прогнозів");
  dashboardState.textContent = message;
  dashboardState.hidden = false;
  tableBody.replaceChildren();
  chart.replaceChildren();
  ["forecast", "actual", "difference", "accuracy"].forEach((key) => setText(`[data-stat='${key}']`, "—"));
  setText("[data-actual-label]", "Фактичні дані з’являться після щоденного збору");
  accuracyDashboard.hidden = true;
}

function renderReal() {
  if (!realLocations.length) return renderRealEmpty("Додайте активне місто, щоб почати збирати реальні прогнози.");
  const selected = realLocations.find(({ id }) => id === citySelect.value) ?? realLocations[0];
  citySelect.value = selected.id;
  const rows = realForecasts.filter(({ locationId }) => locationId === selected.id);
  if (!rows.length) return renderRealEmpty("Для цієї локації ще немає зібраних прогнозів.");
  dashboardState.hidden = true;
  modeLabel.textContent = "Реальні дані · прогноз і спостереження";
  setText("[data-data-note]", "Дані завантажені з вашої колекції прогнозів");
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
  setText("[data-actual-label]", "Фактичні дані з’являться після щоденного збору");
  renderRows(latestRows.map(({ targetDate, temperatureMax }) => ({ date: formatDate(targetDate), value: temperatureMax, days: null })));
  renderChart(values, labels);
  renderAccuracy(selected.id);
}

async function loadRealData() {
  const version = ++loadVersion;
  if (!currentSession) return renderDemo();
  dashboardState.textContent = "Завантажуємо реальні прогнози та оцінку…";
  dashboardState.hidden = false;
  try {
    realLocations = (await getUserLocations()).filter(({ isActive }) => isActive);
    if (version !== loadVersion || !currentSession) return;
    citySelect.replaceChildren(...realLocations.map(({ id, name }) => new Option(name, id)));
    const locationIds = realLocations.map(({ id }) => id);
    [realForecasts, realAccuracy] = await Promise.all([
      getUserForecasts(locationIds),
      getUserAccuracy(locationIds).catch(() => []),
    ]);
    if (version !== loadVersion || !currentSession) return;
    renderReal();
  } catch {
    renderRealEmpty("Не вдалося завантажити реальні дані. Спробуйте ще раз.");
  }
}

citySelect.addEventListener("change", () => currentSession ? renderReal() : renderDemo());
sortButton.addEventListener("click", () => {
  sortDescending = !sortDescending;
  sortButton.closest("th").setAttribute("aria-sort", sortDescending ? "descending" : "ascending");
  currentSession ? renderReal() : renderDemo();
});
leadButtons.forEach((button) => button.addEventListener("click", () => {
  activeLeadDays = Number(button.dataset.leadDays);
  leadButtons.forEach((item) => item.setAttribute("aria-pressed", item === button ? "true" : "false"));
  if (currentSession) renderReal();
}));

initializeConnectionStatus();
const locationsUI = initializeLocationsUI();
initializeDashboardAuth({
  onSessionChange: (session) => {
    currentSession = session;
    locationsUI.setSession(session);
    loadRealData();
  },
});
