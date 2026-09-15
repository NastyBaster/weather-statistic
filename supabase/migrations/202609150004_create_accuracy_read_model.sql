begin;

create view public.forecast_accuracy
with (security_invoker = true)
as
with paired as (
  select
    snapshots.location_id,
    snapshots.lead_days,
    snapshots.collection_date,
    snapshots.target_date,
    observations.provider as observation_provider,
    snapshots.temperature_min as forecast_temperature_min,
    snapshots.temperature_max as forecast_temperature_max,
    snapshots.precipitation_sum as forecast_precipitation_sum,
    snapshots.precipitation_probability,
    snapshots.wind_speed_max as forecast_wind_speed_max,
    observations.temperature_min as observed_temperature_min,
    observations.temperature_max as observed_temperature_max,
    observations.precipitation_sum as observed_precipitation_sum,
    observations.wind_speed_max as observed_wind_speed_max
  from public.forecast_snapshots as snapshots
  join public.weather_observations as observations
    on observations.location_id = snapshots.location_id
   and observations.observation_date = snapshots.target_date
  join public.locations as locations
    on locations.id = snapshots.location_id
   and locations.user_id = (select auth.uid())
  where snapshots.lead_days in (1, 3, 5, 7)
), aggregated as (
  select
    location_id,
    lead_days,
    min(collection_date) as forecast_collection_date_min,
    max(collection_date) as forecast_collection_date_max,
    min(target_date) as target_date_min,
    max(target_date) as target_date_max,
    array_agg(distinct observation_provider order by observation_provider) as observation_providers,
    count(*) filter (
      where forecast_temperature_min is not null
        and observed_temperature_min is not null
    ) as temperature_min_n,
    avg(abs(forecast_temperature_min - observed_temperature_min)) filter (
      where forecast_temperature_min is not null
        and observed_temperature_min is not null
    ) as temperature_min_mae,
    avg(forecast_temperature_min - observed_temperature_min) filter (
      where forecast_temperature_min is not null
        and observed_temperature_min is not null
    ) as temperature_min_bias,
    count(*) filter (
      where forecast_temperature_max is not null
        and observed_temperature_max is not null
    ) as temperature_max_n,
    avg(abs(forecast_temperature_max - observed_temperature_max)) filter (
      where forecast_temperature_max is not null
        and observed_temperature_max is not null
    ) as temperature_max_mae,
    avg(forecast_temperature_max - observed_temperature_max) filter (
      where forecast_temperature_max is not null
        and observed_temperature_max is not null
    ) as temperature_max_bias,
    count(*) filter (
      where forecast_wind_speed_max is not null
        and observed_wind_speed_max is not null
    ) as wind_speed_max_n,
    avg(abs(forecast_wind_speed_max - observed_wind_speed_max)) filter (
      where forecast_wind_speed_max is not null
        and observed_wind_speed_max is not null
    ) as wind_speed_max_mae,
    avg(forecast_wind_speed_max - observed_wind_speed_max) filter (
      where forecast_wind_speed_max is not null
        and observed_wind_speed_max is not null
    ) as wind_speed_max_bias,
    count(*) filter (
      where forecast_precipitation_sum is not null
        and observed_precipitation_sum is not null
    ) as precipitation_sum_n,
    avg(abs(forecast_precipitation_sum - observed_precipitation_sum)) filter (
      where forecast_precipitation_sum is not null
        and observed_precipitation_sum is not null
    ) as precipitation_sum_mae,
    avg(forecast_precipitation_sum - observed_precipitation_sum) filter (
      where forecast_precipitation_sum is not null
        and observed_precipitation_sum is not null
    ) as precipitation_sum_bias,
    count(*) filter (
      where precipitation_probability is not null
        and observed_precipitation_sum is not null
    ) as rain_event_n,
    count(*) filter (
      where precipitation_probability >= 50
        and observed_precipitation_sum >= 1
    ) as rain_tp,
    count(*) filter (
      where precipitation_probability >= 50
        and observed_precipitation_sum < 1
    ) as rain_fp,
    count(*) filter (
      where precipitation_probability < 50
        and observed_precipitation_sum >= 1
    ) as rain_fn,
    count(*) filter (
      where precipitation_probability < 50
        and observed_precipitation_sum < 1
    ) as rain_tn,
    count(*) filter (
      where precipitation_probability is not null
        and observed_precipitation_sum >= 1
    ) as rain_actual_events,
    count(*) filter (
      where precipitation_probability is not null
        and observed_precipitation_sum < 1
    ) as rain_actual_non_events
  from paired
  group by location_id, lead_days
)
select
  location_id,
  lead_days,
  forecast_collection_date_min,
  forecast_collection_date_max,
  target_date_min,
  target_date_max,
  observation_providers,
  temperature_min_n,
  temperature_min_mae,
  temperature_min_bias,
  case
    when temperature_min_n < 10 then 'insufficient'
    when temperature_min_n < 30 then 'provisional'
    else 'reliable'
  end as temperature_min_status,
  temperature_max_n,
  temperature_max_mae,
  temperature_max_bias,
  case
    when temperature_max_n < 10 then 'insufficient'
    when temperature_max_n < 30 then 'provisional'
    else 'reliable'
  end as temperature_max_status,
  wind_speed_max_n,
  wind_speed_max_mae,
  wind_speed_max_bias,
  case
    when wind_speed_max_n < 10 then 'insufficient'
    when wind_speed_max_n < 30 then 'provisional'
    else 'reliable'
  end as wind_speed_max_status,
  precipitation_sum_n,
  precipitation_sum_mae,
  precipitation_sum_bias,
  case
    when precipitation_sum_n < 10 then 'insufficient'
    when precipitation_sum_n < 30 then 'provisional'
    else 'reliable'
  end as precipitation_sum_status,
  rain_event_n,
  rain_tp,
  rain_fp,
  rain_fn,
  rain_tn,
  case when rain_tp + rain_fp = 0 then null else rain_tp::double precision / (rain_tp + rain_fp) end as rain_precision,
  case when rain_tp + rain_fn = 0 then null else rain_tp::double precision / (rain_tp + rain_fn) end as rain_recall,
  case when rain_fp + rain_tn = 0 then null else rain_fp::double precision / (rain_fp + rain_tn) end as rain_false_alarm_rate,
  case
    when rain_event_n < 10 then 'insufficient'
    when rain_event_n < 30 then 'provisional'
    when rain_actual_events < 5 or rain_actual_non_events < 5 then 'insufficient'
    else 'reliable'
  end as rain_event_status
from aggregated;

revoke all on public.forecast_accuracy from public;
grant select on public.forecast_accuracy to authenticated;

comment on view public.forecast_accuracy is
  'RLS-scoped Stage 8.1 accuracy aggregates; forecast and observation rows remain immutable.';

commit;
