begin;

revoke all on function public.get_forecast_collection_health(timestamptz)
from public, anon, authenticated;
grant execute on function public.get_forecast_collection_health(timestamptz)
to service_role;

commit;
