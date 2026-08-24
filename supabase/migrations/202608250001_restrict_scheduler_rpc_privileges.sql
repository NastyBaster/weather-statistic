begin;

revoke all on function public.insert_forecast_snapshot_batch(uuid, jsonb)
from public, anon, authenticated;
grant execute on function public.insert_forecast_snapshot_batch(uuid, jsonb)
to service_role;

revoke all on function public.claim_scheduled_forecast_run(integer)
from public, anon, authenticated;
grant execute on function public.claim_scheduled_forecast_run(integer)
to service_role;

revoke all on function public.finalize_forecast_run(uuid, text, integer, integer, integer, text)
from public, anon, authenticated;
grant execute on function public.finalize_forecast_run(uuid, text, integer, integer, integer, text)
to service_role;

revoke all on function public.guard_forecast_snapshot_parent_running()
from public, anon, authenticated;
revoke all on function public.reject_forecast_snapshot_update()
from public, anon, authenticated;
revoke all on function public.set_updated_at()
from public, anon, authenticated;
revoke all on function public.handle_new_user()
from public, anon, authenticated;

commit;
