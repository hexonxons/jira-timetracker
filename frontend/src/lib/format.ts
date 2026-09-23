export type Unit = "hours" | "personDays";

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

export function formatValue(seconds: number, unit: Unit, hoursPerPersonDay: number): string {
  return unit === "hours" ? formatDuration(seconds) : formatPersonDays(seconds, hoursPerPersonDay);
}

export function formatPercent(part: number, whole: number): string {
  return whole === 0 ? "" : `${Math.round((part / whole) * 100)}%`;
}
