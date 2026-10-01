/** "percent" shows a share of the team's logged time instead of an amount. */
export type Unit = "hours" | "personDays" | "percent";

export const UNITS: Unit[] = ["hours", "personDays", "percent"];

/** The amount unit to use where a share makes no sense (drill-down details, chips). */
export function amountUnit(unit: Unit): Exclude<Unit, "percent"> {
  return unit === "percent" ? "hours" : unit;
}

/** "7h 30m", "8h", "45m"; empty string for zero (empty cells never show 0h). */
export function formatDuration(seconds: number): string {
  const minutes = Math.round(seconds / 60);
  if (minutes === 0) return "";
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (h === 0) return `${m}m`;
  return m === 0 ? `${h}h` : `${h}h ${m}m`;
}

export function personDays(seconds: number, hoursPerPersonDay: number): number {
  return seconds / 3600 / hoursPerPersonDay;
}

export function formatPersonDays(seconds: number, hoursPerPersonDay: number): string {
  if (seconds === 0) return "";
  return personDays(seconds, hoursPerPersonDay).toFixed(2);
}

/** "12.5%", "100%"; empty string for zero. */
export function formatShare(part: number, whole: number): string {
  if (part === 0 || whole === 0) return "";
  return `${(Math.round((part / whole) * 1000) / 10).toFixed(1).replace(/\.0$/, "")}%`;
}

/**
 * A value in the chosen unit. `whole` is the denominator for "percent"
 * (the team's logged time in the same scope); amounts ignore it.
 */
export function formatValue(seconds: number, unit: Unit, hoursPerPersonDay: number, whole = 0): string {
  if (unit === "percent") return formatShare(seconds, whole);
  return unit === "hours" ? formatDuration(seconds) : formatPersonDays(seconds, hoursPerPersonDay);
}

export function formatPercent(part: number, whole: number): string {
  return whole === 0 ? "" : `${Math.round((part / whole) * 100)}%`;
}
