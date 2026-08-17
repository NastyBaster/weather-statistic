const cityData = {
  kyiv: {
    title: "Київ · 7 серпня",
    actual: 24,
    accuracy: 64,
    forecasts: [
      { date: "1 серпня", days: 7, value: 30 },
      { date: "2 серпня", days: 6, value: 29 },
      { date: "3 серпня", days: 5, value: 29 },
      { date: "4 серпня", days: 4, value: 27 },
      { date: "5 серпня", days: 3, value: 26 },
      { date: "6 серпня", days: 2, value: 25 },
      { date: "7 серпня", days: 1, value: 25 },
    ],
  },
  lviv: {
    title: "Львів · 7 серпня",
    actual: 21,
    accuracy: 72,
    forecasts: [
      { date: "1 серпня", days: 7, value: 25 },
      { date: "2 серпня", days: 6, value: 24 },
      { date: "3 серпня", days: 5, value: 24 },
      { date: "4 серпня", days: 4, value: 23 },
      { date: "5 серпня", days: 3, value: 22 },
      { date: "6 серпня", days: 2, value: 22 },
      { date: "7 серпня", days: 1, value: 21 },
    ],
  },
};

const tableBody = document.querySelector("#forecast-table-body");
const chart = document.querySelector("#forecast-chart");
const citySelect = document.querySelector("#city-select");
const sortButton = document.querySelector("[data-sort='forecast']");
let sortDescending = true;

function signed(value) {
  if (value === 0) return "0";
  return `${value > 0 ? "+" : "−"}${Math.abs(value)}`;
}

function render() {
  const city = cityData[citySelect.value];
  const firstForecast = city.forecasts[0].value;
  const difference = city.actual - firstForecast;
  const orderedForecasts = [...city.forecasts].sort((a, b) =>
    sortDescending ? b.value - a.value : a.value - b.value,
  );

  document.querySelector("#dashboard-title").textContent = city.title;
  document.querySelector("[data-stat='forecast']").textContent = firstForecast;
  document.querySelector("[data-stat='actual']").textContent = city.actual;
  document.querySelector("[data-stat='difference']").textContent = signed(difference);
  document.querySelector("[data-stat='accuracy']").textContent = city.accuracy;
  document.querySelector("[data-actual-label]").textContent = `${city.actual}°C`;

  tableBody.replaceChildren(
    ...orderedForecasts.map((item) => {
      const row = document.createElement("tr");
      row.innerHTML = `
        <td>${item.date}</td>
        <td>${item.days} ${item.days === 1 ? "день" : "днів"}</td>
        <td><strong>${item.value}°C</strong></td>
        <td>${city.actual}°C</td>
        <td><span class="difference-pill">${signed(city.actual - item.value)}°</span></td>
      `;
      return row;
    }),
  );

  const min = Math.min(city.actual - 1, ...city.forecasts.map(({ value }) => value));
  const max = Math.max(...city.forecasts.map(({ value }) => value));
  const scale = (value) => 55 + ((value - min) / Math.max(max - min, 1)) * 105;
  chart.style.setProperty("--actual-line", `${34 + scale(city.actual)}px`);
  chart.replaceChildren(
    ...city.forecasts.map((item) => {
      const column = document.createElement("div");
      column.className = "chart__column";
      column.style.setProperty("--height", `${scale(item.value)}px`);
      column.innerHTML = `<span class="chart__value">${item.value}°</span><span class="chart__label">−${item.days} дн.</span>`;
      return column;
    }),
  );
}

citySelect.addEventListener("change", render);
sortButton.addEventListener("click", () => {
  sortDescending = !sortDescending;
  sortButton.closest("th").setAttribute("aria-sort", sortDescending ? "descending" : "ascending");
  render();
});

render();
