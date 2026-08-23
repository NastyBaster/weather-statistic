# Manual forecast collector (stage 5.1)

The `collect-forecasts` Supabase Edge Function is the first trusted server-side writer for the forecast contract. `POST /functions/v1/collect-forecasts` accepts no operational input: selection, provider endpoint, timezone, units, and identity all come from reviewed server code and database rows. `GET` and other methods return 405.

## Trust and authorization boundary

The function validates the caller's bearer token with Supabase Auth and compares the returned stable user UUID with the comma-separated `FORECAST_ADMIN_USER_IDS` project secret. Missing/invalid credentials return 401 and a valid non-operator returns 403. A request body cannot assert operator identity. The service-role credential supplied by Supabase's managed Edge runtime is used only by this function; it is never returned, logged, committed, added to Cloudflare, or exposed to the browser. Browser grants and RLS policies are unchanged.

## Collection design

The collector selects only `locations.is_active = true`, then serializes `[latitude, longitude, timezone]` with `JSON.stringify` as its deterministic group key. Numbers are not rounded: coordinates differing at any stored precision do not merge, and equal coordinates with different IANA zones remain separate. One provider response is fanned out to every concrete location UUID in its group.

Open-Meteo requests use `https://api.open-meteo.com/v1/forecast`, an explicit stored IANA timezone, `forecast_days=8`, the six contracted daily variables, and explicit `celsius`, `mm`, and `kmh` units. The open-access endpoint currently requires no provider secret. Official documentation, pricing, terms, and licensing were reviewed on 2026-08-21: the free endpoint is described for non-commercial use with published limits of 600/minute, 5,000/hour, 10,000/day, and 300,000/month; commercial use requires a customer plan/endpoint and review before production. Open-Meteo and upstream-provider attribution remains required. The official API documents structured error JSON, but does not guarantee `Retry-After`; the adapter supports it when present without persisting the raw body.

The adapter validates equal array lengths, canonical `daily_units`, strict dates, finite-or-null numbers, ranges, integer probability/weather codes, temperature order, a non-empty forecast value, and the schema's 0–16-day boundary before any group insert. The timestamp captured immediately after successful JSON receipt becomes that response's `collected_at`; its date in the group's IANA timezone becomes `collection_date`. All fan-out rows share both values. PostgreSQL—not the function—generates `lead_days`.

At most four groups run concurrently. Each provider attempt has a 10-second abort timeout and at most three attempts with capped exponential backoff, jitter, and capped `Retry-After`. Timeouts, network failures, 429, and 5xx retry; other 4xx and malformed/invalid responses do not. Attempts remain inside one run.

Snapshots use Supabase `upsert` with `ignoreDuplicates: true`, which maps to insert with `ON CONFLICT DO NOTHING`; no update-upsert is allowed. Returned inserted IDs determine `snapshots_created`, so existing identities are successful no-ops. A valid second manual invocation creates a new run but not new same-local-day snapshot identities.

One failing group does not cancel others. Location counters determine `succeeded`, `partial`, or `failed`; no active locations is a successful zero-work run. A created run is always terminally updated if possible. Persisted and returned errors are short category summaries only—never provider bodies, database details, headers, tokens, stack traces, emails, or URLs.

The reviewed function is deployed to production and its manual invocation, idempotency, immutability, RLS boundaries, and production logs are validated. It remains manual-only: scheduling, a dashboard trigger, per-location diagnostics, observations, accuracy calculations, and real-data UI are deliberately deferred. The current UI still uses demonstration data. Sanitized rollout evidence and the passed manual log review are recorded in [`../validation/manual-forecast-collector-production.md`](../validation/manual-forecast-collector-production.md).
