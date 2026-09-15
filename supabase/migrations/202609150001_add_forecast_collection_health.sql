begin;

create function public.get_forecast_collection_health(
  observed_at timestamptz default now()
)
returns table (
  checked_at timestamptz,
  expected_window_start timestamptz,
  expected_window_end timestamptz,
  latest_scheduled_started_at timestamptz,
  latest_scheduled_status text,
  latest_scheduled_completed_at timestamptz,
  latest_scheduled_locations_total integer,
  latest_scheduled_locations_succeeded integer,
  latest_scheduled_locations_failed integer,
  latest_scheduled_snapshots_created integer,
  running_scheduled_count bigint,
  oldest_running_scheduled_started_at timestamptz,
  running_age_bucket text,
  missing_scheduled_acceptance boolean
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  window_start timestamptz;
  latest public.forecast_runs%rowtype;
  running_count bigint;
  oldest_running timestamptz;
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception using errcode = '42501', message = 'forecast_health_forbidden';
  end if;

  window_start := date_trunc('day', observed_at at time zone 'UTC')
    at time zone 'UTC' + interval '4 hours 17 minutes';
  if observed_at < window_start then
    window_start := window_start - interval '1 day';
  end if;

  select * into latest
  from public.forecast_runs
  where trigger_type = 'scheduled'
  order by started_at desc
  limit 1;

  select count(*), min(started_at)
  into running_count, oldest_running
  from public.forecast_runs
  where trigger_type = 'scheduled' and status = 'running';

  return query
  select
    observed_at,
    window_start,
    window_start + interval '2 hours',
    latest.started_at,
    latest.status,
    latest.completed_at,
    latest.locations_total,
    latest.locations_succeeded,
    latest.locations_failed,
    latest.snapshots_created,
    running_count,
    oldest_running,
    case
      when running_count = 0 then 'none'
      when observed_at - oldest_running < interval '15 minutes' then 'under_15m'
      else '15m_or_more'
    end,
    observed_at >= window_start + interval '2 hours'
      and not exists (
        select 1
        from public.forecast_runs accepted
        where accepted.trigger_type = 'scheduled'
          and accepted.started_at >= window_start
          and accepted.started_at < window_start + interval '2 hours'
      );
end;
$$;

revoke all on function public.get_forecast_collection_health(timestamptz) from public;
grant execute on function public.get_forecast_collection_health(timestamptz) to service_role;

commit;
