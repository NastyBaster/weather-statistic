# Forecast data contract (ADR 005)

Status: **accepted for the 5.0 MVP schema** (2026-08-21). Collector code, HTTP calls, scheduling, observations, and accuracy calculations are deliberately deferred.

## Provider decision

The selected provider is **Open-Meteo Forecast API**. The decision was checked against the provider's official [Forecast API reference](https://open-meteo.com/en/docs), [pricing](https://open-meteo.com/en/pricing), [terms](https://open-meteo.com/en/terms), and [licence page](https://open-meteo.com/en/licence). It offers the required daily variables and canonical units, accepts an IANA timezone, and does not require a key for the documented open-access, non-commercial API.

The forecast endpoint is `GET https://api.open-meteo.com/v1/forecast`. Latitude and longitude are required. Requesting `daily` values also requires `timezone`. `timezone=auto` resolves a timezone from the coordinates; nevertheless, the adapter will pass the stored `locations.timezone` IANA identifier so the provider's day boundary and our `collection_date` use the same explicit zone. The API uses ISO-8601 dates and supports `forecast_days` from 1 through 16 (7 by default), or an explicit `start_date`/`end_date` range.

The open endpoint has no API key. Open-Meteo's published open-access limits are 600 calls/minute, 5,000/hour, 10,000/day, and 300,000/month. Its free/open-access API is for non-commercial use. Commercial production use requires an appropriate paid plan and the customer endpoint (`https://customer-api.open-meteo.com/v1/forecast`) with `apikey`; the plan and current terms must be rechecked before commercial launch. Weather data is attributed to Open-Meteo and the upstream national providers under the licences listed by Open-Meteo; UI/export work must display the required attribution and link. The repository does not embed a key.

Known limitations and metadata:

- forecast availability depends on upstream models, geography, variable, and model update;
- the response includes `latitude`, `longitude`, `elevation`, `generationtime_ms`, `utc_offset_seconds`, `timezone`, `timezone_abbreviation`, `daily_units`, and `daily` arrays;
- `generationtime_ms` is server response-generation duration, **not** a forecast model issuance timestamp;
- the general Forecast API response contract does not provide a provider-issued timestamp. Therefore the schema deliberately uses `collected_at`: the instant our system successfully received and accepted the response. It must never be described as model issuance time;
- documented errors use an HTTP error status and a JSON object shaped as `{ "error": true, "reason": "..." }`. `reason` is diagnostic input, not a stable application category and must be sanitized before persistence;
- the collector must treat HTTP 429 as throttling and obey any `Retry-After` response. The bounded retry policy below is our contract, not a claim that provider docs prescribe its exact timings.

## Provider request and adapter boundary

The future server-side adapter accepts this normalized request:

| Field | Contract |
| --- | --- |
| `latitude`, `longitude` | finite coordinates copied from the location |
| `timezone` | explicit IANA name from `locations.timezone` |
| `forecastDays` | integer 1–16; MVP expects enough days for horizons 0–7 |
| `dailyVariables` | the fixed list below |
| `temperatureUnit` | `celsius` |
| `precipitationUnit` | `mm` |
| `windSpeedUnit` | `kmh` |

It maps these to `latitude`, `longitude`, `timezone`, `forecast_days`, `daily`, `temperature_unit=celsius`, `precipitation_unit=mm`, and `wind_speed_unit=kmh`. The requested daily variables are `temperature_2m_min`, `temperature_2m_max`, `precipitation_sum`, `precipitation_probability_max`, `wind_speed_10m_max`, and `weather_code`. Open-Meteo documents temperature in °C by default, precipitation sum in mm, probability as %, wind-speed selection including km/h, and WMO weather interpretation codes.

No browser module uses provider field names or calls the endpoint. The future adapter must validate equal-length daily arrays, metadata/units, date strings, finite numbers, and nullable values, then return provider-independent records:

```js
{
  targetDate,
  temperatureMin,
  temperatureMax,
  precipitationSum,
  precipitationProbability,
  windSpeedMax,
  weatherCode
}
```

| Field | Stored type/unit | Nullability and valid range |
| --- | --- | --- |
| `targetDate` | ISO `YYYY-MM-DD` → PostgreSQL `date` | required; collection date through collection date + 16 |
| `temperatureMin` | double precision, °C | nullable; −150 through 100 |
| `temperatureMax` | double precision, °C | nullable; −150 through 100; min ≤ max when both exist |
| `precipitationSum` | double precision, mm | nullable; ≥ 0 |
| `precipitationProbability` | integer percentage | nullable; 0–100; adapter rejects a non-integral provider value rather than silently rounding |
| `windSpeedMax` | double precision, km/h | nullable; ≥ 0 |
| `weatherCode` | integer WMO code | nullable; 0–99 |

At least one forecast value must exist. Missing provider values map to SQL `null`; missing or malformed dates invalidate that location response. Numeric temperature, precipitation, and wind values are stored without presentation rounding. UI formatting is separate. This intentionally uses generous technical bounds rather than narrow climatological assumptions.

