// Which employee day cells get highlighted, and the norm for an employee's Total.
import { dayColumn, periodDays } from "./calendar";
import { isOnVacation, type VacationDays } from "./vacations";

/** Allowed hours logged per day; outside it a day is shown in red. `max` null = no upper limit. */
export interface DayRange {
  min: number;
  max: number | null;
}

export type DayMark = "vacation" | "under" | "over" | null;

/**
 * - vacation: a working day inside a vacation (green), whatever was logged;
 * - under: a past working day with less than `min` hours logged (nothing counts too);
 * - over: any day with more than `max` hours logged.
 */
export function dayMark(opts: {
  date: string;
  weekend: boolean;
  today: string;
  seconds: number;
  vacation: boolean;
  range: DayRange;
}): DayMark {
  const { date, weekend, today, seconds, vacation, range } = opts;
  if (vacation && !weekend) return "vacation";
  if (range.max !== null && seconds > range.max * 3600) return "over";
  if (!weekend && !vacation && date < today && seconds < range.min * 3600) return "under";
  return null;
}

/**
 * Working days (Mon–Fri) of the period that count toward an employee's norm: before today
 * (a day still in progress or in the future cannot be missed yet) and not on vacation.
 */
export function normDays(start: string, end: string, today: string, username: string, vacations: VacationDays) {
  let working = 0;
  let vacation = 0;
  for (const date of periodDays(start, end)) {
    if (dayColumn(date).weekend) continue;
    if (isOnVacation(vacations, username, date)) {
      vacation++;
      continue;
    }
    if (date < today) working++;
  }
  return { working, vacation };
}

export function rangeLabel(range: DayRange): string {
  return range.max === null ? `less than ${range.min}h` : `outside ${range.min}h–${range.max}h`;
}
