create extension if not exists pgtap with schema extensions;

select extensions.plan(59);

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

begin;
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
commit;

update public.forecast_runs
set started_at = transaction_timestamp() - interval '15 minutes'
where id = :'fresh_run_id';
select result, run_id as replacement_run_id
from public.claim_scheduled_forecast_run(1) \gset
select extensions.is(:'result'::text, 'claimed', 'exactly 15:00 is recovery eligible');
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
select extensions.is(:'result'::text, 'finalized', 'running run finalizes');
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

select extensions.ok(
  to_regprocedure('public.insert_forecast_snapshot_batch(uuid,jsonb)') is not null,
  'batch snapshot RPC exists'
);
select extensions.ok(
  has_function_privilege('service_role', 'public.insert_forecast_snapshot_batch(uuid,jsonb)', 'execute'),
  'service role can execute batch snapshot RPC'
);
select extensions.ok(
  not has_function_privilege('anon', 'public.insert_forecast_snapshot_batch(uuid,jsonb)', 'execute'),
  'anon cannot execute batch snapshot RPC'
);
select extensions.ok(
  not has_function_privilege('authenticated', 'public.insert_forecast_snapshot_batch(uuid,jsonb)', 'execute'),
  'authenticated cannot execute batch snapshot RPC'
);
select extensions.ok(
  not exists (select 1 from pg_proc p cross join lateral aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a where p.oid = 'public.insert_forecast_snapshot_batch(uuid,jsonb)'::regprocedure and a.grantee = 0 and a.privilege_type = 'EXECUTE'),
  'PUBLIC cannot execute batch snapshot RPC'
);

select extensions.ok(
  to_regprocedure('public.claim_scheduled_forecast_run(integer)') is not null,
  'scheduled claim RPC exists'
);
select extensions.ok(
  has_function_privilege('service_role', 'public.claim_scheduled_forecast_run(integer)', 'execute'),
  'service role can execute scheduled claim RPC'
);
select extensions.ok(
  not has_function_privilege('anon', 'public.claim_scheduled_forecast_run(integer)', 'execute'),
  'anon cannot execute scheduled claim RPC'
);
select extensions.ok(
  not has_function_privilege('authenticated', 'public.claim_scheduled_forecast_run(integer)', 'execute'),
  'authenticated cannot execute scheduled claim RPC'
);
select extensions.ok(
  not exists (select 1 from pg_proc p cross join lateral aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a where p.oid = 'public.claim_scheduled_forecast_run(integer)'::regprocedure and a.grantee = 0 and a.privilege_type = 'EXECUTE'),
  'PUBLIC cannot execute scheduled claim RPC'
);

select extensions.ok(
  to_regprocedure('public.finalize_forecast_run(uuid,text,integer,integer,integer,text)') is not null,
  'finalize RPC exists'
);
select extensions.ok(
  has_function_privilege('service_role', 'public.finalize_forecast_run(uuid,text,integer,integer,integer,text)', 'execute'),
  'service role can execute finalize RPC'
);
select extensions.ok(
  not has_function_privilege('anon', 'public.finalize_forecast_run(uuid,text,integer,integer,integer,text)', 'execute'),
  'anon cannot execute finalize RPC'
);
select extensions.ok(
  not has_function_privilege('authenticated', 'public.finalize_forecast_run(uuid,text,integer,integer,integer,text)', 'execute'),
  'authenticated cannot execute finalize RPC'
);
select extensions.ok(
  not exists (select 1 from pg_proc p cross join lateral aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a where p.oid = 'public.finalize_forecast_run(uuid,text,integer,integer,integer,text)'::regprocedure and a.grantee = 0 and a.privilege_type = 'EXECUTE'),
  'PUBLIC cannot execute finalize RPC'
);

