export type Location = {
  id: string;
  latitude: number;
  longitude: number;
  timezone: string;
};
export type LocationGroup = {
  key: string;
  latitude: number;
  longitude: number;
  timezone: string;
  locations: Location[];
};
export type NormalizedDailyForecast = {
  targetDate: string;
  temperatureMin: number | null;
  temperatureMax: number | null;
  precipitationSum: number | null;
  precipitationProbability: number | null;
  windSpeedMax: number | null;
  weatherCode: number | null;
};
export type ForecastProviderErrorCode =
  | "timeout"
  | "network"
  | "rate_limited"
  | "provider_5xx"
  | "invalid_request"
  | "invalid_location"
  | "invalid_timezone"
  | "response_contract"
  | "unknown";

export class ProviderError extends Error {
  constructor(
    public code: ForecastProviderErrorCode,
    public retryable: boolean,
    public retryAfterMs?: number,
  ) {
    super(code);
    this.name = "ProviderError";
  }
}
