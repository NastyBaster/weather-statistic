begin;

create function public.finalize_forecast_run(
  requested_run_id uuid,
  requested_status text,
  requested_locations_succeeded integer,
  requested_locations_failed integer,
  requested_snapshots_created integer,
  requested_error_category text
)
returns table (result text, completed_at timestamptz)
language plpgsql
security definer
set search_path = ''
as $$
declare parent public.forecast_runs%rowtype;
declare terminal_at timestamptz := transaction_timestamp();
begin
  if requested_status not in ('succeeded', 'partial', 'failed')
    or requested_locations_succeeded < 0
    or requested_locations_failed < 0
    or requested_snapshots_created < 0
    or (requested_error_category is not null and requested_error_category !~ '^(collector|network|timeout|rate_limited|provider_5xx|storage)(,(collector|network|timeout|rate_limited|provider_5xx|storage))*$') then
    raise exception using errcode = '22023', message = 'invalid_finalize_request';
  end if;

  select * into parent
  from public.forecast_runs
  where id = requested_run_id
  for update;

  if not found or parent.status <> 'running' then
    return query select 'run_no_longer_running'::text, null::timestamptz;
    return;
  end if;

  if (requested_status = 'succeeded' and (
      requested_locations_succeeded <> parent.locations_total
      or requested_locations_failed <> 0
      or requested_error_category is not null
    ))
    or (requested_status = 'partial' and (
      requested_locations_succeeded <= 0
      or requested_locations_failed <= 0
      or requested_locations_succeeded + requested_locations_failed <> parent.locations_total
      or requested_error_category is null
    ))
    or (requested_status = 'failed' and (
      requested_locations_succeeded <> 0
      or requested_locations_failed <> parent.locations_total
      or requested_error_category is null
    )) then
    raise exception using errcode = '22023', message = 'invalid_finalize_request';
  end if;

  update public.forecast_runs
  set status = requested_status,
      completed_at = terminal_at,
      locations_succeeded = requested_locations_succeeded,
      locations_failed = requested_locations_failed,
      snapshots_created = requested_snapshots_created,
      error_message = case
        when requested_error_category is null then null
        else format(
          '%s of %s locations failed: %s',
          requested_locations_failed,
          parent.locations_total,
          requested_error_category
        )
      end
  where id = requested_run_id and status = 'running';

  if not found then
    return query select 'run_no_longer_running'::text, null::timestamptz;
    return;
  end if;
  return query select 'finalized'::text, terminal_at;
end;
$$;

revoke all on function public.finalize_forecast_run(uuid, text, integer, integer, integer, text) from public;
grant execute on function public.finalize_forecast_run(uuid, text, integer, integer, integer, text) to service_role;

commit;
