import { useCallback, useMemo, useRef, useState, type CSSProperties, type PointerEvent } from "react";
import { buildTree, dailyTotals, idsToDepth, sumSeconds, type Dim, type Entry, type RowNode } from "../lib/aggregate";
import { todayIso } from "../lib/calendar";
import { columnValue, type Column, type ColumnMode } from "../lib/columns";
import { formatValue, type Unit } from "../lib/format";
import { dayMark, normDays, rangeLabel, type DayMark, type DayRange } from "../lib/highlight";
import { isOnVacation, type VacationDays } from "../lib/vacations";
import { readPref, writePref } from "../lib/prefs";
import type { Dataset } from "../types";
import { DrillPanel, type DrillTarget } from "./DrillPanel";
import { IssueLink } from "./IssueLink";
import { UnitToggle } from "./UnitToggle";

const markClass: Record<string, string> = { under: "short", over: "short", vacation: "vacation" };

const LABEL_WIDTH = { key: "jtt.labelWidth", default: 340, min: 160, max: 900 };
const clampWidth = (w: number) => Math.round(Math.min(LABEL_WIDTH.max, Math.max(LABEL_WIDTH.min, w)));

/** Width of the first (row label) column, shared by all calendar reports and remembered in the browser. */
function useLabelWidth() {
  const [width, setWidth] = useState(() =>
    readPref(LABEL_WIDTH.key, LABEL_WIDTH.default, (v): v is number => typeof v === "number" && isFinite(v)),
  );
  const drag = useRef<{ x: number; width: number } | null>(null);

  const onPointerDown = (e: PointerEvent<HTMLSpanElement>) => {
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    drag.current = { x: e.clientX, width };
  };
  const onPointerMove = (e: PointerEvent<HTMLSpanElement>) => {
    if (drag.current) setWidth(clampWidth(drag.current.width + e.clientX - drag.current.x));
  };
  const onPointerUp = (e: PointerEvent<HTMLSpanElement>) => {
    if (!drag.current) return;
    const final = clampWidth(drag.current.width + e.clientX - drag.current.x);
    drag.current = null;
    setWidth(final);
    writePref(LABEL_WIDTH.key, final);
  };
  const reset = () => {
    setWidth(LABEL_WIDTH.default);
    writePref(LABEL_WIDTH.key, LABEL_WIDTH.default);
  };
  return { width, handle: { onPointerDown, onPointerMove, onPointerUp, onPointerCancel: onPointerUp, onDoubleClick: reset } };
}

const DIM_NAMES: Record<Dim, string> = { team: "Teams", employee: "Employees", track: "SD Tracks", issue: "Issues" };

