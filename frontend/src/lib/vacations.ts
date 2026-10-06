// Employee vacations: date ranges kept in the browser and exchanged as JSON:
//   {"vacations": [{"user": "alice", "from": "2026-09-10", "to": "2026-09-14"}]}
import { periodDays } from "./calendar";

export interface Vacation {
  user: string;
  from: string;
  to: string;
}

const ISO = /^\d{4}-\d{2}-\d{2}$/;

function validDate(s: unknown): s is string {
  if (typeof s !== "string" || !ISO.test(s)) return false;
  const d = new Date(`${s}T00:00:00Z`);
  return !isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}

/** Parses an uploaded vacations JSON; collects every problem instead of stopping at the first. */
export function parseVacations(raw: unknown): { vacations: Vacation[]; errors: string[] } {
  const list = Array.isArray(raw) ? raw : (raw as { vacations?: unknown } | null)?.vacations;
  if (!Array.isArray(list)) return { vacations: [], errors: ['Expected {"vacations": [{"user", "from", "to"}, ...]}.'] };
  const vacations: Vacation[] = [];
  const errors: string[] = [];
  list.forEach((item, i) => {
    const v = item as Partial<Vacation> | null;
    const where = `vacations[${i}]`;
    if (!v || typeof v.user !== "string" || !v.user.trim()) errors.push(`${where}: "user" must be a Jira username.`);
    else if (!validDate(v.from) || !validDate(v.to)) errors.push(`${where}: "from" and "to" must be dates like 2026-09-10.`);
    else if (v.to < v.from) errors.push(`${where}: "to" is before "from".`);
    else vacations.push({ user: v.user.trim(), from: v.from, to: v.to });
  });
  return { vacations: sortVacations(vacations), errors };
}

export function sortVacations(vacations: Vacation[]): Vacation[] {
  return [...vacations].sort((a, b) => a.user.localeCompare(b.user) || a.from.localeCompare(b.from));
}

export function vacationsJson(vacations: Vacation[]): string {
  return JSON.stringify({ vacations: sortVacations(vacations) }, null, 2) + "\n";
}

/** Lower-cased username -> set of vacation dates (calendar days, weekends included). */
export type VacationDays = Map<string, Set<string>>;

export function vacationDays(vacations: Vacation[]): VacationDays {
  const days: VacationDays = new Map();
  for (const v of vacations) {
    const key = v.user.toLowerCase();
    const set = days.get(key) ?? new Set<string>();
    for (const d of periodDays(v.from, v.to)) set.add(d);
    days.set(key, set);
  }
  return days;
}

export function isOnVacation(days: VacationDays, username: string, date: string): boolean {
  return days.get(username.toLowerCase())?.has(date) ?? false;
}
