# Forecast schema: development validation

Run this checklist **only against `weather-statistic-dev` first**. Use real test users created through Supabase Auth; record their UUIDs and create one location for each through the application. Never paste a production database password or a service-role key into this repository.

1. Link the Supabase CLI to the development project and inspect the target project reference. Apply `supabase/migrations/202608210001_create_forecast_contract.sql` with the team's normal migration command. Stop if the target is production.
2. Confirm both tables, constraints, generated column, indexes, trigger, grants, policies, and RLS in Database → Tables/Policies (or catalog queries).
3. In development SQL Editor, replace the four placeholders below and run the trusted setup. Use target dates no more than 16 days after each location's local collection date.

```sql
insert into public.forecast_runs
  (id, trigger_type, status, locations_total)
values
  ('<run-uuid>', 'manual', 'running', 2);

insert into public.forecast_snapshots
  (forecast_run_id, location_id, collected_at, collection_date, target_date,
   temperature_min, temperature_max, precipitation_sum,
   precipitation_probability, wind_speed_max, weather_code)
values
  ('<run-uuid>', '<location-a-uuid>', '2026-08-21T23:30:00Z', '2026-08-22', '2026-08-23',
   12.25, 22.75, 1.4, 35, 18.2, 61),
  ('<run-uuid>', '<location-b-uuid>', '2026-08-21T23:30:00Z', '2026-08-22', '2026-08-23',
   10.5, 20.0, 0, 10, 12.7, 1);

update public.forecast_runs
set status = 'succeeded', completed_at = now(),
    locations_succeeded = 2, snapshots_created = 2
where id = '<run-uuid>';
```

4. With User A's authenticated browser client, select `forecast_snapshots`; only A's row must appear. Repeat as User B and see only B's row. With an anonymous client, the select must fail for missing privilege (or return no rows through the API), never return data.
5. From each authenticated client, attempt insert, update, and delete on `forecast_snapshots`; each must fail and no row may change. Selecting `forecast_runs` must fail, so aggregate/internal error data is not browser-readable.
6. In trusted SQL, repeat A's insert with the same `(location_id, collection_date, target_date)`: plain insert must raise unique violation. Repeat using `on conflict (location_id, collection_date, target_date) do nothing`; zero rows must be inserted.
7. In trusted SQL, verify each statement fails and roll it back: probability `101`; target date before collection date; target more than 16 days later; min temperature greater than max; negative precipitation; negative wind; all forecast values null. `lead_days` cannot be supplied because it is generated.
8. In trusted SQL, attempt `update public.forecast_snapshots set temperature_max = 99 ...`; the immutable trigger must reject it even though the context is privileged.
9. Create another disposable run/snapshot for Location A, then delete Location A through User A's normal application flow. The location deletion must succeed and all of its snapshots must disappear by cascade. User B's rows and both run rows must remain. Confirm the update-only trigger did not block cascade deletion.
10. Validate run constraints with transactions that are rolled back: negative counters; running plus a completion timestamp; terminal without completion timestamp; partial without both success and failure; succeeded with a failure; failed with a success. Each invalid write must fail.
11. Inspect browser network traffic and the built `dist`: no Open-Meteo request, collector endpoint, provider credential, database password, or service-role credential may exist.

Record runtime evidence separately in the PR/deployment review. Static tests in this repository do not substitute for these role-aware RLS and cascade checks. Production migration and deployment are blocked until this development checklist is approved.
