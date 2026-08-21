import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { CITY_CATALOG } from "../js/city-catalog.js";
import { createLocationsRepository, mapLocationError } from "../js/locations.js";
import { getLocationViewState } from "../js/locations-ui.js";

function queryResult(data = null) {
  const calls = [];
  const query = {
    calls,
    select(...args) { calls.push(["select", ...args]); return this; },
    insert(...args) { calls.push(["insert", ...args]); return this; },
    update(...args) { calls.push(["update", ...args]); return this; },
    delete(...args) { calls.push(["delete", ...args]); return this; },
    eq(...args) { calls.push(["eq", ...args]); return this; },
    order(...args) { calls.push(["order", ...args]); return Promise.resolve({ data, error: null }); },
    single() { calls.push(["single"]); return Promise.resolve({ data, error: null }); },
    then(resolve) { return Promise.resolve({ data, error: null }).then(resolve); },
  };
  return query;
}

function setup(data) {
  const query = queryResult(data);
  const client = {
    auth: { getUser: async () => ({ data: { user: { id: "user-a" } }, error: null }) },
    from(table) { assert.equal(table, "locations"); return query; },
  };
  return { query, repository: createLocationsRepository(async () => client) };
}

const row = { id: "one", name: "Київ", country_code: "UA", latitude: 50.4501, longitude: 30.5234, timezone: "Europe/Kyiv", is_active: true };

test("select is scoped to the authenticated user and sorted", async () => {
  const { query, repository } = setup([row]);
  assert.equal((await repository.getUserLocations())[0].countryCode, "UA");
  assert.deepEqual(query.calls.filter(([name]) => name === "eq"), [["eq", "user_id", "user-a"]]);
  assert.ok(query.calls.some(([name, field]) => name === "order" && field === "name"));
});

test("insert derives user_id from Auth rather than location input", async () => {
  const { query, repository } = setup(row);
  await repository.createLocation({ ...CITY_CATALOG[0], user_id: "attacker" });
  const payload = query.calls.find(([name]) => name === "insert")[1];
  assert.equal(payload.user_id, "user-a");
  assert.equal(payload.country_code, "UA");
});

test("update and delete include both record and authenticated user filters", async () => {
  let setupResult = setup({ ...row, is_active: false });
  await setupResult.repository.setLocationActive("one", false);
  assert.ok(setupResult.query.calls.some(([name, payload]) => name === "update" && payload.is_active === false));
  assert.deepEqual(setupResult.query.calls.filter(([name]) => name === "eq"), [["eq", "id", "one"], ["eq", "user_id", "user-a"]]);
  setupResult = setup(null);
  await setupResult.repository.deleteLocation("one");
  assert.ok(setupResult.query.calls.some(([name]) => name === "delete"));
  assert.deepEqual(setupResult.query.calls.filter(([name]) => name === "eq"), [["eq", "id", "one"], ["eq", "user_id", "user-a"]]);
});

test("database duplicate is mapped to a localized message", () => {
  assert.equal(mapLocationError({ code: "23505" }).message, "Це місто вже є у вашому списку.");
});

test("view state distinguishes guest, loading, empty, retry error, and ready", () => {
  const base = { session: { user: { id: "a" } }, locations: [], loading: false, error: null };
  assert.equal(getLocationViewState({ ...base, session: null }), "guest");
  assert.equal(getLocationViewState({ ...base, loading: true }), "loading");
  assert.equal(getLocationViewState(base), "empty");
  assert.equal(getLocationViewState({ ...base, error: new Error() }), "error");
  assert.equal(getLocationViewState({ ...base, locations: [row] }), "ready");
});

test("catalog has stable valid Ukrainian city metadata", () => {
  assert.ok(CITY_CATALOG.length >= 12);
  assert.equal(new Set(CITY_CATALOG.map(({ id }) => id)).size, CITY_CATALOG.length);
  for (const city of CITY_CATALOG) {
    assert.equal(city.countryCode, "UA");
    assert.ok(city.latitude >= -90 && city.latitude <= 90);
    assert.ok(city.longitude >= -180 && city.longitude <= 180);
    assert.match(city.timezone, /^[A-Za-z_]+\/[A-Za-z_]+$/);
  }
});

test("dashboard exposes accessible location hooks and auth owns the only subscription", async () => {
  const root = new URL("../", import.meta.url);
  const html = await readFile(new URL("index.html", root), "utf8");
  const auth = await readFile(new URL("js/dashboard-auth.js", root), "utf8");
  const ui = await readFile(new URL("js/locations-ui.js", root), "utf8");
  assert.match(html, /data-locations/);
  assert.match(html, /aria-busy="false"/);
  assert.match(html, /aria-live="polite"/);
  assert.match(html, /<label for="location-city">/);
  assert.match(html, /Увійти, щоб зберігати міста/);
  assert.match(auth, /onSessionChange\(nextSession\)/);
  assert.match(ui, /locations = \[\]/);
  assert.doesNotMatch(ui, /onAuthStateChange/);
});
