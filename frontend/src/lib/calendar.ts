// Dates are handled as ISO strings (YYYY-MM-DD) and computed in UTC to stay timezone-agnostic.

const MS_PER_DAY = 86_400_000;
const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export interface DayColumn {
  date: string;
  weekday: string;
  label: string; // "Sep 3"
  weekend: boolean;
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
  };
}

/** Calendar columns: working days, plus weekend days only when someone logged time on them. */
export function visibleDays(start: string, end: string, datesWithTime: Set<string>): DayColumn[] {
  return periodDays(start, end)
    .map(dayColumn)
    .filter((c) => !c.weekend || datesWithTime.has(c.date));
}

export function formatLongDate(iso: string): string {
  const c = dayColumn(iso);
  return `${c.weekday}, ${c.label} ${iso.slice(0, 4)}`;
}
