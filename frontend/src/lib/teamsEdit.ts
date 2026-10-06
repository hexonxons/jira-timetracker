// Editing a team config in the browser. Mirrors the server's rules (backend/jtt/teams.py):
// non-empty unique team names, each user in exactly one team (case-insensitive).

export interface TeamsConfig {
  teams: { name: string; users: string[] }[];
}

export function normalizeTeams(raw: unknown): TeamsConfig {
  const teams = (raw as TeamsConfig | null)?.teams;
  if (!Array.isArray(teams)) return { teams: [] };
  return {
    teams: teams.map((t) => ({
      name: String(t?.name ?? ""),
      users: Array.isArray(t?.users) ? t.users.map(String) : [],
    })),
  };
}

export function teamOfUser(config: TeamsConfig, user: string): string | null {
  const key = user.trim().toLowerCase();
  return config.teams.find((t) => t.users.some((u) => u.toLowerCase() === key))?.name ?? null;
}

export class EditError extends Error {}

export function addUser(config: TeamsConfig, team: string, user: string): TeamsConfig {
  const name = user.trim();
  if (!name) throw new EditError("Enter a Jira username.");
  const owner = teamOfUser(config, name);
  if (owner) throw new EditError(`"${name}" is already in team "${owner}". A user can be in one team only.`);
  return { teams: config.teams.map((t) => (t.name === team ? { ...t, users: [...t.users, name] } : t)) };
}

export function removeUser(config: TeamsConfig, team: string, user: string): TeamsConfig {
  return { teams: config.teams.map((t) => (t.name === team ? { ...t, users: t.users.filter((u) => u !== user) } : t)) };
}

export function addTeam(config: TeamsConfig, team: string): TeamsConfig {
  const name = team.trim();
  if (!name) throw new EditError("Enter a team name.");
  if (config.teams.some((t) => t.name === name)) throw new EditError(`Team "${name}" already exists.`);
  return { teams: [...config.teams, { name, users: [] }] };
}

export function removeTeam(config: TeamsConfig, team: string): TeamsConfig {
  return { teams: config.teams.filter((t) => t.name !== team) };
}

export function teamsJson(config: TeamsConfig): string {
  return JSON.stringify(config, null, 2) + "\n";
}
