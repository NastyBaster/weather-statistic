# Manual collector: development deployment and validation

Run this procedure **only for `weather-statistic-dev`**. Production deployment and invocation are not part of stage 5.1.

## Deploy

1. In Supabase Dashboard → Authentication → Users, copy the UUID (not email) of a dedicated development operator. Keep it out of commits, screenshots, shell history, and tickets.
2. Authenticate the CLI and link only the development ref, verifying the displayed project before every command.
3. Set the allowlist without committing its value:
   `supabase secrets set FORECAST_ADMIN_USER_IDS='<development-user-uuid>[,<another-uuid>]' --project-ref <weather-statistic-dev-ref>`.
   The open Open-Meteo endpoint needs no provider key/secret. Supabase provides `SUPABASE_URL`, `SUPABASE_ANON_KEY`, and `SUPABASE_SERVICE_ROLE_KEY` to the managed function; do not set their values in repository or frontend configuration.
4. Deploy only development:
   `supabase functions deploy collect-forecasts --project-ref <weather-statistic-dev-ref>`.
   The function-local `deno.json` is intentionally colocated with the entry point so the remote Supabase bundler receives the bare-import mapping for `@supabase/supabase-js`; keep it in the deployment upload.
5. Obtain a short-lived access token by signing in to the development application as the operator and copying the session access token privately from the browser developer tools. Store it only in a temporary local shell variable (`read -s ACCESS_TOKEN; export ACCESS_TOKEN`) and unset it afterward. Never paste it into source, screenshots, PR text, or commands retained in shared history.
6. Invoke:
   `curl --fail-with-body -X POST 'https://<weather-statistic-dev-ref>.supabase.co/functions/v1/collect-forecasts' -H "Authorization: Bearer $ACCESS_TOKEN" -H 'Content-Type: application/json' --data '{}'`.

## Validate

1. Prepare at least two active locations and one suspended location. Ensure the operator is allowlisted.
2. POST without a JWT (expect 401), then with a valid non-admin development JWT (expect 403). Verify a body containing an `admin_user_id` cannot change either result.
3. Invoke as admin. In the development Table Editor/SQL Editor, confirm exactly one new run, the initial `running` lifecycle represented by its creation, a terminal status, non-null `completed_at`, consistent counters, and a sanitized response/error.
4. Confirm snapshots exist for every active location but not the suspended location. Check canonical °C/mm/km/h values, location-local `collection_date`, generated `lead_days` 0–7, and a shared `collected_at` within each coordinate/timezone group.
5. Invoke again on the same local date. Confirm a second run exists, it succeeds when responses validate, snapshot identities remain unique, and `snapshots_created` is zero where every identity already existed.
6. Repeat the stage 5.0 role tests: snapshot update is rejected even in a privileged context; authenticated browsers cannot insert/update/delete; Users A and B read only their owned snapshots; anonymous reads and authenticated `forecast_runs` reads remain unavailable.
7. Inspect response and Edge logs: no raw response body, JWT, service-role credential, email, headers, or stack trace. A mocked/local integration failure for one group must not prevent successful groups.
8. Run cleanup only in development: delete disposable locations through their owning users (snapshot rows cascade), then delete now-unreferenced disposable runs from a trusted development SQL session. Do not weaken RLS or immutability to clean fixtures.

Record actual project-side evidence in the deployment review. Automated mocked tests make no real provider call and do not substitute for this checklist. Do not deploy this function to production until a separate review and explicit approval.
