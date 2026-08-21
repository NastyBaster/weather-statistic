import { getSupabaseClient } from "./supabase-client.js";

const FIELDS = "id,name,country_code,latitude,longitude,timezone,is_active,created_at,updated_at";

export class LocationError extends Error {
  constructor(message, code = "LOCATION_ERROR") {
    super(message);
    this.name = "LocationError";
    this.code = code;
  }
}

export function mapLocationError(error) {
  if (error?.code === "23505") {
    return new LocationError("Це місто вже є у вашому списку.", "DUPLICATE_LOCATION");
  }
  if (error instanceof LocationError) return error;
  return new LocationError("Не вдалося виконати дію. Спробуйте ще раз.");
}

function normalize(row) {
  return {
    id: row.id,
    name: row.name,
    countryCode: row.country_code,
    latitude: Number(row.latitude),
    longitude: Number(row.longitude),
    timezone: row.timezone,
    isActive: Boolean(row.is_active),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function createLocationsRepository(getClient = getSupabaseClient) {
  async function context() {
    const client = await getClient();
    const { data, error } = await client.auth.getUser();
    if (error || !data.user) throw new LocationError("Увійдіть, щоб керувати містами.", "AUTH_REQUIRED");
    return { client, user: data.user };
  }

  return {
    async getUserLocations() {
      const { client, user } = await context();
      const { data, error } = await client.from("locations").select(FIELDS).eq("user_id", user.id).order("name", { ascending: true });
      if (error) throw mapLocationError(error);
      return (data ?? []).map(normalize);
    },
    async createLocation(location) {
      const { client, user } = await context();
      const payload = {
        user_id: user.id,
        name: location.name,
        country_code: location.countryCode,
        latitude: location.latitude,
        longitude: location.longitude,
        timezone: location.timezone,
      };
      const { data, error } = await client.from("locations").insert(payload).select(FIELDS).single();
      if (error) throw mapLocationError(error);
      return normalize(data);
    },
    async setLocationActive(id, isActive) {
      const { client, user } = await context();
      const { data, error } = await client.from("locations").update({ is_active: Boolean(isActive) }).eq("id", id).eq("user_id", user.id).select(FIELDS).single();
      if (error) throw mapLocationError(error);
      return normalize(data);
    },
    async deleteLocation(id) {
      const { client, user } = await context();
      const { error } = await client.from("locations").delete().eq("id", id).eq("user_id", user.id);
      if (error) throw mapLocationError(error);
      return id;
    },
  };
}

const repository = createLocationsRepository();
export const getUserLocations = (...args) => repository.getUserLocations(...args);
export const createLocation = (...args) => repository.createLocation(...args);
export const setLocationActive = (...args) => repository.setLocationActive(...args);
export const deleteLocation = (...args) => repository.deleteLocation(...args);
