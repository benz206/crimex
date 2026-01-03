const TORONTO_TZ = "America/Toronto";

function assertFinite(n: number, name: string) {
  if (!Number.isFinite(n)) throw new Error(`${name} must be a finite number`);
}

function getTimeZoneOffsetMs(utcDate: Date, timeZone: string): number {
  const dtf = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  });
  const parts = dtf.formatToParts(utcDate);
  const get = (t: Intl.DateTimeFormatPartTypes) =>
    parts.find((p) => p.type === t)?.value ?? "";
  const y = Number(get("year"));
  const mo = Number(get("month"));
  const da = Number(get("day"));
  const h = Number(get("hour"));
  const mi = Number(get("minute"));
  const s = Number(get("second"));
  const asUtc = Date.UTC(y, mo - 1, da, h, mi, s);
  return asUtc - utcDate.getTime();
}

function zonedDateTimeToUtcMs(input: {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
  timeZone: string;
}) {
  const utcGuess = Date.UTC(
    input.year,
    input.month - 1,
    input.day,
    input.hour,
    input.minute,
    input.second,
  );
  const guessDate = new Date(utcGuess);
  const offset1 = getTimeZoneOffsetMs(guessDate, input.timeZone);
  const utc1 = utcGuess - offset1;
  const correctedDate = new Date(utc1);
  const offset2 = getTimeZoneOffsetMs(correctedDate, input.timeZone);
  return utcGuess - offset2;
}

function pad2(n: number) {
  return String(n).padStart(2, "0");
}

export function formatTorontoDatetimeLocal(ms: number) {
  assertFinite(ms, "ms");
  const d = new Date(ms);
  if (Number.isNaN(d.getTime())) throw new Error("Invalid date");
  const dtf = new Intl.DateTimeFormat("en-CA", {
    timeZone: TORONTO_TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  });
  const parts = dtf.formatToParts(d);
  const get = (t: Intl.DateTimeFormatPartTypes) =>
    parts.find((p) => p.type === t)?.value ?? "";
  const y = get("year");
  const mo = get("month");
  const da = get("day");
  const h = get("hour");
  const mi = get("minute");
  if (![y, mo, da, h, mi].every(Boolean)) throw new Error("Invalid date");
  return `${y}-${mo}-${da}T${h}:${mi}`;
}

export function parseTorontoDatetimeLocalToMs(value: string): number | null {
  const v = String(value ?? "").trim();
  const m =
    /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2}))?$/.exec(v);
  if (!m) return null;
  const year = Number(m[1]);
  const month = Number(m[2]);
  const day = Number(m[3]);
  const hour = Number(m[4]);
  const minute = Number(m[5]);
  const second = Number(m[6] ?? "0");
  if (
    !Number.isFinite(year) ||
    !Number.isFinite(month) ||
    !Number.isFinite(day) ||
    !Number.isFinite(hour) ||
    !Number.isFinite(minute) ||
    !Number.isFinite(second)
  )
    return null;
  if (month < 1 || month > 12) return null;
  if (day < 1 || day > 31) return null;
  if (hour < 0 || hour > 23) return null;
  if (minute < 0 || minute > 59) return null;
  if (second < 0 || second > 59) return null;

  const utcMs = zonedDateTimeToUtcMs({
    year,
    month,
    day,
    hour,
    minute,
    second,
    timeZone: TORONTO_TZ,
  });
  const d = new Date(utcMs);
  if (Number.isNaN(d.getTime())) return null;
  return utcMs;
}

export function msToTorontoDayBoundsUtcMs(dateMs: number): {
  startMs: number;
  endMs: number;
} {
  assertFinite(dateMs, "dateMs");
  const d = new Date(dateMs);
  if (Number.isNaN(d.getTime())) throw new Error("Invalid date");
  const dtf = new Intl.DateTimeFormat("en-CA", {
    timeZone: TORONTO_TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  const parts = dtf.formatToParts(d);
  const get = (t: Intl.DateTimeFormatPartTypes) =>
    parts.find((p) => p.type === t)?.value ?? "";
  const y = Number(get("year"));
  const mo = Number(get("month"));
  const da = Number(get("day"));
  const startMs = zonedDateTimeToUtcMs({
    year: y,
    month: mo,
    day: da,
    hour: 0,
    minute: 0,
    second: 0,
    timeZone: TORONTO_TZ,
  });
  const endMs = zonedDateTimeToUtcMs({
    year: y,
    month: mo,
    day: da,
    hour: 23,
    minute: 59,
    second: 59,
    timeZone: TORONTO_TZ,
  });
  return { startMs, endMs };
}

export function formatUtcMsForDatetimeLocalValue(ms: number) {
  assertFinite(ms, "ms");
  const d = new Date(ms);
  if (Number.isNaN(d.getTime())) throw new Error("Invalid date");
  return `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}-${pad2(
    d.getUTCDate(),
  )}T${pad2(d.getUTCHours())}:${pad2(d.getUTCMinutes())}`;
}


