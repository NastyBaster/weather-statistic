const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export function localDate(instant: Date, timezone: string): string {
  if (!Number.isFinite(instant.getTime())) throw new Error("invalid instant");
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(instant);
  const get = (type: string) => parts.find((part) => part.type === type)?.value;
  const result = `${get("year")}-${get("month")}-${get("day")}`;
  if (!ISO_DATE.test(result)) throw new Error("invalid local date");
  return result;
}

export function calendarDays(from: string, to: string): number {
  if (!ISO_DATE.test(from) || !ISO_DATE.test(to)) {
    throw new Error("invalid date");
  }
  return (
    (Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) /
    86_400_000
  );
}
