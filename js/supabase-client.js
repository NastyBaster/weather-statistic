import { appConfig, hasSupabaseConfig } from "./config.js";

let clientPromise;

export function getSupabaseClient() {
  if (!hasSupabaseConfig()) {
    throw new Error("Supabase configuration is missing");
  }

  if (!clientPromise) {
    clientPromise = import("https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm").then(
      ({ createClient }) =>
        createClient(appConfig.supabaseUrl, appConfig.supabasePublishableKey, {
          auth: {
            persistSession: true,
            autoRefreshToken: true,
            detectSessionInUrl: true,
          },
        }),
    );
  }

  return clientPromise;
}
