import type { Dataset, Issue, Member } from "../types";

export const NO_TRACK = "<no SD Track>";

/** A worklog joined with its team (from the config), employee and issue (with its current SD Track). */
export interface Entry {
  id: string;
  date: string;
  started: string;
  seconds: number;
  comment: string;
  team: string;
  member: Member;
  issue: Issue;
  track: string;
}

export type Dim = "team" | "employee" | "track" | "issue";

export interface RowNode {
  id: string;
  dim: Dim;
  key: string;
  label: string;
  depth: number;
  children: RowNode[];
  entries: Entry[];
  byDay: Map<string, number>;
  total: number;
  issue?: Issue;
  member?: Member;
  /** Labels of this node and its ancestors, root first. */
  path: string[];
}

export function enrich(ds: Dataset): Entry[] {
  const members = new Map<string, { team: string; member: Member }>();
  for (const team of ds.teams) for (const m of team.members) members.set(m.username, { team: team.name, member: m });
  const entries: Entry[] = [];
  for (const w of ds.worklogs) {
    const who = members.get(w.username);
    const issue = ds.issues[w.issueKey];
    if (!who || !issue) continue; // the backend only emits configured people and loaded issues
    entries.push({
      id: w.id,
      date: w.date,
      started: w.started,
      seconds: w.seconds,
      comment: w.comment,
      team: who.team,
      member: who.member,
      issue,
      track: issue.sdTrack ?? NO_TRACK,
    });
  }
  return entries;
}

export function keyOf(e: Entry, dim: Dim): string {
  switch (dim) {
    case "team":
      return e.team;
    case "employee":
      return e.member.username;
    case "track":
      return e.track;
    case "issue":
      return e.issue.key;
  }
}

export function sumSeconds(entries: Entry[]): number {
  let s = 0;
  for (const e of entries) s += e.seconds;
  return s;
}

export function groupBy<K>(entries: Entry[], key: (e: Entry) => K): Map<K, Entry[]> {
  const groups = new Map<K, Entry[]>();
  for (const e of entries) {
    const k = key(e);
    const list = groups.get(k);
    if (list) list.push(e);
    else groups.set(k, [e]);
  }
  return groups;
}

export function compareTracks(a: string, b: string): number {
  if (a === b) return 0;
  if (a === NO_TRACK) return 1;
  if (b === NO_TRACK) return -1;
  return a.localeCompare(b);
}

/** Natural order of issue keys: project, then number (SDS-9 before SDS-10). */
export function compareIssueKeys(a: string, b: string): number {
  const [pa, na] = a.split("-");
  const [pb, nb] = b.split("-");
  return pa === pb ? Number(na) - Number(nb) : pa.localeCompare(pb);
}

export function compareMembers(a: Member, b: Member): number {
  return a.displayName.localeCompare(b.displayName);
}

/**
 * Builds the calendar row hierarchy for the given grouping dimensions.
 *
 * Teams and their configured members are always present (even without worklogs),
 * so people who logged nothing are visible as empty rows.
 */
export function buildTree(ds: Dataset, entries: Entry[], dims: Dim[]): RowNode[] {
  const teamOrder = ds.teams.map((t) => t.name);
  const membersByTeam = new Map(ds.teams.map((t) => [t.name, t.members]));

  function build(list: Entry[], level: number, parent: RowNode | null): RowNode[] {
    if (level >= dims.length) return [];
    const dim = dims[level];
    const groups = groupBy(list, (e) => keyOf(e, dim));
    const sample = (k: string) => groups.get(k)?.[0];

    let keys: string[];
    let memberOf = new Map<string, Member>();
    if (dim === "team" && level === 0) {
      keys = teamOrder;
    } else if (dim === "employee" && parent?.dim === "team") {
      const members = [...(membersByTeam.get(parent.key) ?? [])].sort(compareMembers);
      memberOf = new Map(members.map((m) => [m.username, m]));
      keys = members.map((m) => m.username);
    } else {
      keys = [...groups.keys()];
      if (dim === "team") keys.sort((a, b) => teamOrder.indexOf(a) - teamOrder.indexOf(b));
      if (dim === "track") keys.sort(compareTracks);
      if (dim === "issue") keys.sort(compareIssueKeys);
      if (dim === "employee") keys.sort((a, b) => compareMembers(sample(a)!.member, sample(b)!.member));
    }

    return keys.map((key) => {
      const own = groups.get(key) ?? [];
      const first = own[0];
      const member = dim === "employee" ? (memberOf.get(key) ?? first?.member) : undefined;
      const issue = dim === "issue" ? first?.issue : undefined;
      const label = dim === "employee" ? (member?.displayName ?? key) : key;
      const byDay = new Map<string, number>();
      for (const e of own) byDay.set(e.date, (byDay.get(e.date) ?? 0) + e.seconds);
      const node: RowNode = {
        id: `${parent?.id ?? ""}/${dim}:${key}`,
        dim,
        key,
        label,
        depth: level,
        children: [],
        entries: own,
        byDay,
        total: sumSeconds(own),
        issue,
        member,
        path: [...(parent?.path ?? []), label],
      };
      node.children = build(own, level + 1, node);
      return node;
    });
  }

  return build(entries, 0, null);
}

export function dailyTotals(entries: Entry[]): Map<string, number> {
  const totals = new Map<string, number>();
  for (const e of entries) totals.set(e.date, (totals.get(e.date) ?? 0) + e.seconds);
  return totals;
}

export function tracksOf(entries: Entry[]): string[] {
  return [...new Set(entries.map((e) => e.track))].sort(compareTracks);
}

/** Every node id down to the given depth (0 = only roots expanded). */
export function idsToDepth(nodes: RowNode[], depth: number): Set<string> {
  const ids = new Set<string>();
  const walk = (list: RowNode[]) => {
    for (const n of list) {
      if (n.depth < depth && n.children.length) {
        ids.add(n.id);
        walk(n.children);
      }
    }
  };
  walk(nodes);
  return ids;
}
