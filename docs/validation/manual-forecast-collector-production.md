# Manual collector: production rollout and validation

Stage 5.1.1 deployed the reviewed `collect-forecasts` Edge Function to production as a manual-only operator action. JWT verification is enabled. The deployed source matched the reviewed `main` revision at rollout time. No scheduler, browser trigger, observations pipeline, accuracy calculation, or real-data UI was introduced.

## Production evidence

Validation was performed on 2026-08-23 with two short-lived production user sessions and trusted database inspection. Identifiers, project references, credentials, secret values, and raw responses are intentionally omitted.

- The production function was active and accepted only the allowlisted operator. An authenticated non-admin invocation was denied.
- Exactly two authorized manual runs were made; no third invocation was performed. Both runs terminated successfully and no run remained `running`.
- The first run created 24 snapshots. The same-local-day second run created zero snapshots, confirming idempotent conflict handling. The final database held 2 runs, 24 snapshots, and zero duplicate `(location_id, collection_date, target_date)` identities.
- Snapshots covered lead days 0–7, used the stored location timezone and canonical units/values, and preserved coordinate/timezone grouping. Inactive locations received no snapshots.
- A privileged attempt to update an immutable snapshot failed with SQLSTATE `55000` and rolled back.
- User A could select 16 owned snapshots and User B could select 8. Neither session could see rows belonging to the other user.
- Authenticated snapshot `INSERT`, correctly serialized `UPDATE`, and `DELETE` were denied. The `UPDATE` and `DELETE` checks returned HTTP 403 with SQLSTATE `42501`; the earlier malformed Windows request is not counted as evidence.
- Authenticated `forecast_runs` reads were denied with HTTP 403 and SQLSTATE `42501` for both users.
- Anonymous snapshot and run reads were denied with HTTP 401 and SQLSTATE `42501`.
- After the denial checks, the two owned result sets still totaled 24 snapshots with zero duplicate identities. The previously established trusted baseline remained 2 runs, 0 running runs, 24 snapshots, and 0 duplicates.

The user access tokens were held only in inherited process memory for the grouped checks, then cleared. They were not printed, decoded, persisted, logged, or added to repository files. No temporary validation script was written.

## Production log review

The production Supabase Dashboard logs for `collect-forecasts` were manually reviewed and passed. The Dashboard displayed timestamps in local UTC+3 time. Review was restricted to the two authorized invocation windows: `2026-08-22T13:57:45Z` (booted at approximately 16:57:45 local time, followed by shutdown) and `2026-08-22T14:05:49Z` (booted at approximately 17:05:49 local time, followed by shutdown).

The entries contained only acceptable runtime lifecycle metadata such as boot, shutdown, and boot duration. The review found no JWT, Authorization header, service-role key, `FORECAST_ADMIN_USER_IDS` value, email, user UUID, raw Open-Meteo response body, stack trace, database connection string, full database error, or provider secret. No full log entries were copied or exported. Project references, execution IDs, tokens, secret digests, and other identifying or secret values remain omitted from this record.

## Rollout status

The production manual collector is deployed, its data, idempotency, immutability, and RLS boundaries are validated, and its production log review passed. Invocation remains manual-only. Scheduling is deferred. The current UI continues to use demonstration data; observations, accuracy calculations, and real-data presentation remain deferred.
