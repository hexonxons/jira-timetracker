import type { Dataset } from "./types";

export class ApiError extends Error {
  constructor(public errors: string[]) {
    super(errors.join("; "));
  }
}

async function call<T>(method: string, url: string, body?: unknown): Promise<T> {
  let response: Response;
  try {
    response = await fetch(url, {
      method,
      headers: body === undefined ? undefined : { "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    throw new ApiError(["Cannot reach the local backend. Is it running?"]);
  }
  const data = await response.json().catch(() => null);
  if (!response.ok) {
    const errors = data?.detail?.errors;
    throw new ApiError(Array.isArray(errors) ? errors : [`HTTP ${response.status}`]);
  }
  return data as T;
}

/** Instance configuration (from the server's environment; read-only here). */
export interface PublicSettings {
  configErrors: string[];
  jiraUrl: string;
  hasPat: boolean;
  sdTrackFieldName: string;
  hoursPerPersonDay: number;
  teamsConfig: unknown;
}

export interface TeamsSummary {
  teams: { name: string; users: string[] }[];
}

export interface ConnectionInfo {
  user: string;
  timeZone?: string;
  sdTrackField: { id: string; name: string };
}

export interface ReportJob {
  id: string;
  status: "running" | "done" | "failed";
  progress: { stage: string; done: number; total: number } | null;
  errors: string[];
  dataset: Dataset | null;
}

export const api = {
  getSettings: () => call<PublicSettings>("GET", "/api/settings"),
  testConnection: () => call<ConnectionInfo>("POST", "/api/settings/test"),
  validateTeams: (config: unknown) => call<TeamsSummary>("POST", "/api/teams/validate", config),
  startReport: (start: string, end: string, teams?: unknown) =>
    call<{ id: string }>("POST", "/api/reports", { start, end, teams: teams ?? null }),
  getReport: (id: string) => call<ReportJob>("GET", `/api/reports/${id}`),
};
