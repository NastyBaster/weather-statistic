create extension if not exists pgtap with schema extensions;
create extension if not exists dblink with schema extensions;

select extensions.plan(35);

select gen_random_uuid() as test_user_id \gset
select gen_random_uuid() as test_location_id \gset

insert into auth.users (id) values (:'test_user_id');
insert into public.locations (
  id, user_id, name, country_code, latitude, longitude, timezone
) values (
  :'test_location_id', :'test_user_id', 'Scheduler integration fixture',
  'UA', 50, 30, 'Europe/Kyiv'
);

delete from public.forecast_runs where trigger_type = 'scheduled';

insert into public.forecast_runs (trigger_type, started_at, locations_total)
values ('scheduled', transaction_timestamp() - interval '14 minutes 59.999 seconds', 1)
returning id as fresh_run_id \gset

select extensions.results_eq(
  $$select result from public.claim_scheduled_forecast_run(1)$$,
  array['scheduled_run_active'::text],
  '14:59.999 is fresh'
);
select extensions.is(
  (select status from public.forecast_runs where id = :'fresh_run_id'),
  'running',
  'fresh run is unchanged'
);

update public.forecast_runs
set started_at = transaction_timestamp() - interval '15 minutes'
where id = :'fresh_run_id';
select result, run_id as replacement_run_id
from public.claim_scheduled_forecast_run(1) \gset
select extensions.is(:'result', 'claimed', 'exactly 15:00 is recovery eligible');
select extensions.is(
  (select status from public.forecast_runs where id = :'fresh_run_id'),
  'failed',
  'inclusive recovery terminalizes stale parent'
);
select extensions.is(
  (select snapshots_created from public.forecast_runs where id = :'fresh_run_id'),
  0,
  'stale zero snapshot counter is preserved'
);

update public.forecast_runs set status = 'failed', completed_at = now(),
  locations_failed = locations_total where id = :'replacement_run_id';
insert into public.forecast_runs (
  trigger_type, started_at, locations_total, snapshots_created
) values ('scheduled', transaction_timestamp() - interval '16 minutes', 1, 7)
returning id as nonzero_run_id \gset
select result from public.claim_scheduled_forecast_run(1) \gset
select extensions.is(
  (select snapshots_created from public.forecast_runs where id = :'nonzero_run_id'),
  7,
  'stale non-zero snapshot counter is preserved'
);
select extensions.results_eq(
  format(
    $query$select result from public.finalize_forecast_run(%L, 'succeeded', 1, 0, 99, null)$query$,
    :'nonzero_run_id'
  ),
  array['run_no_longer_running'::text],
  'recovery-first rejects late finalize'
);
select extensions.is(
  (select error_message from public.forecast_runs where id = :'nonzero_run_id'),
  'stale scheduled run recovered',
  'recovery-first preserves recovery error category'
);

update public.forecast_runs set status = 'failed', completed_at = now(),
  locations_failed = locations_total where status = 'running' and trigger_type = 'scheduled';
insert into public.forecast_runs (trigger_type, locations_total)
values ('manual', 1) returning id as snapshot_run_id \gset

select extensions.results_eq(
  format(
    $query$select inserted_count from public.insert_forecast_snapshot_batch(%L, %L::jsonb)$query$,
    :'snapshot_run_id',
    jsonb_build_array(jsonb_build_object(
      'location_id', :'test_location_id',
      'collected_at', now(),
      'collection_date', current_date,
      'target_date', current_date,
      'temperature_min', 1,
      'temperature_max', 2
    ))
  ),
  array[1::bigint],
  'running-parent batch inserts atomically'
);
select extensions.results_eq(
  format(
    $query$select inserted_count from public.insert_forecast_snapshot_batch(%L, %L::jsonb)$query$,
    :'snapshot_run_id',
    jsonb_build_array(jsonb_build_object(
      'location_id', :'test_location_id',
      'collected_at', now(),
      'collection_date', current_date,
      'target_date', current_date,
      'temperature_min', 9
    ))
  ),
  array[0::bigint],
  'existing identity is an immutable no-op'
);

select result, completed_at as finalized_at
from public.finalize_forecast_run(
  :'snapshot_run_id', 'succeeded', 1, 0, 1, null
) \gset
select extensions.is(:'result', 'finalized', 'running run finalizes');
select extensions.ok(:'finalized_at'::timestamptz is not null, 'database supplies completed_at');
select extensions.results_eq(
  format(
    $query$select result from public.finalize_forecast_run(%L, 'failed', 0, 1, 0, 'storage')$query$,
    :'snapshot_run_id'
  ),
  array['run_no_longer_running'::text],
  'duplicate terminal invocation is rejected'
);
select extensions.is(
  (select snapshots_created from public.forecast_runs where id = :'snapshot_run_id'),
  1,
  'late finalize cannot replace counters'
);
select extensions.is(
  (select completed_at from public.forecast_runs where id = :'snapshot_run_id'),
  :'finalized_at'::timestamptz,
  'late finalize cannot replace completed_at'
);
select extensions.is(
  (select error_message from public.forecast_runs where id = :'snapshot_run_id'),
  null,
  'late finalize cannot replace error message'
);

