// One JSON file for everything a user configures:
//   {"teams": [...], "vacations": [...], "highlight": {"min": 6, "max": 11}}
// Every section is optional on upload; only the sections present are applied.
// The same format works as the instance default (JTT_TEAMS_FILE on the server).
import type { DayRange } from "./highlight";
import type { TeamsConfig } from "./teamsEdit";
import { parseVacations, sortVacations, type Vacation } from "./vacations";

export function isRange(v: unknown): v is DayRange {
  const r = v as DayRange | null;
  return (
    typeof r?.min === "number" &&
    isFinite(r.min) &&
    r.min >= 0 &&
    r.min <= 24 &&
    (r.max === null || (typeof r.max === "number" && isFinite(r.max) && r.max >= r.min && r.max <= 24))
  );
}

export interface ParsedWorkspace {
  /** Raw {"teams": [...]} to be validated by the server, if the file has teams. */
  teams?: { teams: unknown };
  vacations?: Vacation[];
  highlight?: DayRange | null;
  errors: string[];
}

export function parseWorkspace(raw: unknown): ParsedWorkspace {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    return { errors: ['Expected a JSON object with "teams", "vacations" and/or "highlight".'] };
  }
  const obj = raw as Record<string, unknown>;
  const result: ParsedWorkspace = { errors: [] };
  if ("teams" in obj) result.teams = { teams: obj.teams };
  if ("vacations" in obj) {
    const parsed = parseVacations({ vacations: obj.vacations });
    result.errors.push(...parsed.errors);
    result.vacations = parsed.vacations;
  }
  if ("highlight" in obj) {
    const h = obj.highlight as { min?: unknown; max?: unknown } | null;
    const range = h === null ? null : { min: h?.min, max: h?.max ?? null };
    if (range === null || isRange(range)) result.highlight = range as DayRange | null;
    else result.errors.push('"highlight" must be {"min": hours, "max": hours or null} with 0 ≤ min ≤ max ≤ 24.');
  }
  if (!("teams" in obj) && !("vacations" in obj) && !("highlight" in obj)) {
    result.errors.push('The file has none of "teams", "vacations", "highlight".');
  }
  return result;
}

export function workspaceJson(teams: TeamsConfig, vacations: Vacation[], highlight: DayRange | null): string {
  const data: Record<string, unknown> = { teams: teams.teams, vacations: sortVacations(vacations) };
  if (highlight) data.highlight = highlight;
  return JSON.stringify(data, null, 2) + "\n";
}

/** Vacations and highlighting the instance default config may carry next to its teams. */
export function instanceDefaults(config: unknown): { vacations: Vacation[] | null; highlight: DayRange | null } {
  const parsed = config ? parseWorkspace(config) : null;
  return {
    vacations: parsed?.vacations && !parsed.errors.length ? parsed.vacations : null,
    highlight: parsed?.highlight && isRange(parsed.highlight) ? parsed.highlight : null,
  };
}