## Time and date semantics

- `forecast_runs.started_at` and `completed_at` are UTC instants (`timestamptz`). A running row has no completion time; every terminal row does.
- `forecast_snapshots.collected_at` is the UTC instant at which our adapter successfully received and validated a response. It is not an Open-Meteo issue/model-run timestamp.
- `collection_date` is the calendar date of `collected_at` in that specific location's stored IANA timezone. The collector must compute it explicitly; it must not cast the UTC instant directly to `date`.
- `target_date` is the local calendar day represented by the provider's daily value in the requested timezone.
- PostgreSQL generates `lead_days = target_date - collection_date`. Zero means a same-local-day forecast; one means the next local calendar day.

For example, `2026-08-21T23:30:00Z` is already `2026-08-22` in `Europe/Kyiv`, so a Kyiv target of August 22 has lead 0. DST changes do not add or remove a lead day: timezone conversion happens once to identify the local date, and date subtraction counts calendar boundaries. Instants remain UTC for ordering and auditability; daily concepts remain `date` because they do not represent an instant.

The database cannot reconstruct `collection_date` from `collected_at` without a stable snapshot of the location timezone. The future trusted adapter is responsible for this conversion, while the generated lead column and date/range checks prevent internally inconsistent horizons.

## Runs and partial failure

`forecast_runs` is operational, not user-owned UI data. Trigger types are `manual`, `scheduled`, and `retry`; statuses are:

- `running`: unfinished and `completed_at` is null;
- `succeeded`: every planned location succeeded and none failed (including a valid no-work run);
- `partial`: at least one succeeded and at least one failed, and all planned locations are accounted for;
- `failed`: no location succeeded, including failure before normal processing began.

Counters are non-negative and processed locations cannot exceed the total. `error_message` is at most 1,000 characters and contains only a sanitized aggregate summary—never stack traces, request headers, URLs containing credentials, raw responses, or secrets. Per-location diagnostics are deferred to structured server logs or a reviewed `forecast_run_items` design.

One collector invocation owns one run. Internal request retries remain in that run; a separately initiated retry may create a new run with trigger type `retry`.

## Idempotency and retry

The snapshot identity is `(location_id, collection_date, target_date)`. It retains how a forecast changed from one local collection day to another, while a retry seconds later cannot bypass identity through a new timestamp. The future writer uses `INSERT ... ON CONFLICT DO NOTHING`, never an update-upsert. The first accepted value remains immutable; a retry may fill only a missing identity.

The adapter returns a machine-readable error category. Retryable categories include timeout, connection reset, 429, 5xx, and temporary provider unavailability. Invalid coordinates/timezone/request parameters, unsupported parameters, response/schema mismatch, and normalized validation failures are non-retryable until input or code changes. A bounded attempt count, exponential backoff with jitter, `AbortController` timeout, and `Retry-After` support are required. Exhaustion for one location does not stop other locations.

## Ownership, deletion, immutability, and security

A snapshot references the concrete user-owned `locations.id`; identical Kyiv rows belonging to two users intentionally receive separate snapshots. A later collector may group coordinates and timezone for one HTTP call and fan the normalized rows out to each location. A canonical `places` table is unnecessary for this MVP.

Deleting a location cascades its personal snapshot history. This preserves the current delete UX and is user-owned data erasure, not mutation of an extant historical forecast. Deleting a run is restricted while snapshots reference it, preserving audit provenance. Administrative cleanup must delete affected locations/snapshots before a run, in a controlled trusted context.

Snapshots reject every direct `UPDATE` through a database trigger. The trigger is update-only, so the required foreign-key cascade deletion still works. `anon` receives no table privileges. `authenticated` receives only `SELECT` on snapshots, and RLS permits rows whose referenced location belongs to `auth.uid()`; it receives no run access and no insert/update/delete snapshot policy or grant.

The browser has only the project URL and publishable key. It cannot create runs or snapshots. A future Supabase Edge Function is the privileged collector; any provider credential belongs only in Supabase project secrets. A `service_role` key must never enter repository files, generated runtime config, Cloudflare variables, or frontend code. RLS remains the browser security boundary even after the collector exists.

## Index rationale

- the identity unique index serves location history ordered by collection day;
- `(location_id, target_date, collection_date)` serves forecasts for one target and location;
- `(location_id, lead_days, target_date)` serves future accuracy cohorts at horizons 1/3/5/7;
- `(forecast_run_id)` supports run reconciliation and the foreign key;
- runs by descending `started_at` support operational recency; the partial running index supports recovery of unfinished runs.

## Deployment and deferred work

Apply the migration to `weather-statistic-dev` first and execute the [manual development validation](../validation/forecast-schema-development.md). Only after development RLS/runtime approval and PR review may it be applied to production. This PR makes no provider request and implements no adapter, Edge Function, scheduler, manual trigger UI, observations, accuracy calculation, or real-data dashboard.
