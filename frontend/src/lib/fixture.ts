import type { Dataset, Worklog } from "../types";

const H = 3600;
let nextId = 1;
const wl = (username: string, issueKey: string, date: string, hours: number): Worklog => ({
  id: String(nextId++),
  username,
  issueKey,
  date,
  started: `${date}T10:00:00.000+0300`,
  seconds: hours * H,
  comment: "",
});

/** Small dataset for unit tests: Sep 2026, Sep 5-6 is a weekend. */
export const fixture: Dataset = {
  meta: {
    start: "2026-09-01",
    end: "2026-09-07",
    generatedAt: "2026-09-08T00:00:00Z",
    jiraUrl: "https://jira",
    hoursPerPersonDay: 8,
    sdTrackField: { id: "customfield_1", name: "SD Track" },
    warnings: [],
  },
  teams: [
    {
      name: "Sensors",
      members: [
        { username: "bob", displayName: "Bob Jones" },
        { username: "alice", displayName: "Alice Smith" },
      ],
    },
    { name: "DevOps", members: [{ username: "dave", displayName: "David Green" }] },
    { name: "Empty", members: [] },
  ],
  issues: {
    "SDS-10": { key: "SDS-10", summary: "Driver", sdTrack: "Platform Migration", url: "https://jira/browse/SDS-10" },
    "SDS-9": { key: "SDS-9", summary: "Timestamps", sdTrack: "Monitoring", url: "https://jira/browse/SDS-9" },
    "DEV-1": { key: "DEV-1", summary: "CI", sdTrack: null, url: "https://jira/browse/DEV-1" },
  },
  worklogs: [
    wl("alice", "SDS-10", "2026-09-01", 5),
    wl("alice", "SDS-9", "2026-09-01", 3),
    wl("alice", "SDS-10", "2026-09-02", 2),
    wl("alice", "SDS-10", "2026-09-02", 1.5),
    wl("bob", "DEV-1", "2026-09-06", 2), // Sunday
    wl("dave", "SDS-10", "2026-09-03", 8),
  ],
};
