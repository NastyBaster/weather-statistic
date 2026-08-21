begin;

create table public.forecast_runs (
  id uuid primary key default gen_random_uuid(),
  trigger_type text not null,
  started_at timestamptz not null default now(),
  completed_at timestamptz,
  status text not null default 'running',
  locations_total integer not null default 0,
  locations_succeeded integer not null default 0,
  locations_failed integer not null default 0,
  snapshots_created integer not null default 0,
  error_message text,
  created_at timestamptz not null default now(),
  constraint forecast_runs_trigger_type_check
    check (trigger_type in ('manual', 'scheduled', 'retry')),
  constraint forecast_runs_status_check
    check (status in ('running', 'succeeded', 'partial', 'failed')),
  constraint forecast_runs_counters_nonnegative_check
    check (
      locations_total >= 0
      and locations_succeeded >= 0
      and locations_failed >= 0
      and snapshots_created >= 0
    ),
  constraint forecast_runs_counters_bounded_check
    check (locations_succeeded + locations_failed <= locations_total),
  constraint forecast_runs_completion_check
    check (
      (status = 'running' and completed_at is null)
      or (status <> 'running' and completed_at is not null and completed_at >= started_at)
    ),
  constraint forecast_runs_terminal_semantics_check
    check (
      status = 'running'
      or (status = 'succeeded'
          and locations_failed = 0
          and locations_succeeded = locations_total)
      or (status = 'partial'
          and locations_succeeded > 0
          and locations_failed > 0
          and locations_succeeded + locations_failed = locations_total)
      or (status = 'failed'
          and locations_succeeded = 0)
    ),
  constraint forecast_runs_error_message_length_check
    check (error_message is null or length(error_message) <= 1000)
);

create table public.forecast_snapshots (
  id uuid primary key default gen_random_uuid(),
  forecast_run_id uuid not null
    references public.forecast_runs (id) on delete restrict,
  location_id uuid not null
    references public.locations (id) on delete cascade,
  collected_at timestamptz not null,
  collection_date date not null,
  target_date date not null,
  lead_days integer generated always as (target_date - collection_date) stored,
  temperature_min double precision,
  temperature_max double precision,
  precipitation_sum double precision,
  precipitation_probability integer,
  wind_speed_max double precision,
  weather_code integer,
  created_at timestamptz not null default now(),
  constraint forecast_snapshots_identity_key
    unique (location_id, collection_date, target_date),
  constraint forecast_snapshots_date_order_check
    check (target_date >= collection_date),
  constraint forecast_snapshots_lead_days_check
    check (lead_days between 0 and 16),
  constraint forecast_snapshots_temperature_range_check
    check (
      (temperature_min is null or temperature_min between -150 and 100)
      and (temperature_max is null or temperature_max between -150 and 100)
    ),
  constraint forecast_snapshots_temperature_order_check
    check (
      temperature_min is null
      or temperature_max is null
      or temperature_min <= temperature_max
    ),
  constraint forecast_snapshots_precipitation_check
    check (precipitation_sum is null or precipitation_sum >= 0),
  constraint forecast_snapshots_probability_check
    check (precipitation_probability is null or precipitation_probability between 0 and 100),
  constraint forecast_snapshots_wind_speed_check
    check (wind_speed_max is null or wind_speed_max >= 0),
  constraint forecast_snapshots_weather_code_check
    check (weather_code is null or weather_code between 0 and 99),
  constraint forecast_snapshots_has_forecast_value_check
    check (num_nonnulls(
      temperature_min,
      temperature_max,
      precipitation_sum,
      precipitation_probability,
      wind_speed_max,
      weather_code
    ) > 0)
);

create index forecast_runs_started_at_idx
  on public.forecast_runs (started_at desc);
create index forecast_runs_running_idx
  on public.forecast_runs (started_at)
  where status = 'running';
create index forecast_snapshots_location_target_idx
  on public.forecast_snapshots (location_id, target_date, collection_date);
create index forecast_snapshots_location_lead_idx
  on public.forecast_snapshots (location_id, lead_days, target_date);
create index forecast_snapshots_run_idx
  on public.forecast_snapshots (forecast_run_id);

create function public.reject_forecast_snapshot_update()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'forecast snapshots are immutable' using errcode = '55000';
end;
$$;

revoke all on function public.reject_forecast_snapshot_update() from public;

create trigger forecast_snapshots_reject_update
before update on public.forecast_snapshots
for each row execute function public.reject_forecast_snapshot_update();

alter table public.forecast_runs enable row level security;
alter table public.forecast_snapshots enable row level security;

create policy "Users can read snapshots for their locations"
on public.forecast_snapshots for select
to authenticated
using (
  exists (
    select 1
    from public.locations
    where locations.id = forecast_snapshots.location_id
      and locations.user_id = (select auth.uid())
  )
);

revoke all on public.forecast_runs from anon, authenticated;
revoke all on public.forecast_snapshots from anon, authenticated;
grant select on public.forecast_snapshots to authenticated;

commit;
