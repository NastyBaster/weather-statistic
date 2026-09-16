begin;

drop view if exists public.forecast_accuracy;
drop view if exists public.forecast_accuracy_detail;

create view public.forecast_accuracy_detail
with (security_invoker = true)
as
select
  snapshots.id as forecast_snapshot_id,
  snapshots.location_id,
  snapshots.forecast_run_id,
  snapshots.collected_at,
  snapshots.collection_date as forecast_collection_date,
  snapshots.target_date,
  snapshots.lead_days,
  observations.id as observation_id,
  observations.provider as observation_provider,
  snapshots.temperature_min as forecast_temperature_min,
  observations.temperature_min as observed_temperature_min,
  snapshots.temperature_max as forecast_temperature_max,
  observations.temperature_max as observed_temperature_max,
  snapshots.precipitation_sum as forecast_precipitation_sum,
  observations.precipitation_sum as observed_precipitation_sum,
  snapshots.precipitation_probability,
  snapshots.wind_speed_max as forecast_wind_speed_max,
  observations.wind_speed_max as observed_wind_speed_max,
  observations.weather_code as observed_weather_code,
  observations.id is not null as observation_available
from public.forecast_snapshots as snapshots
join public.locations as locations
  on locations.id = snapshots.location_id
 and locations.user_id = (select auth.uid())
left join public.weather_observations as observations
  on observations.location_id = snapshots.location_id
 and observations.observation_date = snapshots.target_date
where snapshots.lead_days in (1, 3, 5, 7);

