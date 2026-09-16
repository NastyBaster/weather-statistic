begin;

do $$
declare
  view_sql text;
  scored_pair text := '(scoped_rows.forecast_temperature_min is not null and scoped_rows.observed_temperature_min is not null)'
    || ' or (scoped_rows.forecast_temperature_max is not null and scoped_rows.observed_temperature_max is not null)'
    || ' or (scoped_rows.forecast_wind_speed_max is not null and scoped_rows.observed_wind_speed_max is not null)'
    || ' or (scoped_rows.forecast_precipitation_sum is not null and scoped_rows.observed_precipitation_sum is not null)'
    || ' or (scoped_rows.precipitation_probability is not null and scoped_rows.observed_precipitation_sum is not null)';
begin
  select pg_get_viewdef('public.forecast_accuracy'::regclass, true)
    into view_sql;

  view_sql := regexp_replace(
    view_sql,
    'min\(scoped_rows\.forecast_collection_date\)\s+filter\s+\(where scoped_rows\.observation_available\)\s+as\s+forecast_collection_date_min',
    format('min(scoped_rows.forecast_collection_date) filter (where %s) as forecast_collection_date_min', scored_pair),
    1,
    0,
    'i'
  );
  view_sql := regexp_replace(
    view_sql,
    'max\(scoped_rows\.forecast_collection_date\)\s+filter\s+\(where scoped_rows\.observation_available\)\s+as\s+forecast_collection_date_max',
    format('max(scoped_rows.forecast_collection_date) filter (where %s) as forecast_collection_date_max', scored_pair),
    1,
    0,
    'i'
  );
  view_sql := regexp_replace(
    view_sql,
    'min\(scoped_rows\.target_date\)\s+filter\s+\(where scoped_rows\.observation_available\)\s+as\s+target_date_min',
    format('min(scoped_rows.target_date) filter (where %s) as target_date_min', scored_pair),
    1,
    0,
    'i'
  );
  view_sql := regexp_replace(
    view_sql,
    'max\(scoped_rows\.target_date\)\s+filter\s+\(where scoped_rows\.observation_available\)\s+as\s+target_date_max',
    format('max(scoped_rows.target_date) filter (where %s) as target_date_max', scored_pair),
    1,
    0,
    'i'
  );

  if view_sql !~* 'forecast_temperature_min is not null and scoped_rows\.observed_temperature_min is not null'
    or view_sql !~* 'forecast_collection_date_min' then
    raise exception 'accuracy provenance view definition did not contain scored-pair extrema';
  end if;

  execute 'create or replace view public.forecast_accuracy with (security_invoker = true) as ' || view_sql;
end;
$$;

comment on view public.forecast_accuracy is
  'RLS-scoped Stage 8.1 accuracy aggregates with scored-pair provenance ranges.';

commit;
