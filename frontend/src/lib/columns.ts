// Calendar columns: single days, or days grouped into weeks / months for long periods.
import { dayColumn, periodDays, visibleDays, weekOf, type DayColumn } from "./calendar";

export type ColumnMode = "day" | "week" | "month";

export interface Column {
  key: string;
  label: string; // "Sep 3", "Sep 7–13", "Sep"
  sub: string; // "Thu", "W37", "2026"
  dates: string[];
  /** Set for single-day columns only: daily highlighting applies to them. */
  day?: DayColumn;
  weekend: boolean;
  /** Heavier left border: a new week (days), month (weeks) or year (months). */
  boundary: boolean;
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** ISO 8601 week number. */
function isoWeek(iso: string): number {
  const d = new Date(`${iso}T00:00:00Z`);
  const thursday = new Date(d.getTime() + (3 - ((d.getUTCDay() + 6) % 7)) * 86_400_000);
  const firstJan = Date.UTC(thursday.getUTCFullYear(), 0, 1);
  return Math.floor((thursday.getTime() - firstJan) / 86_400_000 / 7) + 1;
}

/** Days for up to ~6 weeks, weeks up to ~6 months, months beyond. */
export function defaultColumnMode(start: string, end: string): ColumnMode {
  const days = periodDays(start, end).length;
  return days <= 45 ? "day" : days <= 190 ? "week" : "month";
}

function group(dates: string[], keyOf: (d: string) => string): [string, string[]][] {
  const groups = new Map<string, string[]>();
  for (const d of dates) {
    const k = keyOf(d);
    groups.set(k, [...(groups.get(k) ?? []), d]);
  }
  return [...groups.entries()];
}

export function buildColumns(start: string, end: string, datesWithTime: Set<string>, mode: ColumnMode): Column[] {
  if (mode === "day") {
    return visibleDays(start, end, datesWithTime).map((d) => ({
      key: d.date,
      label: d.label,
      sub: d.weekday,
      dates: [d.date],
      day: d,
      weekend: d.weekend,
      boundary: d.weekStart,
    }));
  }
  const all = periodDays(start, end);
  if (mode === "week") {
    return group(all, weekOf).map(([key, dates], i, arr) => {
      const first = dayColumn(dates[0]);
      const last = dayColumn(dates[dates.length - 1]);
      const sameMonth = dates[0].slice(5, 7) === dates[dates.length - 1].slice(5, 7);
      const label =
        dates.length === 1 ? first.label : sameMonth ? `${first.label}–${last.label.split(" ")[1]}` : `${first.label} – ${last.label}`;
      return {
        key,
        label,
        sub: `W${isoWeek(dates[0])}`,
        dates,
        weekend: false,
        boundary: i > 0 && dates[0].slice(0, 7) !== arr[i - 1][1][0].slice(0, 7),
      };
    });
  }
  return group(all, (d) => d.slice(0, 7)).map(([key, dates], i, arr) => ({
    key,
    label: MONTHS[Number(key.slice(5, 7)) - 1],
    sub: key.slice(0, 4),
    dates,
    weekend: false,
    boundary: i > 0 && key.slice(0, 4) !== arr[i - 1][0].slice(0, 4),
  }));
}

/** Sum of a per-day map over a column's dates. */
export function columnValue(byDay: Map<string, number> | undefined, col: Column): number {
  if (!byDay) return 0;
  let s = 0;
  for (const d of col.dates) s += byDay.get(d) ?? 0;
  return s;
}