create view public.forecast_accuracy
with (security_invoker = true)
as
with scoped_rows as (
  select
    'location'::text as scope_type,
    detail.location_id as scope_location_id,
    detail.*
  from public.forecast_accuracy_detail as detail
  union all
  select
    'all_owned_locations'::text as scope_type,
    null::uuid as scope_location_id,
    detail.*
  from public.forecast_accuracy_detail as detail
), aggregated as (
  select
    scope_type,
    scope_location_id,
    lead_days,
    count(distinct scoped_rows.location_id)::integer as location_count,
    count(*)::integer as forecast_row_n,
    count(*) filter (where observation_available)::integer as observation_row_n,
    count(*) filter (where not observation_available)::integer as observation_missing_n,
    min(forecast_collection_date) as forecast_collection_date_min,
    max(forecast_collection_date) as forecast_collection_date_max,
    min(target_date) as target_date_min,
    max(target_date) as target_date_max,
    array_agg(distinct observation_provider order by observation_provider)
      filter (where observation_provider is not null) as observation_providers,
    count(*) filter (where forecast_temperature_min is not null)::integer
      as temperature_min_forecast_present_n,
    count(*) filter (where observed_temperature_min is not null)::integer
      as temperature_min_observed_present_n,
    count(*) filter (
      where forecast_temperature_min is not null and observed_temperature_min is not null
    )::integer as temperature_min_n,
    avg(abs(forecast_temperature_min - observed_temperature_min)) filter (
      where forecast_temperature_min is not null and observed_temperature_min is not null
    ) as temperature_min_mae,
    avg(forecast_temperature_min - observed_temperature_min) filter (
      where forecast_temperature_min is not null and observed_temperature_min is not null
    ) as temperature_min_bias,
    count(*) filter (where forecast_temperature_max is not null)::integer
      as temperature_max_forecast_present_n,
    count(*) filter (where observed_temperature_max is not null)::integer
      as temperature_max_observed_present_n,
    count(*) filter (
      where forecast_temperature_max is not null and observed_temperature_max is not null
    )::integer as temperature_max_n,
    avg(abs(forecast_temperature_max - observed_temperature_max)) filter (
      where forecast_temperature_max is not null and observed_temperature_max is not null
    ) as temperature_max_mae,
    avg(forecast_temperature_max - observed_temperature_max) filter (
      where forecast_temperature_max is not null and observed_temperature_max is not null
    ) as temperature_max_bias,
    count(*) filter (where forecast_wind_speed_max is not null)::integer
      as wind_speed_max_forecast_present_n,
    count(*) filter (where observed_wind_speed_max is not null)::integer
      as wind_speed_max_observed_present_n,
    count(*) filter (
      where forecast_wind_speed_max is not null and observed_wind_speed_max is not null
    )::integer as wind_speed_max_n,
    avg(abs(forecast_wind_speed_max - observed_wind_speed_max)) filter (
      where forecast_wind_speed_max is not null and observed_wind_speed_max is not null
    ) as wind_speed_max_mae,
    avg(forecast_wind_speed_max - observed_wind_speed_max) filter (
      where forecast_wind_speed_max is not null and observed_wind_speed_max is not null
    ) as wind_speed_max_bias,
    count(*) filter (where forecast_precipitation_sum is not null)::integer
      as precipitation_sum_forecast_present_n,
    count(*) filter (where observed_precipitation_sum is not null)::integer
      as precipitation_sum_observed_present_n,
    count(*) filter (
      where forecast_precipitation_sum is not null and observed_precipitation_sum is not null
    )::integer as precipitation_sum_n,
    avg(abs(forecast_precipitation_sum - observed_precipitation_sum)) filter (
      where forecast_precipitation_sum is not null and observed_precipitation_sum is not null
    ) as precipitation_sum_mae,
    avg(forecast_precipitation_sum - observed_precipitation_sum) filter (
      where forecast_precipitation_sum is not null and observed_precipitation_sum is not null
    ) as precipitation_sum_bias,
    count(*) filter (where precipitation_probability is not null)::integer
      as rain_probability_present_n,
    count(*) filter (where observed_precipitation_sum is not null)::integer
      as rain_observed_precipitation_present_n,
    count(*) filter (
      where precipitation_probability is not null and observed_precipitation_sum is not null
    )::integer as rain_event_n,
    count(*) filter (
      where precipitation_probability >= 50 and observed_precipitation_sum >= 1
    )::integer as rain_tp,
    count(*) filter (
      where precipitation_probability >= 50 and observed_precipitation_sum < 1
    )::integer as rain_fp,
    count(*) filter (
      where precipitation_probability < 50 and observed_precipitation_sum >= 1
    )::integer as rain_fn,
    count(*) filter (
      where precipitation_probability < 50 and observed_precipitation_sum < 1
    )::integer as rain_tn,
    count(*) filter (
      where precipitation_probability is not null and observed_precipitation_sum >= 1
    )::integer as rain_actual_events,
    count(*) filter (
      where precipitation_probability is not null and observed_precipitation_sum < 1
    )::integer as rain_actual_non_events
  from scoped_rows
  group by scope_type, scope_location_id, lead_days
)
select
  scope_type,
  scope_location_id as location_id,
  lead_days,
  location_count,
  forecast_row_n,
  observation_row_n,
  observation_missing_n,
  forecast_collection_date_min,
  forecast_collection_date_max,
  target_date_min,
  target_date_max,
  observation_providers,
  temperature_min_forecast_present_n,
  temperature_min_observed_present_n,
  temperature_min_n,
  temperature_min_mae,
  temperature_min_bias,
  case when temperature_min_n < 10 then 'insufficient'
       when temperature_min_n < 30 then 'provisional' else 'reliable' end as temperature_min_status,
  temperature_max_forecast_present_n,
  temperature_max_observed_present_n,
  temperature_max_n,
  temperature_max_mae,
  temperature_max_bias,
  case when temperature_max_n < 10 then 'insufficient'
       when temperature_max_n < 30 then 'provisional' else 'reliable' end as temperature_max_status,
  wind_speed_max_forecast_present_n,
  wind_speed_max_observed_present_n,
  wind_speed_max_n,
  wind_speed_max_mae,
  wind_speed_max_bias,
  case when wind_speed_max_n < 10 then 'insufficient'
       when wind_speed_max_n < 30 then 'provisional' else 'reliable' end as wind_speed_max_status,
  precipitation_sum_forecast_present_n,
  precipitation_sum_observed_present_n,
  precipitation_sum_n,
  precipitation_sum_mae,
  precipitation_sum_bias,
  case when precipitation_sum_n < 10 then 'insufficient'
       when precipitation_sum_n < 30 then 'provisional' else 'reliable' end as precipitation_sum_status,
  rain_probability_present_n,
  rain_observed_precipitation_present_n,
  rain_event_n,
  rain_tp,
  rain_fp,
  rain_fn,
  rain_tn,
  case when rain_tp + rain_fp = 0 then null
       else rain_tp::double precision / (rain_tp + rain_fp) end as rain_precision,
  case when rain_tp + rain_fp = 0 then 'no_predicted_events' else null end as rain_precision_reason,
  case when rain_tp + rain_fn = 0 then null
       else rain_tp::double precision / (rain_tp + rain_fn) end as rain_recall,
  case when rain_tp + rain_fn = 0 then 'no_actual_events' else null end as rain_recall_reason,
  case when rain_fp + rain_tn = 0 then null
       else rain_fp::double precision / (rain_fp + rain_tn) end as rain_false_alarm_rate,
  case when rain_fp + rain_tn = 0 then 'no_actual_non_events' else null end as rain_false_alarm_rate_reason,
  case when rain_event_n < 10 then 'insufficient'
       when rain_event_n < 30 then 'provisional'
       when rain_actual_events < 5 or rain_actual_non_events < 5 then 'insufficient'
       else 'reliable' end as rain_event_status
from aggregated;

revoke all on public.forecast_accuracy_detail from public;
revoke all on public.forecast_accuracy from public;
grant select on public.forecast_accuracy_detail to authenticated;
grant select on public.forecast_accuracy to authenticated;

comment on view public.forecast_accuracy_detail is
  'RLS-scoped Stage 8.1 paired detail with unmatched forecasts and row-level provenance.';
comment on view public.forecast_accuracy is
  'RLS-scoped Stage 8.1 accuracy aggregates with per-location and all-owned scopes.';

commit;
