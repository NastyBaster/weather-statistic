# Observation data contract (Stage 7.0)

Status: **accepted for Stage 7.0 implementation** (2026-09-15). This contract defines the
immutable daily observation schema only. Provider collection, scheduling, accuracy calculations,
and real-data dashboard work remain separate stages.

## Purpose and boundary

An observation is the measured weather for one local calendar day at one user-owned location.
It is not a forecast and must never overwrite or be presented as one. Forecast snapshots retain
what the provider predicted; observations retain what was later measured. Accuracy belongs to a
future read model that joins the two by location, target date, and forecast lead.

The MVP provider is Open-Meteo's historical/weather archive surface, subject to rechecking its
current terms, availability, variables, and non-commercial limits before collection begins.
The schema stores normalized provider-independent values and keeps the provider name for
provenance. The first implementation allows only `open-meteo`; adding another provider requires a
reviewed contract and migration.

## Stored record

| Field | Meaning |
| --- | --- |
| `location_id` | Concrete user-owned location; deletion cascades its personal observations. |
| `provider` | Normalized source identifier, currently `open-meteo`. |
| `collected_at` | UTC instant when our trusted collector accepted the observation response; never the provider model issuance time. |
| `observation_date` | Local calendar day being measured, not a UTC cast of `collected_at`. |
| `temperature_min` / `temperature_max` | Daily minimum/maximum temperature in °C. |
| `precipitation_sum` | Daily precipitation total in mm. |
| `wind_speed_max` | Daily maximum wind speed in km/h. |
| `weather_code` | Normalized WMO-style weather code, 0–99. |
| `created_at` | Database insertion time. |

At least one weather value is required. Missing upstream values become SQL `null`; the collector
must reject malformed responses rather than inventing values. Numeric values are stored without
presentation rounding.

## Identity, time, and immutability

The immutable identity is `(location_id, provider, observation_date)`. A later collection of the
same provider/day is an idempotent conflict, not an update. `observation_date` is computed from
the location's explicit IANA timezone by the trusted collector. `collected_at` remains an
absolute UTC instant for audit ordering.

The database rejects every `UPDATE` through a trigger. User-owned location deletion cascades to
observations; that is lawful data erasure and does not mutate a surviving observation. There is
no browser insert, update, or delete path.

## Validation and security

- Temperatures are nullable and constrained to −150 through 100 °C; min cannot exceed max.
- Precipitation and wind are nullable and non-negative.
- Weather codes are nullable and constrained to 0–99.
- `provider` is constrained to the reviewed MVP value.
- `anon` and `authenticated` cannot write observations.
- Authenticated reads are RLS-scoped through the owning location; service-role collection is a
  future server-side operation.
- No service-role key, provider credential, raw provider response, or user identifier belongs in
  the browser or persisted error text.

## Deliberate non-goals

This stage does not add an observation collector, provider adapter, scheduler, manual trigger,
accuracy formula, rain-event threshold, confidence/sample-size rule, or dashboard replacement.
Those belong to Stages 7.1, 7.2, 8.0–8.1, and 9 respectively.
