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

## Remaining operational review

The installed Supabase CLI cannot retrieve Edge Function logs, so the following review is Dashboard-only: open production Edge Function logs for `collect-forecasts`, restrict the time range to the two manual invocation windows, and verify that entries contain no JWT or service-role credential, email address, request headers, raw provider body, stack trace, or full request/provider URL. Do not copy full log entries into an issue or pull request; record only the sanitized pass/fail result.

## Rollout status

The production manual collector is deployed and its data, idempotency, immutability, and RLS boundaries are validated. Invocation remains manual-only. Scheduling is deferred. The current UI continues to use demonstration data; observations, accuracy calculations, and real-data presentation remain deferred.