select extensions.ok(to_regprocedure('public.guard_forecast_snapshot_parent_running()') is not null, 'parent-running guard exists');
select extensions.ok(not has_function_privilege('service_role', 'public.guard_forecast_snapshot_parent_running()', 'execute'), 'service role cannot directly execute parent-running guard');
select extensions.ok(not has_function_privilege('anon', 'public.guard_forecast_snapshot_parent_running()', 'execute'), 'anon cannot directly execute parent-running guard');
select extensions.ok(not has_function_privilege('authenticated', 'public.guard_forecast_snapshot_parent_running()', 'execute'), 'authenticated cannot directly execute parent-running guard');
select extensions.ok(not exists (select 1 from pg_proc p cross join lateral aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a where p.oid = 'public.guard_forecast_snapshot_parent_running()'::regprocedure and a.grantee = 0 and a.privilege_type = 'EXECUTE'), 'PUBLIC cannot directly execute parent-running guard');

select extensions.ok(to_regprocedure('public.reject_forecast_snapshot_update()') is not null, 'snapshot update-rejection helper exists');
select extensions.ok(not has_function_privilege('service_role', 'public.reject_forecast_snapshot_update()', 'execute'), 'service role cannot directly execute snapshot update-rejection helper');
select extensions.ok(not has_function_privilege('anon', 'public.reject_forecast_snapshot_update()', 'execute'), 'anon cannot directly execute snapshot update-rejection helper');
select extensions.ok(not has_function_privilege('authenticated', 'public.reject_forecast_snapshot_update()', 'execute'), 'authenticated cannot directly execute snapshot update-rejection helper');
select extensions.ok(not exists (select 1 from pg_proc p cross join lateral aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a where p.oid = 'public.reject_forecast_snapshot_update()'::regprocedure and a.grantee = 0 and a.privilege_type = 'EXECUTE'), 'PUBLIC cannot directly execute snapshot update-rejection helper');

select extensions.ok(to_regprocedure('public.set_updated_at()') is not null, 'updated-at helper exists');
select extensions.ok(not has_function_privilege('service_role', 'public.set_updated_at()', 'execute'), 'service role cannot directly execute updated-at helper');
select extensions.ok(not has_function_privilege('anon', 'public.set_updated_at()', 'execute'), 'anon cannot directly execute updated-at helper');
select extensions.ok(not has_function_privilege('authenticated', 'public.set_updated_at()', 'execute'), 'authenticated cannot directly execute updated-at helper');
select extensions.ok(not exists (select 1 from pg_proc p cross join lateral aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a where p.oid = 'public.set_updated_at()'::regprocedure and a.grantee = 0 and a.privilege_type = 'EXECUTE'), 'PUBLIC cannot directly execute updated-at helper');

select extensions.ok(to_regprocedure('public.handle_new_user()') is not null, 'signup-profile helper exists');
select extensions.ok(not has_function_privilege('service_role', 'public.handle_new_user()', 'execute'), 'service role cannot directly execute signup-profile helper');
select extensions.ok(not has_function_privilege('anon', 'public.handle_new_user()', 'execute'), 'anon cannot directly execute signup-profile helper');
select extensions.ok(not has_function_privilege('authenticated', 'public.handle_new_user()', 'execute'), 'authenticated cannot directly execute signup-profile helper');
select extensions.ok(not exists (select 1 from pg_proc p cross join lateral aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a where p.oid = 'public.handle_new_user()'::regprocedure and a.grantee = 0 and a.privilege_type = 'EXECUTE'), 'PUBLIC cannot directly execute signup-profile helper');

select extensions.ok(to_regprocedure('public.health_check()') is not null, 'health check exists');
select extensions.ok(has_function_privilege('anon', 'public.health_check()', 'execute'), 'anon can execute health check');
select extensions.ok(has_function_privilege('authenticated', 'public.health_check()', 'execute'), 'authenticated can execute health check');
select extensions.ok(not exists (select 1 from pg_proc p cross join lateral aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a where p.oid = 'public.health_check()'::regprocedure and a.grantee = 0 and a.privilege_type = 'EXECUTE'), 'PUBLIC cannot execute health check');
select extensions.ok(public.health_check(), 'health check behavior is preserved');

delete from auth.users where id = :'test_user_id';
select * from extensions.finish();
