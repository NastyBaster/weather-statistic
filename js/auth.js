import { getSupabaseClient } from "./supabase-client.js";

export function loginUrl() {
  return new URL("login.html", globalThis.location.href).href;
}

export function dashboardUrl() {
  return new URL("index.html", globalThis.location.href).href;
}

export async function getCurrentSession() {
  const supabase = await getSupabaseClient();
  const { data, error } = await supabase.auth.getSession();
  if (error) throw error;
  return data.session;
}

export async function signUp(email, password) {
  const supabase = await getSupabaseClient();
  const { data, error } = await supabase.auth.signUp({
    email,
    password,
    options: { emailRedirectTo: dashboardUrl() },
  });
  if (error) throw error;
  return data;
}

export async function signIn(email, password) {
  const supabase = await getSupabaseClient();
  const { data, error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) throw error;
  return data;
}

export async function signInWithGoogle() {
  const supabase = await getSupabaseClient();
  const { data, error } = await supabase.auth.signInWithOAuth({
    provider: "google",
    options: {
      redirectTo: dashboardUrl(),
      queryParams: { prompt: "select_account" },
    },
  });
  if (error) throw error;
  return data;
}

export async function signOut() {
  const supabase = await getSupabaseClient();
  const { error } = await supabase.auth.signOut();
  if (error) throw error;
}

export async function requestPasswordReset(email) {
  const supabase = await getSupabaseClient();
  const redirectTo = new URL("reset-password.html", globalThis.location.href).href;
  const { error } = await supabase.auth.resetPasswordForEmail(email, { redirectTo });
  if (error) throw error;
}

export async function updatePassword(password) {
  const supabase = await getSupabaseClient();
  const { error } = await supabase.auth.updateUser({ password });
  if (error) throw error;
}

export async function onAuthStateChange(callback) {
  const supabase = await getSupabaseClient();
  return supabase.auth.onAuthStateChange(callback);
}
