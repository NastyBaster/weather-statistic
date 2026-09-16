begin;

do $$
declare
  view_sql text;
begin
  select pg_get_viewdef('public.forecast_accuracy'::regclass, true)
    into view_sql;

  view_sql := regexp_replace(
    view_sql,
    'min\(scoped_rows\.forecast_collection_date\)\s+as\s+forecast_collection_date_min',
    'min(scoped_rows.forecast_collection_date) filter (where scoped_rows.observation_available) as forecast_collection_date_min',
    1,
    0,
    'i'
  );
  view_sql := regexp_replace(
    view_sql,
    'max\(scoped_rows\.forecast_collection_date\)\s+as\s+forecast_collection_date_max',
    'max(scoped_rows.forecast_collection_date) filter (where scoped_rows.observation_available) as forecast_collection_date_max',
    1,
    0,
    'i'
  );
  view_sql := regexp_replace(
    view_sql,
    'min\(scoped_rows\.target_date\)\s+as\s+target_date_min',
    'min(scoped_rows.target_date) filter (where scoped_rows.observation_available) as target_date_min',
    1,
    0,
    'i'
  );
  view_sql := regexp_replace(
    view_sql,
    'max\(scoped_rows\.target_date\)\s+as\s+target_date_max',
    'max(scoped_rows.target_date) filter (where scoped_rows.observation_available) as target_date_max',
    1,
    0,
    'i'
  );

  if view_sql !~* 'filter \(where scoped_rows\.observation_available\) as forecast_collection_date_min'
    or view_sql !~* 'filter \(where scoped_rows\.observation_available\) as target_date_min' then
    raise exception 'accuracy provenance view definition did not contain expected aggregate expressions';
  end if;

  execute 'create or replace view public.forecast_accuracy with (security_invoker = true) as ' || view_sql;
end;
$$;

comment on view public.forecast_accuracy is
  'RLS-scoped Stage 8.1 accuracy aggregates with paired-observation provenance ranges.';

commit;
