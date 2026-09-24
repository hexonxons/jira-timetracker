// Dates are handled as ISO strings (YYYY-MM-DD) and computed in UTC to stay timezone-agnostic.

const MS_PER_DAY = 86_400_000;
const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export interface DayColumn {
  date: string;
  weekday: string;
  label: string; // "Sep 3"
  weekend: boolean;
  /** First visible column of a new Monday-based week (not set on the very first column). */
  weekStart: boolean;
}

function toUtc(iso: string): number {
  const [y, m, d] = iso.split("-").map(Number);
  return Date.UTC(y, m - 1, d);
}

function toIso(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

export function periodDays(start: string, end: string): string[] {
  const days: string[] = [];
  for (let t = toUtc(start); t <= toUtc(end); t += MS_PER_DAY) days.push(toIso(t));
  return days;
}

export function dayColumn(iso: string): DayColumn {
  const d = new Date(toUtc(iso));
  const dow = d.getUTCDay();
  return {
    date: iso,
    weekday: WEEKDAYS[dow],
    label: `${MONTHS[d.getUTCMonth()]} ${d.getUTCDate()}`,
    weekend: dow === 0 || dow === 6,
    weekStart: false,
  };
}

/** Monday of the week containing the date, as an ISO date. */
export function weekOf(iso: string): string {
  const t = toUtc(iso);
  const sinceMonday = (new Date(t).getUTCDay() + 6) % 7;
  return toIso(t - sinceMonday * MS_PER_DAY);
}

/** Calendar columns: working days, plus weekend days only when someone logged time on them. */
export function visibleDays(start: string, end: string, datesWithTime: Set<string>): DayColumn[] {
  const days = periodDays(start, end)
    .map(dayColumn)
    .filter((c) => !c.weekend || datesWithTime.has(c.date));
  days.forEach((c, i) => {
    c.weekStart = i > 0 && weekOf(c.date) !== weekOf(days[i - 1].date);
  });
  return days;
}

/** Today's date in the browser's time zone, as an ISO date. */
export function todayIso(): string {
  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

export function formatLongDate(iso: string): string {
  const c = dayColumn(iso);
  return `${c.weekday}, ${c.label} ${iso.slice(0, 4)}`;
}