select extensions.throws_ok(
  format(
    $query$select * from public.insert_forecast_snapshot_batch(%L, %L::jsonb)$query$,
    :'snapshot_run_id',
    jsonb_build_array(
      jsonb_build_object(
        'location_id', :'test_location_id', 'collected_at', now(),
        'collection_date', current_date, 'target_date', current_date + 1,
        'temperature_min', 1
      ),
      jsonb_build_object(
        'location_id', :'test_location_id', 'collected_at', now(),
        'collection_date', current_date, 'target_date', current_date + 2,
        'temperature_min', 1
      )
    )
  ),
  '55000', 'forecast_run_not_running',
  'terminal-parent multi-row batch rejects atomically'
);
select extensions.is(
  (select count(*) from public.forecast_snapshots
   where forecast_run_id = :'snapshot_run_id' and target_date > current_date),
  0::bigint,
  'terminal batch leaves no partial rows'
);
select extensions.throws_ok(
  format(
    $query$update public.forecast_snapshots set weather_code = 1 where forecast_run_id = %L$query$,
    :'snapshot_run_id'
  ),
  '55000', 'forecast snapshots are immutable',
  'snapshots remain immutable'
);

select extensions.function_privs_are(
  'public', 'finalize_forecast_run',
  array['uuid', 'text', 'integer', 'integer', 'integer', 'text'],
  'service_role', array['EXECUTE'],
  'service role alone can execute finalize RPC'
);
select extensions.function_privs_are(
  'public', 'finalize_forecast_run',
  array['uuid', 'text', 'integer', 'integer', 'integer', 'text'],
  'authenticated', array[]::text[],
  'authenticated users cannot finalize runs'
);

-- Separate sessions prove concurrent stale recovery and single-flight replacement.
delete from public.forecast_runs where trigger_type = 'scheduled' and status = 'running';
insert into public.forecast_runs (trigger_type, started_at, locations_total)
values ('scheduled', transaction_timestamp() - interval '16 minutes', 0)
returning id as concurrent_stale_id \gset
select extensions.dblink_connect('claim_one', 'dbname=' || current_database());
select extensions.dblink_connect('claim_two', 'dbname=' || current_database());
select extensions.dblink_send_query('claim_one', 'select result from public.claim_scheduled_forecast_run(0)');
select extensions.dblink_send_query('claim_two', 'select result from public.claim_scheduled_forecast_run(0)');
create temporary table concurrent_claim_results (result text);
insert into concurrent_claim_results select result from extensions.dblink_get_result('claim_one') as t(result text);
insert into concurrent_claim_results select result from extensions.dblink_get_result('claim_two') as t(result text);
select extensions.is((select count(*) from concurrent_claim_results where result = 'claimed'), 1::bigint, 'concurrent claim has one winner');
select extensions.is((select count(*) from concurrent_claim_results where result = 'scheduled_run_active'), 1::bigint, 'concurrent claim has one overlap');
select extensions.is((select status from public.forecast_runs where id = :'concurrent_stale_id'), 'failed', 'concurrent recovery terminalizes stale run once');
select extensions.dblink_disconnect('claim_one');
select extensions.dblink_disconnect('claim_two');

-- Caller-supplied time is absent from both RPC signatures and cannot affect eligibility.
select extensions.is(
  (select count(*) from information_schema.parameters
   where specific_schema = 'public'
     and specific_name like 'claim_scheduled_forecast_run%'
     and parameter_name ilike '%time%'),
  0::bigint,
  'claim RPC exposes no caller-time parameter'
);

select extensions.ok(
  pg_get_functiondef('public.claim_scheduled_forecast_run(integer)'::regprocedure)
    not ilike '%snapshots_created =%',
  'recovery never assigns snapshots_created'
);
select extensions.ok(
  pg_get_functiondef('public.finalize_forecast_run(uuid,text,integer,integer,integer,text)'::regprocedure)
    not ilike '%forecast_snapshots%',
  'finalize never updates or deletes snapshots'
);

-- A forced replacement failure must roll stale terminalization back.
update public.forecast_runs set status = 'failed', completed_at = now(),
  locations_failed = locations_total where status = 'running' and trigger_type = 'scheduled';
