export const CITY_CATALOG = Object.freeze([
  { id: "kyiv", name: "Київ", countryCode: "UA", latitude: 50.4501, longitude: 30.5234, timezone: "Europe/Kyiv" },
  { id: "lviv", name: "Львів", countryCode: "UA", latitude: 49.8397, longitude: 24.0297, timezone: "Europe/Kyiv" },
  { id: "kharkiv", name: "Харків", countryCode: "UA", latitude: 49.9935, longitude: 36.2304, timezone: "Europe/Kyiv" },
  { id: "odesa", name: "Одеса", countryCode: "UA", latitude: 46.4825, longitude: 30.7233, timezone: "Europe/Kyiv" },
  { id: "dnipro", name: "Дніпро", countryCode: "UA", latitude: 48.4647, longitude: 35.0462, timezone: "Europe/Kyiv" },
  { id: "zaporizhzhia", name: "Запоріжжя", countryCode: "UA", latitude: 47.8388, longitude: 35.1396, timezone: "Europe/Kyiv" },
  { id: "vinnytsia", name: "Вінниця", countryCode: "UA", latitude: 49.2331, longitude: 28.4682, timezone: "Europe/Kyiv" },
  { id: "poltava", name: "Полтава", countryCode: "UA", latitude: 49.5883, longitude: 34.5514, timezone: "Europe/Kyiv" },
  { id: "chernihiv", name: "Чернігів", countryCode: "UA", latitude: 51.4982, longitude: 31.2893, timezone: "Europe/Kyiv" },
  { id: "ivano-frankivsk", name: "Івано-Франківськ", countryCode: "UA", latitude: 48.9226, longitude: 24.7111, timezone: "Europe/Kyiv" },
  { id: "uzhhorod", name: "Ужгород", countryCode: "UA", latitude: 48.6208, longitude: 22.2879, timezone: "Europe/Kyiv" },
  { id: "chernivtsi", name: "Чернівці", countryCode: "UA", latitude: 48.2915, longitude: 25.9403, timezone: "Europe/Kyiv" },
]);

export function findCatalogCity(id) {
  return CITY_CATALOG.find((city) => city.id === id) ?? null;
}
