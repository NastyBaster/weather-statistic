begin;

create unique index forecast_runs_one_scheduled_running_idx
  on public.forecast_runs ((true))
  where trigger_type = 'scheduled' and status = 'running';

create function public.guard_forecast_snapshot_parent_running()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare parent_status text;
begin
  select status into parent_status
  from public.forecast_runs
  where id = new.forecast_run_id
  for no key update;
  if parent_status is distinct from 'running' then
    raise exception using errcode = '55000', message = 'forecast_run_not_running';
  end if;
  return new;
end;
$$;

revoke all on function public.guard_forecast_snapshot_parent_running() from public;

create trigger forecast_snapshots_require_running_parent
before insert on public.forecast_snapshots
for each row execute function public.guard_forecast_snapshot_parent_running();

create function public.insert_forecast_snapshot_batch(
  requested_run_id uuid,
  requested_rows jsonb
)
returns table (inserted_count bigint)
language plpgsql
security definer
set search_path = ''
as $$
declare parent_status text;
begin
  select status into parent_status
  from public.forecast_runs
  where id = requested_run_id
  for no key update;
  if parent_status is distinct from 'running' then
    raise exception using errcode = '55000', message = 'forecast_run_not_running';
  end if;

  return query
  with inserted as (
    insert into public.forecast_snapshots (
      forecast_run_id, location_id, collected_at, collection_date, target_date,
      temperature_min, temperature_max, precipitation_sum,
      precipitation_probability, wind_speed_max, weather_code
    )
    select
      requested_run_id, row.location_id, row.collected_at, row.collection_date,
      row.target_date, row.temperature_min, row.temperature_max,
      row.precipitation_sum, row.precipitation_probability,
      row.wind_speed_max, row.weather_code
    from jsonb_to_recordset(requested_rows) as row(
      forecast_run_id uuid, location_id uuid, collected_at timestamptz,
      collection_date date, target_date date, temperature_min double precision,
      temperature_max double precision, precipitation_sum double precision,
      precipitation_probability integer, wind_speed_max double precision,
      weather_code integer
    )
    on conflict (location_id, collection_date, target_date) do nothing
    returning id
  )
  select count(*) from inserted;
end;
$$;

revoke all on function public.insert_forecast_snapshot_batch(uuid, jsonb) from public;
grant execute on function public.insert_forecast_snapshot_batch(uuid, jsonb) to service_role;

create function public.claim_scheduled_forecast_run(requested_locations_total integer)
returns table (result text, run_id uuid)
language plpgsql
security definer
set search_path = ''
as $$
declare active_run public.forecast_runs%rowtype;
declare claimed_id uuid;
begin
  if requested_locations_total < 0 then
    raise exception using errcode = '22023', message = 'invalid_locations_total';
  end if;
  perform pg_advisory_xact_lock(734012521);
  select * into active_run
  from public.forecast_runs
  where trigger_type = 'scheduled' and status = 'running'
  order by started_at
  limit 1
  for update;

  if found and transaction_timestamp() - active_run.started_at < interval '15 minutes' then
    return query select 'scheduled_run_active'::text, null::uuid;
    return;
  end if;
  if found then
    update public.forecast_runs
    set status = 'failed', completed_at = transaction_timestamp(),
        locations_succeeded = 0, locations_failed = locations_total,
        error_message = 'stale scheduled run recovered'
    where id = active_run.id
      and trigger_type = 'scheduled' and status = 'running'
      and transaction_timestamp() - started_at >= interval '15 minutes';
    if not found then
      raise exception using errcode = '40001', message = 'scheduled_claim_conflict';
    end if;
  end if;

  insert into public.forecast_runs (trigger_type, status, locations_total)
  values ('scheduled', 'running', requested_locations_total)
  returning id into claimed_id;
  return query select 'claimed'::text, claimed_id;
end;
$$;

revoke all on function public.claim_scheduled_forecast_run(integer) from public;
grant execute on function public.claim_scheduled_forecast_run(integer) to service_role;

commit;
