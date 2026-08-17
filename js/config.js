const runtimeConfig = globalThis.__APP_CONFIG__ ?? {};

export const appConfig = Object.freeze({
  environment: runtimeConfig.environment || "local",
  supabaseUrl: runtimeConfig.supabaseUrl || "",
  supabasePublishableKey: runtimeConfig.supabasePublishableKey || "",
});

export function hasSupabaseConfig() {
  return Boolean(appConfig.supabaseUrl && appConfig.supabasePublishableKey);
}