insert into public.forecast_runs (trigger_type, started_at, locations_total)
values ('scheduled', transaction_timestamp() - interval '16 minutes', 0)
returning id as rollback_stale_id \gset
create function public.test_reject_scheduled_replacement()
returns trigger language plpgsql set search_path = '' as $$
begin
  raise exception 'forced replacement failure';
end;
$$;
create trigger test_reject_scheduled_replacement
before insert on public.forecast_runs
for each row when (new.trigger_type = 'scheduled')
execute function public.test_reject_scheduled_replacement();
select extensions.throws_ok(
  'select * from public.claim_scheduled_forecast_run(0)',
  'P0001', 'forced replacement failure',
  'failed stale replacement rolls back the claim transaction'
);
select extensions.is(
  (select status from public.forecast_runs where id = :'rollback_stale_id'),
  'running',
  'failed stale transaction leaves original run running'
);
drop trigger test_reject_scheduled_replacement on public.forecast_runs;
drop function public.test_reject_scheduled_replacement();

-- Writer-first: its parent lock commits before recovery can terminalize.
select extensions.dblink_connect('writer_first', 'dbname=' || current_database());
select extensions.dblink_connect('recovery_after_writer', 'dbname=' || current_database());
select extensions.dblink_exec('writer_first', 'begin');
select extensions.dblink_send_query(
  'writer_first',
  format(
    $query$select * from public.insert_forecast_snapshot_batch(%L, %L::jsonb)$query$,
    :'rollback_stale_id',
    jsonb_build_array(jsonb_build_object(
      'location_id', :'test_location_id', 'collected_at', now(),
      'collection_date', current_date - 1, 'target_date', current_date - 1,
      'temperature_min', 1
    ))
  )
);
select * from extensions.dblink_get_result('writer_first') as t(inserted_count bigint);
select extensions.dblink_send_query(
  'recovery_after_writer',
  'select result from public.claim_scheduled_forecast_run(0)'
);
select extensions.is(
  extensions.dblink_is_busy('recovery_after_writer'), 1,
  'snapshot-writer-first makes recovery wait'
);
select extensions.dblink_exec('writer_first', 'commit');
select * from extensions.dblink_get_result('recovery_after_writer') as t(result text);
select extensions.is(
  (select status from public.forecast_runs where id = :'rollback_stale_id'),
  'failed',
  'writer-first recovery terminalizes after snapshot commit'
);
select extensions.dblink_disconnect('writer_first');
select extensions.dblink_disconnect('recovery_after_writer');

-- Recovery-first: a late writer waits, then the terminal-parent guard rejects it.
select id as recovery_first_id from public.forecast_runs
where trigger_type = 'scheduled' and status = 'running' \gset
update public.forecast_runs
set started_at = transaction_timestamp() - interval '16 minutes'
where id = :'recovery_first_id';
select extensions.dblink_connect('recovery_first', 'dbname=' || current_database());
select extensions.dblink_connect('writer_after_recovery', 'dbname=' || current_database());
select extensions.dblink_exec('recovery_first', 'begin');
select extensions.dblink_send_query(
  'recovery_first',
  'select result from public.claim_scheduled_forecast_run(0)'
);
select * from extensions.dblink_get_result('recovery_first') as t(result text);
select extensions.dblink_send_query(
  'writer_after_recovery',
  format(
    $query$select * from public.insert_forecast_snapshot_batch(%L, %L::jsonb)$query$,
    :'recovery_first_id',
    jsonb_build_array(jsonb_build_object(
      'location_id', :'test_location_id', 'collected_at', now(),
      'collection_date', current_date - 2, 'target_date', current_date - 2,
      'temperature_min', 1
    ))
  )
);
select extensions.is(
  extensions.dblink_is_busy('writer_after_recovery'), 1,
  'recovery-first makes late snapshot writer wait'
);
select extensions.dblink_exec('recovery_first', 'commit');
select extensions.throws_ok(
  $$select * from extensions.dblink_get_result('writer_after_recovery') as t(inserted_count bigint)$$,
  '55000', 'forecast_run_not_running',
  'recovery-first rejects complete late snapshot batch'
);
select extensions.is(
  (select count(*) from public.forecast_snapshots
   where forecast_run_id = :'recovery_first_id' and collection_date = current_date - 2),
  0::bigint,
  'recovery-first commits no late snapshot'
);
select extensions.dblink_disconnect('recovery_first');
select extensions.dblink_disconnect('writer_after_recovery');

select extensions.lives_ok(
  format($query$delete from public.locations where id = %L$query$, :'test_location_id'),
  'post-recovery location deletion remains lawful'
);
select extensions.is(
  (select snapshots_created from public.forecast_runs where id = :'snapshot_run_id'),
  1,
  'location deletion does not rewrite historical counter'
);

delete from auth.users where id = :'test_user_id';
select * from extensions.finish();
