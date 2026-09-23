// Dataset produced by the backend (backend/jtt/loader.py). All reports are computed from it.

export interface Member {
  username: string;
  displayName: string;
}

export interface TeamRoster {
  name: string;
  members: Member[];
}

export interface Issue {
  key: string;
  summary: string;
  sdTrack: string | null;
  url: string;
}

export interface Worklog {
  id: string;
  username: string;
  issueKey: string;
  date: string; // YYYY-MM-DD, taken from `started` as Jira returns it
  started: string;
  seconds: number;
  comment: string;
}

export interface Meta {
  start: string;
  end: string;
  generatedAt: string;
  jiraUrl: string;
  hoursPerPersonDay: number;
  sdTrackField: { id: string; name: string };
  warnings: string[];
}

export interface Dataset {
  meta: Meta;
  teams: TeamRoster[];
  issues: Record<string, Issue>;
  worklogs: Worklog[];
}
