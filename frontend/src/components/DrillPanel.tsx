import { useEffect, useMemo, useState } from "react";
import { compareIssueKeys, compareMembers, groupBy, sumSeconds, type Entry } from "../lib/aggregate";
import { formatLongDate } from "../lib/calendar";
import { formatDuration, formatPersonDays } from "../lib/format";
import { IssueLink } from "./IssueLink";

export interface DrillTarget {
  /** Row path, e.g. ["Sensors", "Platform Migration"]. */
  path: string[];
  /** A single day, or undefined for the whole period. */
  date?: string;
  entries: Entry[];
  /** Offer grouping by day first (summary cells and row totals). */
  allowByDay?: boolean;
}

type Level = "day" | "employee" | "issue";

export function DrillPanel({
  target,
  hoursPerPersonDay,
  onClose,
}: {
  target: DrillTarget;
  hoursPerPersonDay: number;
  onClose: () => void;
}) {
  const [byDay, setByDay] = useState(false);
  useEffect(() => setByDay(false), [target]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const total = sumSeconds(target.entries);
  const people = new Set(target.entries.map((e) => e.member.username)).size;
  const tracks = new Set(target.entries.map((e) => e.track)).size;
  const levels = useMemo<Level[]>(() => {
    const l: Level[] = [];
    if (byDay && !target.date) l.push("day");
    if (people > 1) l.push("employee");
    l.push("issue");
    return l;
  }, [byDay, target.date, people]);

  return (
    <aside className="drill" aria-label="Details">
      <header className="drill-head">
        <div>
          <div className="drill-path">{target.path.join(" › ") || "All"}</div>
          <div className="drill-sub">
            {target.date ? formatLongDate(target.date) : "Whole period"}
            {people === 1 && target.entries[0] && !target.path.includes(target.entries[0].member.displayName)
              ? ` · ${target.entries[0].member.displayName}`
              : ""}
          </div>
        </div>
        <button className="icon-btn" onClick={onClose} aria-label="Close">
          ×
        </button>
      </header>
      <div className="drill-total">
        <span className="big">{formatDuration(total) || "0h"}</span>
        <span className="muted">{formatPersonDays(total, hoursPerPersonDay) || "0.00"} person-days</span>
      </div>
      {!target.date && target.allowByDay && (
        <div className="segmented small">
          <button className={!byDay ? "on" : ""} onClick={() => setByDay(false)}>
            By employee
          </button>
          <button className={byDay ? "on" : ""} onClick={() => setByDay(true)}>
            By day
          </button>
        </div>
      )}
      <div className="drill-body">
        <Groups entries={target.entries} levels={levels} showTrack={tracks > 1 || !target.path.length} total={total} />
      </div>
    </aside>
  );
}

function Groups({
  entries,
  levels,
  showTrack,
  total,
}: {
  entries: Entry[];
  levels: Level[];
  showTrack: boolean;
  total: number;
}) {
  const [level, ...rest] = levels;
  if (level === "issue") return <IssueList entries={entries} showTrack={showTrack} />;

  const groups = [...groupBy(entries, (e) => (level === "day" ? e.date : e.member.username)).entries()];
  if (level === "day") groups.sort(([a], [b]) => a.localeCompare(b));
  else groups.sort(([, a], [, b]) => compareMembers(a[0].member, b[0].member));

  return (
    <div className="drill-groups">
      {groups.map(([key, list]) => {
        const seconds = sumSeconds(list);
        return (
          <details key={key} open={groups.length <= 12}>
            <summary>
              <span className="drill-group-label">
                {level === "day" ? formatLongDate(key) : list[0].member.displayName}
              </span>
              <span className="num">{formatDuration(seconds)}</span>
              <span className="muted pct">{total ? `${Math.round((seconds / total) * 100)}%` : ""}</span>
            </summary>
            <div className="drill-nested">
              <Groups entries={list} levels={rest} showTrack={showTrack} total={seconds} />
            </div>
          </details>
        );
      })}
    </div>
  );
}

function IssueList({ entries, showTrack }: { entries: Entry[]; showTrack: boolean }) {
  const issues = [...groupBy(entries, (e) => e.issue.key).entries()].sort(([a], [b]) => compareIssueKeys(a, b));
  return (
    <ul className="issue-list">
      {issues.map(([key, list]) => (
        <IssueRow key={key} entries={list} showTrack={showTrack} />
      ))}
    </ul>
  );
}

function IssueRow({ entries, showTrack }: { entries: Entry[]; showTrack: boolean }) {
  const [open, setOpen] = useState(false);
  const issue = entries[0].issue;
  const multiDay = new Set(entries.map((e) => e.date)).size > 1;
  const sorted = [...entries].sort((a, b) => a.started.localeCompare(b.started));
  return (
    <li>
      <div className="issue-row">
        <button className="caret" onClick={() => setOpen(!open)} aria-expanded={open} title="Show worklogs">
          {open ? "▾" : "▸"}
        </button>
        <IssueLink issue={issue} />
        <span className="issue-summary" title={issue.summary}>
          {issue.summary}
          {showTrack && <span className="chip">{entries[0].track}</span>}
        </span>
        <span className="num">{formatDuration(sumSeconds(entries))}</span>
      </div>
      {open && (
        <table className="worklogs">
          <tbody>
            {sorted.map((e) => (
              <tr key={e.id}>
                <td className="muted nowrap">
                  {multiDay ? `${e.date.slice(5)} ` : ""}
                  {e.started.slice(11, 16)}
                </td>
                <td className="muted nowrap">{e.member.displayName.split(" ")[0]}</td>
                <td className="num nowrap">{formatDuration(e.seconds)}</td>
                <td className="comment">{e.comment || <span className="muted">—</span>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </li>
  );
}
