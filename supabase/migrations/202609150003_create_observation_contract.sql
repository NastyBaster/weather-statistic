begin;

create table public.weather_observations (
  id uuid primary key default gen_random_uuid(),
  location_id uuid not null
    references public.locations (id) on delete cascade,
  provider text not null default 'open-meteo',
  collected_at timestamptz not null default now(),
  observation_date date not null,
  temperature_min double precision,
  temperature_max double precision,
  precipitation_sum double precision,
  wind_speed_max double precision,
  weather_code integer,
  created_at timestamptz not null default now(),
  constraint weather_observations_provider_check
    check (provider = 'open-meteo'),
  constraint weather_observations_temperature_range_check
    check (
      (temperature_min is null or temperature_min between -150 and 100)
      and (temperature_max is null or temperature_max between -150 and 100)
    ),
  constraint weather_observations_temperature_order_check
    check (
      temperature_min is null
      or temperature_max is null
      or temperature_min <= temperature_max
    ),
  constraint weather_observations_precipitation_check
    check (precipitation_sum is null or precipitation_sum >= 0),
  constraint weather_observations_wind_speed_check
    check (wind_speed_max is null or wind_speed_max >= 0),
  constraint weather_observations_weather_code_check
    check (weather_code is null or weather_code between 0 and 99),
  constraint weather_observations_has_value_check
    check (num_nonnulls(
      temperature_min,
      temperature_max,
      precipitation_sum,
      wind_speed_max,
      weather_code
    ) > 0),
  constraint weather_observations_identity_key
    unique (location_id, provider, observation_date)
);

create index weather_observations_location_date_idx
  on public.weather_observations (location_id, observation_date desc);
create index weather_observations_collected_at_idx
  on public.weather_observations (collected_at desc);

create function public.reject_weather_observation_update()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'weather observations are immutable' using errcode = '55000';
end;
$$;

revoke all on function public.reject_weather_observation_update() from public;

create trigger weather_observations_reject_update
before update on public.weather_observations
for each row execute function public.reject_weather_observation_update();

alter table public.weather_observations enable row level security;

revoke all on public.weather_observations from anon, authenticated;
grant select on public.weather_observations to authenticated;

create policy "Users can read observations for their locations"
on public.weather_observations for select
to authenticated
using (
  exists (
    select 1
    from public.locations
    where locations.id = weather_observations.location_id
      and locations.user_id = (select auth.uid())
  )
);

commit;