export function CalendarReport({
  dataset,
  entries,
  columns,
  columnMode,
  onColumnModeChange,
  dims,
  defaultDepth,
  hoursPerPersonDay,
  unit,
  onUnitChange,
  vacations,
  range,
}: {
  dataset: Dataset;
  entries: Entry[];
  columns: Column[];
  columnMode: ColumnMode;
  onColumnModeChange: (m: ColumnMode) => void;
  dims: Dim[];
  defaultDepth: number;
  hoursPerPersonDay: number;
  unit: Unit;
  onUnitChange: (u: Unit) => void;
  vacations: VacationDays;
  range: DayRange;
}) {
  const fmt = (seconds: number, whole = 0) => formatValue(seconds, unit, hoursPerPersonDay, whole);
  const personDay = hoursPerPersonDay * 3600;
  const today = todayIso();
  // An employee row holds the person's whole day only when no SD Track level sits above it.
  const employeeHasWholeDay = !dims.includes("track") || dims.indexOf("employee") < dims.indexOf("track");
  /**
   * Employee cells: vacation (green) in every view; red outside the allowed daily range only
   * where the employee row holds the person's whole day.
   */
  const markOf = (n: RowNode, c: Column, seconds: number): DayMark => {
    const d = c.day; // daily highlighting only in single-day columns
    if (!d || n.dim !== "employee" || !n.member) return null;
    const vacation = isOnVacation(vacations, n.member.username, d.date);
    const mark = dayMark({ date: d.date, weekend: d.weekend, today, seconds, vacation, range });
    return mark === "vacation" || employeeHasWholeDay ? mark : null;
  };
  /**
   * Employee Total vs the norm for the period: hours per person-day × working days before today,
   * minus vacation days. Only where the employee row holds the person's whole time.
   */
  const totalCheck = (n: RowNode) => {
    if (!employeeHasWholeDay || n.dim !== "employee" || !n.member) return null;
    const days = normDays(dataset.meta.start, dataset.meta.end, today, n.member.username, vacations);
    const norm = days.working * personDay;
    if (norm === 0 || n.total >= norm) return null;
    const hours = (s: number) => formatValue(s, "hours", hoursPerPersonDay) || "0h";
    return (
      `${hours(n.total)} logged, norm ${hours(norm)} (${days.working} working day(s) × ${hoursPerPersonDay}h` +
      `${days.vacation ? `, ${days.vacation} vacation day(s) excluded` : ""}); ${hours(norm - n.total)} short`
    );
  };
  const markTitle = (mark: DayMark, seconds: number) => {
    const logged = formatValue(seconds, "hours", hoursPerPersonDay) || "Nothing";
    if (mark === "vacation") return `Vacation${seconds ? ` (${logged} logged)` : ""}`;
    if (mark === "under") return `${logged} logged, less than ${range.min}h`;
    if (mark === "over") return `${logged} logged, more than ${range.max}h`;
    return undefined;
  };
  const labelWidth = useLabelWidth();
  const tree = useMemo(() => buildTree(dataset, entries, dims), [dataset, entries, dims]);
  const [expanded, setExpanded] = useState(() => idsToDepth(tree, defaultDepth));
  const [drill, setDrill] = useState<DrillTarget | null>(null);
  const closeDrill = useCallback(() => setDrill(null), []);

  const toggle = (id: string) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const rows: RowNode[] = [];
  const walk = (nodes: RowNode[]) => {
    for (const n of nodes) {
      rows.push(n);
      if (expanded.has(n.id)) walk(n.children);
    }
  };
  walk(tree);

  const totals = useMemo(() => dailyTotals(entries), [entries]);
  // Denominators for "% of team": every row's share is taken of its team's time in the same column.
  const teamOf = useMemo(() => new Map(tree.map((t) => [t.key, t])), [tree]);
  const teamNode = (n: RowNode) => teamOf.get(n.path[0]);
  const grandTotal = sumSeconds(entries);

  const open = (node: RowNode | null, col?: Column) => {
    const base = node ? node.entries : entries;
    const dates = col ? new Set(col.dates) : null;
    const list = dates ? base.filter((e) => dates.has(e.date)) : base;
    if (!list.length) return;
    const single = col?.dates.length === 1 ? col.dates[0] : undefined;
    setDrill({
      path: node ? node.path : [],
      date: single,
      periodLabel: col && !single ? `${col.label} ${col.sub}` : undefined,
      entries: list,
      allowByDay: !single,
    });
  };

  return (
    <div className={`report ${drill ? "with-drill" : ""}`}>
      <div className="toolbar">
        <span className="muted">Expand to:</span>
        <div className="segmented small">
          {dims.map((d, i) => (
            <button key={d} onClick={() => setExpanded(idsToDepth(tree, i))}>
              {DIM_NAMES[d]}
            </button>
          ))}
        </div>
        <span className="muted">Columns:</span>
        <div className="segmented small">
          {(["day", "week", "month"] as const).map((m) => (
            <button key={m} className={columnMode === m ? "on" : ""} onClick={() => onColumnModeChange(m)}>
              {m === "day" ? "Days" : m === "week" ? "Weeks" : "Months"}
            </button>
          ))}
        </div>
        <UnitToggle unit={unit} onChange={onUnitChange} hoursPerPersonDay={hoursPerPersonDay} />
        <span className="legend">
          {employeeHasWholeDay && (
            <>
              <span className="swatch short" />
              {columnMode === "day" ? `${rangeLabel(range)} a day; ` : ""}Total below the norm
            </>
          )}
          {columnMode === "day" && (
            <>
              <span className="swatch vacation" /> vacation
            </>
          )}
        </span>
      </div>
      <div className="calendar-wrap" style={{ "--label-width": `${labelWidth.width}px` } as CSSProperties}>
        <table className="calendar">
          <thead>
            <tr>
              <th className="sticky-col row-head">
                {dims.map((d) => DIM_NAMES[d]).join(" / ")}
                <span
                  className="col-resizer"
                  role="separator"
                  aria-orientation="vertical"
                  title="Drag to resize, double-click to reset"
                  {...labelWidth.handle}
                />
              </th>
              {columns.map((c) => (
                <th key={c.key} className={`day ${c.weekend ? "weekend" : ""} ${c.boundary ? "week-start" : ""}`}>
                  <div className="dow">{c.sub}</div>
                  <div className="nowrap">{c.label}</div>
                </th>
              ))}
              <th className="total-col">Total</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((n) => {
              const leaf = !n.children.length;
              return (
                <tr key={n.id} className={`depth-${n.depth} dim-${n.dim} ${n.total ? "" : "empty-row"}`}>
                  <th className="sticky-col row-label" scope="row">
                    <div className="label-inner" style={{ paddingLeft: n.depth * 18 }}>
                      {leaf ? (
                        <span className="caret-space" />
                      ) : (
                        <button className="caret" onClick={() => toggle(n.id)} aria-expanded={expanded.has(n.id)}>
                          {expanded.has(n.id) ? "▾" : "▸"}
                        </button>
                      )}
                      {n.issue ? (
                        <>
                          <IssueLink issue={n.issue} />
                          <span className="issue-summary" title={n.issue.summary}>
                            {n.issue.summary}
                          </span>
                        </>
                      ) : (
                        <span className="row-name" title={n.label}>
                          {n.label}
                        </span>
                      )}
                    </div>
                  </th>
                  {columns.map((c) => {
                    const v = columnValue(n.byDay, c);
                    const mark = markOf(n, c, v);
                    return (
                      <td
                        key={c.key}
                        className={`cell ${c.weekend ? "weekend" : ""} ${c.boundary ? "week-start" : ""} ${v ? "has" : ""} ${markClass[String(mark)] ?? ""}`}
                        title={markTitle(mark, v)}
                        onClick={v ? () => open(n, c) : undefined}
                      >
                        {fmt(v, columnValue(teamNode(n)?.byDay, c))}
                      </td>
                    );
                  })}
                  <td
                    className={`total-col cell ${n.total ? "has" : ""} ${totalCheck(n) ? "short" : ""}`}
                    title={totalCheck(n) ?? undefined}
                    onClick={n.total ? () => open(n) : undefined}
                  >
                    {fmt(n.total, teamNode(n)?.total)}
                  </td>
                </tr>
              );
            })}
          </tbody>
          <tfoot>
            <tr>
              <th className="sticky-col row-label">Total</th>
              {columns.map((c) => {
                const v = columnValue(totals, c);
                return (
                  <td
                    key={c.key}
                    className={`cell ${c.weekend ? "weekend" : ""} ${c.boundary ? "week-start" : ""} ${v ? "has" : ""}`}
                    onClick={v ? () => open(null, c) : undefined}
                  >
                    {fmt(v, v)}
                  </td>
                );
              })}
              <td className={`total-col cell ${grandTotal ? "has" : ""}`} onClick={grandTotal ? () => open(null) : undefined}>
                {fmt(grandTotal, grandTotal)}
              </td>
            </tr>
          </tfoot>
        </table>
      </div>
      {drill && <DrillPanel target={drill} hoursPerPersonDay={hoursPerPersonDay} unit={unit} onClose={closeDrill} />}
    </div>
  );
}
